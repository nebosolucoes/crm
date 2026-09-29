import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Instagram Direct e Messenger pelo intermediário (spec 21) — a lógica que dá
 * para provar sem banco nem rede.
 *
 * O que cada bloco guarda:
 *   - parser: as três redes entram, a pessoa social NUNCA vira telefone, e o
 *     `sender` de uma mensagem de saída (que é a própria empresa) não vira
 *     contato;
 *   - `state` do OAuth: assinado, com prazo, com finalidade — adulterar,
 *     expirar ou reusar o de outra integração reprova;
 *   - capacidades e janela: 24h para todo mundo, 7 dias só para pessoa, e a
 *     tag só quando é preciso;
 *   - envio: o destinatário cai na thread, e a chave do provedor nunca vai
 *     para o CDN da Meta.
 *
 * Cada negativa tem o controle positivo ao lado.
 */
import { capabilitiesOf, CHANNEL_PROVIDER_ZERNIO } from "@/lib/channels/capabilities";
import { estadoDaJanela, precisaDaTagDeAtendimentoHumano } from "@/lib/channels/janela";
import { conferirEstadoSocial, emitirEstadoSocial } from "@/lib/channels/social-state";
import { fonteDeTemplates } from "@/lib/channels/templates-fonte";
import { parseZernioEdicao, parseZernioInbound } from "@/lib/channels/zernio/webhook";
import { waIdentityFrom } from "@/lib/channels/zernio/ingest";
import { explicarErroDoCallback, plataformaDoProvedor, redeDoProvedor } from "@/lib/channels/zernio/social";
import { channelLabel } from "@/hooks/channels/useChannelSessions";

const ZERNIO = CHANNEL_PROVIDER_ZERNIO;

const evento = (over: Record<string, unknown> = {}, msg: Record<string, unknown> = {}) => ({
  id: "evt_ig_1",
  event: "message.received",
  account: { accountId: "acc_ig", profileId: "prof_1" },
  conversation: { id: "conv_ig", participantId: "17841400000000001", participantName: "Ana", participantUsername: "ana.souza" },
  message: {
    id: "m_1",
    conversationId: "conv_ig",
    platform: "instagram",
    platformMessageId: "mid.IG1",
    direction: "incoming",
    text: "oi, tem horário amanhã?",
    attachments: [],
    sender: { id: "17841400000000001", name: "Ana", username: "ana.souza", picture: "https://cdn.fbsbx.com/a.jpg" },
    sentAt: "2026-09-29T12:00:00.000Z",
    isRead: false,
    ...msg,
  },
  ...over,
});

describe("parser — as três redes", () => {
  it("Instagram entra, com a rede e a identidade social", () => {
    const m = parseZernioInbound(evento());
    expect(m?.plataforma).toBe("instagram");
    expect(m?.identity.anchor).toEqual({ kind: "social", value: "17841400000000001" });
    expect(m?.identity.username).toBe("ana.souza");
    expect(m?.identity.avatarUrl).toBe("https://cdn.fbsbx.com/a.jpg");
  });

  it("o `facebook` do provedor é o Messenger do CRM", () => {
    expect(parseZernioInbound(evento({}, { platform: "facebook" }))?.plataforma).toBe("messenger");
    expect(plataformaDoProvedor("facebook")).toBe("messenger");
    expect(redeDoProvedor("messenger")).toBe("facebook");
  });

  it("WhatsApp continua entrando como WhatsApp (controle)", () => {
    const m = parseZernioInbound(
      evento({}, { platform: "whatsapp", sender: { phoneNumber: "+5511999998888", name: "Beto" } }),
    );
    expect(m?.plataforma).toBe("whatsapp");
    expect(m?.identity.anchor).toEqual({ kind: "phone", value: "+5511999998888" });
  });

  it("a pessoa social NUNCA vira telefone — nem entrando, nem saindo", () => {
    const entrada = parseZernioInbound(evento());
    const saida = parseZernioInbound(
      evento({ event: "message.sent" }, { direction: "outgoing", sender: { id: "acc_ig", name: "Minha Loja" } }),
    );
    for (const m of [entrada, saida]) {
      expect(m?.identity.phone).toBeNull();
      expect(m?.identity.anchor?.kind).toBe("social");
    }
    // A identidade social também não entra no vocabulário do WhatsApp.
    expect(waIdentityFrom(entrada!.identity)).toBeNull();
  });

  it("na SAÍDA a pessoa é o participante, não o `sender` (que é a própria empresa)", () => {
    const m = parseZernioInbound(
      evento({ event: "message.sent" }, { direction: "outgoing", sender: { id: "acc_ig", name: "Minha Loja" }, sentVia: "api" }),
    );
    expect(m?.direction).toBe("outbound");
    expect(m?.identity.anchor?.value).toBe("17841400000000001");
    expect(m?.identity.displayName).toBe("Ana");
    expect(m?.sentVia).toBe("api");
  });

  it("recolhe TODOS os ids de conta que o evento cita", () => {
    const m = parseZernioInbound(evento({ account: { accountId: "acc_ig", id: "outro" } }));
    expect(m?.contasDoEvento).toEqual(["acc_ig", "outro"]);
  });

  it("guarda o `originalType` do anexo (story, reel)", () => {
    const m = parseZernioInbound(
      evento({}, { attachments: [{ type: "share", originalType: "story_mention", url: "https://cdn.fbsbx.com/s" }] }),
    );
    expect(m?.attachments[0]).toMatchObject({ type: "share", originalType: "story_mention" });
  });

  it("rede que o CRM não atende segue recusada", () => {
    expect(parseZernioInbound(evento({}, { platform: "twitter" }))).toBeNull();
    expect(parseZernioEdicao({ event: "message.edited", message: { platform: "twitter", id: "x" } })).toBeNull();
  });

  it("edição de DM do Instagram é lida (controle da linha acima)", () => {
    expect(
      parseZernioEdicao({ event: "message.edited", message: { platform: "instagram", platformMessageId: "mid.1", text: "novo" } }),
    ).toMatchObject({ externalId: "mid.1", tipo: "edited" });
  });
});

describe("state do OAuth", () => {
  const base = { orgId: "org-1", userId: "user-1", authSessionId: "sess-1", plataforma: "instagram" as const, profileId: "prof-1" };

  it("ida e volta preservam quem, onde e qual tentativa", () => {
    const { state, nonce } = emitirEstadoSocial(base);
    expect(conferirEstadoSocial(state)).toMatchObject({ ...base, nonce });
  });

  it("recusa adulteração — trocar a organização invalida a assinatura", () => {
    const { state } = emitirEstadoSocial(base);
    const [corpo, assinatura] = state.split(".") as [string, string];
    const dado = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    const forjado = Buffer.from(JSON.stringify({ ...dado, orgId: "org-vizinha" }), "utf8").toString("base64url");
    expect(conferirEstadoSocial(`${forjado}.${assinatura}`)).toBeNull();
  });

  it("recusa depois de 10 minutos", () => {
    const agora = Date.now();
    const { state } = emitirEstadoSocial(base, agora);
    expect(conferirEstadoSocial(state, agora + 9 * 60_000)).not.toBeNull();
    expect(conferirEstadoSocial(state, agora + 11 * 60_000)).toBeNull();
  });

  it("recusa lixo e ausência", () => {
    expect(conferirEstadoSocial(null)).toBeNull();
    expect(conferirEstadoSocial("a.b.c")).toBeNull();
    expect(conferirEstadoSocial("semponto")).toBeNull();
  });
});

describe("capacidades e janela", () => {
  const H = 60 * 60 * 1000;
  const agora = new Date("2026-09-29T12:00:00.000Z");
  const ha = (horas: number) => new Date(agora.getTime() - horas * H).toISOString();

  it("DM social: sem template, sem grupo, sem anti-ban, com prazo humano de 7 dias", () => {
    const caps = capabilitiesOf(ZERNIO, "instagram");
    expect(caps).toMatchObject({
      requiresTemplates: false,
      canManageTemplates: false,
      groups: "none",
      banRisk: false,
      freeformOutsideWindow: false,
      humanAgentWindowHours: 168,
    });
  });

  it("o WhatsApp do mesmo intermediário continua exigindo template (controle)", () => {
    expect(capabilitiesOf(ZERNIO).requiresTemplates).toBe(true);
    expect(capabilitiesOf(ZERNIO, "whatsapp").requiresTemplates).toBe(true);
  });

  it("rede social só muda o intermediário — WAHA de 'instagram' não existe", () => {
    expect(capabilitiesOf("waha", "instagram").groups).toBe("full");
  });

  it("dentro de 24h: aberta; de 24h a 7 dias: só humano; depois: fechada", () => {
    expect(estadoDaJanela(ZERNIO, ha(2), agora, "instagram").tipo).toBe("aberta");
    expect(estadoDaJanela(ZERNIO, ha(30), agora, "instagram").tipo).toBe("so_humano");
    expect(estadoDaJanela(ZERNIO, ha(24 * 8), agora, "messenger").tipo).toBe("fechada");
  });

  it("no WhatsApp não há prazo humano: 30h depois é fechada (controle)", () => {
    expect(estadoDaJanela(ZERNIO, ha(30), agora).tipo).toBe("fechada");
  });

  it("a tag de atendimento humano só entra no prazo estendido", () => {
    expect(precisaDaTagDeAtendimentoHumano(ZERNIO, "instagram", ha(2), agora)).toBe(false);
    expect(precisaDaTagDeAtendimentoHumano(ZERNIO, "instagram", ha(30), agora)).toBe(true);
    expect(precisaDaTagDeAtendimentoHumano(ZERNIO, "instagram", ha(24 * 8), agora)).toBe(false);
    expect(precisaDaTagDeAtendimentoHumano(ZERNIO, "whatsapp", ha(30), agora)).toBe(false);
  });

  it("conversa social não oferece modelos aprovados do WhatsApp", () => {
    expect(fonteDeTemplates(ZERNIO, "instagram")).toBeNull();
    expect(fonteDeTemplates(ZERNIO)).toBe("parceiro");
  });
});

describe("envio pelo intermediário", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sem telefone nem identidade de WhatsApp, o destinatário é a thread", async () => {
    const { zernioAdapter } = await import("@/lib/channels/adapters/zernio");
    const r = zernioAdapter.resolveRecipient({
      isGroup: false,
      groupChatId: null,
      phoneNumber: null,
      waIdentity: null,
      waLid: null,
      providerConversationId: "conv_ig",
    });
    expect(r).toBe("conv_ig");
  });

  it("com telefone, continua o telefone (controle)", async () => {
    const { zernioAdapter } = await import("@/lib/channels/adapters/zernio");
    expect(
      zernioAdapter.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: "+5511999998888",
        waIdentity: null,
        waLid: null,
        providerConversationId: "conv_wa",
      }),
    ).toBe("5511999998888");
  });

  it("a chave NÃO vai para o CDN da Meta — e vai para o provedor", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
    vi.doMock("@/lib/channels/zernio/credentials", async (orig) => ({
      ...(await orig<typeof import("@/lib/channels/zernio/credentials")>()),
      resolveZernioCreds: async () => ({ accountId: "acc", apiKey: "CHAVE", baseUrl: "https://zernio.com/api", source: "session" }),
    }));
    vi.doMock("@/lib/automation/outbound-ip", () => ({ assertDestinoResolvidoSeguro: async () => undefined }));
    const chamadas: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      chamadas.push({ url, auth: headers.get("authorization") });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    });
    const { zernioAdapter } = await import("@/lib/channels/adapters/zernio");
    await zernioAdapter.fetchInboundMedia!({ organizationId: "org", sessionRef: "acc", url: "https://scontent.cdninstagram.com/x.jpg" });
    await zernioAdapter.fetchInboundMedia!({ organizationId: "org", sessionRef: "acc", url: "https://zernio.com/api/v1/whatsapp/media/1" });
    expect(chamadas[0]).toEqual({ url: "https://scontent.cdninstagram.com/x.jpg", auth: null });
    expect(chamadas[1]?.auth).toBe("Bearer CHAVE");
    vi.unstubAllGlobals();
  });

  it("a tag HUMAN_AGENT só vai no corpo quando o envelope pede", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
    vi.doMock("@/lib/channels/zernio/credentials", async (orig) => ({
      ...(await orig<typeof import("@/lib/channels/zernio/credentials")>()),
      resolveZernioCreds: async () => ({ accountId: "acc", apiKey: "CHAVE", baseUrl: "https://zernio.com/api", source: "session" }),
    }));
    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      corpos.push(JSON.parse(String(init?.body)));
      return Response.json({ success: true, data: { messageId: "mid.1" } });
    });
    const { zernioAdapter } = await import("@/lib/channels/adapters/zernio");
    const base = { organizationId: "org", sessionRef: "acc", to: "conv", providerConversationId: "conv", kind: "text" as const, body: "oi" };
    await zernioAdapter.send({ ...base, humanAgentTag: true });
    await zernioAdapter.send(base);
    expect(corpos[0]).toMatchObject({ messagingType: "MESSAGE_TAG", messageTag: "HUMAN_AGENT" });
    expect(corpos[1]).not.toHaveProperty("messageTag");
    vi.unstubAllGlobals();
  });
});

describe("tela", () => {
  it("o seletor de canal diz a rede de uma conexão social", () => {
    expect(channelLabel({ display_name: "@loja", phone_number: null, waha_session_name: null, platform: "instagram" })).toBe(
      "Instagram · @loja",
    );
    expect(channelLabel({ display_name: "Loja", phone_number: null, waha_session_name: null, platform: "whatsapp" })).toBe("Loja");
  });

  it("erro do OAuth vira frase, e o desconhecido cai no genérico", () => {
    expect(explicarErroDoCallback("personal_account_not_supported")).toMatch(/conta profissional/);
    expect(explicarErroDoCallback("algo_novo_do_provedor")).toBe("Não foi possível concluir a conexão. Tente de novo.");
  });
});
