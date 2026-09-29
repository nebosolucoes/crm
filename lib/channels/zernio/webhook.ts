/**
 * Entrada do canal intermediado — verificação de assinatura e leitura do
 * payload.
 *
 * PURO de propósito: nada aqui toca banco, rede ou relógio. A rota faz o
 * efeito; aqui só se decide *o que o payload diz*. É o que permite provar o
 * caso difícil (assinatura errada, campo ausente, identidade sem telefone) sem
 * subir infraestrutura.
 *
 * ─── Por que este módulo é o que destrava o envio ───────────────────────────
 *
 * O `conversationId` do provider NÃO se deriva do contato: ele o inventa e o
 * entrega AQUI. `conversations.provider_conversation_id` só existe porque este
 * webhook o traz — sem gravá-lo, responder dentro da janela de 24h fica
 * impossível, porque o endpoint que aceita telefone exige template.
 *
 * ─── A identidade em transição (rollout BSUID, abril/2026) ──────────────────
 *
 * A doc do provider é explícita: quem adota um *username* pode escrever à
 * empresa **sem expor telefone**, e aí `phoneNumber` vem ausente. O anchor
 * recomendado passa a ser o `businessScopedUserId`. Ler só o telefone
 * funcionaria hoje e criaria contato órfão amanhã — por isso a resolução de
 * identidade tem ordem explícita e devolve QUAL âncora usou, para quem grava
 * saber o que está guardando.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { PLATAFORMA_WHATSAPP, type Plataforma } from "../plataformas";
import { plataformaDoProvedor } from "./social";

/** Assinatura HMAC-SHA256 no header `X-Zernio-Signature`. */
export function verifyZernioSignature(
  rawBody: string,
  headerValue: string | null,
  secret: string,
): boolean {
  // Sem segredo configurado NÃO é "passa": é "não dá para verificar". Deixar
  // passar transformaria a rota num endpoint público que escreve no banco de
  // quem instalou. Quem decide seguir sem verificação faz isso explicitamente
  // na rota, não por omissão aqui.
  if (!secret || !headerValue) return false;

  const got = headerValue.startsWith("sha256=") ? headerValue.slice(7) : headerValue;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  // Comparação de tempo constante, e comprimento conferido ANTES:
  // `timingSafeEqual` lança quando os buffers têm tamanhos diferentes, e um
  // throw aqui viraria 500 em vez de 401 — o atacante aprenderia pelo código
  // de status o que não deveria.
  const a = Buffer.from(got, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** O que este evento pede que se faça com a mensagem. */
export type ZernioEventKind =
  /** Mensagem nova — do cliente ou nossa, vinda de fora do CRM. */
  | "message"
  /** Só mudou o desfecho de uma mensagem que já existe. */
  | "status";

export interface ZernioInboundMessage {
  /**
   * Com que rede é a conversa. A mesma conta do provedor entrega WhatsApp,
   * Instagram e Messenger no mesmo formato; quem grava confere que a rede é a
   * da SESSÃO que recebeu (spec 21 §4).
   */
  plataforma: Plataforma;
  /**
   * Quem mandou a mensagem de SAÍDA, segundo o provedor: `api` (o próprio CRM),
   * `human` (alguém pelo app), `null` (desconhecido — inclusive o envio feito
   * direto no Instagram). Decide se a IA pausa por atendimento manual.
   */
  sentVia: string | null;
  /** De quem partiu. `outbound` cobre envio feito FORA do CRM. */
  direction: "inbound" | "outbound";
  /** `message` grava; `status` só atualiza o desfecho do que já existe. */
  kind: ZernioEventKind;
  /** Desfecho declarado pelo evento de status (`sent`/`delivered`/`read`/`failed`). */
  status?: "sent" | "delivered" | "read" | "failed";
  /** Motivo, quando o evento é de falha — é o que explica ao operador. */
  errorReason?: string | null;
  /** Id da THREAD no provider — o que endereça o envio livre depois. */
  conversationId: string;
  /** Id da mensagem na plataforma (wamid) — chave de idempotência. */
  externalId: string;
  /** Conta conectada que recebeu — casa com `channel_sessions.zernio_account_id`. */
  accountId: string | null;
  /**
   * TODOS os ids de conta que o evento cita (`account.accountId`, `account.id`,
   * `accountId` solto). A doc não publica o schema do bloco `account`, então a
   * conferência de conta (spec 21 §4) casa se QUALQUER um bater — e recusa só
   * quando o evento cita conta e nenhuma é a da sessão.
   */
  contasDoEvento: string[];
  text: string | null;
  attachments: { type: string; url: string; originalType?: string | null }[];
  sentAt: string | null;
  identity: ZernioIdentity;
  /**
   * O objeto `referral` do evento, cru — presente quando a conversa começou
   * por um clique em anúncio "Clique para o WhatsApp" da Meta. Repassado sem
   * interpretar (mesma regra deste módulo: PURO, decide só *o que o payload
   * diz*) — quem interpreta é `lib/leads/atribuicao-de-anuncio.ts`.
   */
  referral: unknown;
}

export interface ZernioIdentity {
  /** E.164 COM `+`, quando a pessoa expõe telefone. */
  phone: string | null;
  /** Âncora canônica da Meta para o usuário dentro do negócio. */
  bsuid: string | null;
  /** `@handle` — muda quando a pessoa quer; serve para exibir, não para casar. */
  username: string | null;
  displayName: string | null;
  /**
   * Instagram/Messenger: o id da pessoa escopado à conta conectada (IGSID /
   * PSID). NUNCA vira telefone — é numérico e tem cara de telefone, e foi
   * exatamente assim que a primeira leitura do participante o transformava em
   * `+<id>`.
   */
  socialId?: string | null;
  /** Foto de perfil na rede, quando o provedor manda. Link que expira: exibir, não guardar como verdade. */
  avatarUrl?: string | null;
  /**
   * Qual âncora usar para casar o contato, já decidida aqui.
   *
   * `null` = payload sem identidade utilizável. Não é erro de parsing: é um
   * evento que não dá para atribuir a ninguém, e quem grava precisa recusá-lo
   * em vez de criar um contato anônimo por engano.
   */
  anchor: { kind: "bsuid" | "phone" | "social"; value: string } | null;
}

type Bruto = Record<string, unknown>;
const obj = (v: unknown): Bruto | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * Identidade do remetente, com a ordem de precedência declarada.
 *
 * BSUID primeiro porque é o que o provider chama de "âncora primária
 * recomendada" e o único que sobrevive a alguém trocar de telefone ou adotar
 * username. Telefone é o fallback — e continua sendo o caso comum hoje.
 * `whatsappUsername` NUNCA vira âncora: a própria doc avisa que não é estável.
 */
export function resolveZernioIdentity(sender: Bruto | null): ZernioIdentity {
  const s = sender ?? {};
  const phone = str(s.phoneNumber);
  const bsuid = str(s.businessScopedUserId);
  const username = str(s.whatsappUsername);
  const displayName = str(s.name) ?? str(s.displayName);

  const anchor = bsuid
    ? ({ kind: "bsuid", value: bsuid } as const)
    : phone
      ? ({ kind: "phone", value: phone } as const)
      : null;

  return { phone, bsuid, username, displayName, anchor };
}

/**
 * Identidade numa rede social: o id escopado da pessoa é a âncora; nome,
 * @usuário e foto servem para exibir.
 *
 * Nunca lê `phoneNumber` — o provedor não o manda nessas redes, e o
 * participante é numérico: lê-lo como telefone criaria `+<IGSID>`.
 */
export function resolveIdentidadeSocial(fonte: {
  id: string | null;
  name: string | null;
  username: string | null;
  picture: string | null;
}): ZernioIdentity {
  return {
    phone: null,
    bsuid: null,
    username: fonte.username,
    displayName: fonte.name,
    socialId: fonte.id,
    avatarUrl: fonte.picture,
    anchor: fonte.id ? { kind: "social", value: fonte.id } : null,
  };
}

/**
 * A rede da mensagem, no vocabulário do CRM. `null` = rede que o CRM não
 * atende (X, Telegram, SMS…) — o evento é ignorado com 200.
 */
export function plataformaDaMensagem(valor: unknown): Plataforma | null {
  if (valor === "whatsapp") return PLATAFORMA_WHATSAPP;
  return plataformaDoProvedor(valor);
}

/**
 * Lê um payload de mensagem recebida. `null` quando não é isso — outro evento,
 * mensagem de saída (o eco do nosso próprio envio) ou payload incompleto.
 *
 * Devolver `null` em vez de lançar é deliberado: a rota responde 200 para o
 * provider parar de reenviar, e um evento que não nos interessa não é falha.
 * Lançar faria o provider retentar para sempre um payload que nunca vai servir.
 */
/** Eventos que criam mensagem, e eventos que só mudam o desfecho dela. */
const EVENTOS_DE_MENSAGEM = new Set(["message.received", "message.sent"]);
const EVENTOS_DE_STATUS: Record<string, "delivered" | "read" | "failed"> = {
  "message.delivered": "delivered",
  "message.read": "read",
  "message.failed": "failed",
};

/**
 * O autor editou ou apagou a mensagem no aplicativo.
 *
 * Separado de `parseZernioInbound` porque o efeito é outro: aquele CRIA linha
 * (e conversa, e contato); este só corrige uma que já existe. Misturá-los faria
 * uma edição de mensagem que nunca chegou criar uma conversa do nada, com um
 * texto sem contexto nenhum antes dele.
 *
 * `null` quando não é dos nossos — a rota responde 200 e o provider para de
 * reenviar, que é o certo para um evento que nunca vai nos servir.
 */
export interface ZernioEdicao {
  externalId: string;
  /** `edited` traz corpo novo; `deleted` não tem corpo a trazer. */
  tipo: "edited" | "deleted";
  body: string | null;
}

export function parseZernioEdicao(payload: unknown): ZernioEdicao | null {
  const p = obj(payload);
  if (!p) return null;

  const evento = str(p.event) ?? "";
  if (evento !== "message.edited" && evento !== "message.deleted") return null;

  const m = obj(p.message);
  if (!m) return null;
  // Mesma regra do parser de mensagem: rede que o CRM não atende não tem linha
  // nossa para corrigir.
  if (!plataformaDaMensagem(m.platform)) return null;

  const externalId = str(m.platformMessageId) ?? str(m.id);
  if (!externalId) return null;

  return {
    externalId,
    tipo: evento === "message.edited" ? "edited" : "deleted",
    body: str(m.content) ?? str(m.text) ?? str(m.body),
  };
}

export function parseZernioInbound(payload: unknown): ZernioInboundMessage | null {
  const p = obj(payload);
  if (!p) return null;

  const evento = str(p.event) ?? "";
  const deStatus = EVENTOS_DE_STATUS[evento];
  if (!EVENTOS_DE_MENSAGEM.has(evento) && !deStatus) return null;

  const m = obj(p.message);
  if (!m) return null;

  // WhatsApp, Instagram e Messenger (spec 21). As outras redes que a mesma conta
  // serve (X, Telegram, SMS…) seguem ignoradas: entrar como conversa de uma rede
  // que o CRM não sabe responder é pior que não entrar.
  const plataforma = plataformaDaMensagem(m.platform);
  if (!plataforma) return null;
  const social = plataforma !== PLATAFORMA_WHATSAPP;

  const conversationId = str(m.conversationId);
  const externalId = str(m.platformMessageId) ?? str(m.id);
  if (!conversationId || !externalId) return null;

  const anexosBrutos = Array.isArray(m.attachments) ? m.attachments : [];
  const attachments = anexosBrutos
    .map((a) => obj(a))
    .filter((a): a is Bruto => a !== null)
    .map((a) => {
      // `originalType` só quando o provedor o manda (Instagram/Messenger: story,
      // reel, post). Ausente não vira `null` na linha gravada.
      const originalType = str(a.originalType);
      return { type: str(a.type) ?? "file", url: str(a.url) ?? "", ...(originalType ? { originalType } : {}) };
    })
    .filter((a) => a.url.length > 0);

  const saida = str(m.direction) === "outgoing";

  const conversa = obj(p.conversation);
  const remetente = obj(m.sender);

  return {
    plataforma,
    sentVia: str(m.sentVia),
    direction: saida ? "outbound" : "inbound",
    kind: deStatus ? "status" : "message",
    ...(deStatus ? { status: deStatus } : evento === "message.sent" ? { status: "sent" as const } : {}),
    errorReason: deStatus === "failed" ? explicacaoDoErro(obj(p.error)) : null,
    conversationId,
    externalId,
    accountId: str(obj(p.account)?.id) ?? str(obj(p.account)?.accountId) ?? str(p.accountId),
    contasDoEvento: [str(obj(p.account)?.accountId), str(obj(p.account)?.id), str(p.accountId)].filter(
      (v): v is string => v !== null,
    ),
    text: str(m.text),
    attachments,
    sentAt: str(m.sentAt),
    // ─── De quem é o CONTATO, e por que depende da direção ─────────────────
    //
    // Numa mensagem de SAÍDA o `sender` somos NÓS — medido no payload real, ele
    // traz o número da empresa. Usá-lo criaria um contato com o próprio número
    // do negócio, e toda conversa de saída viraria uma conversa com a gente
    // mesmo. Quem está do outro lado está em `conversation.participantId`.
    //
    // Nas redes sociais vale o mesmo, e o participante NÃO é telefone.
    identity: social
      ? saida
        ? resolveIdentidadeSocial({
            id: str(conversa?.participantId),
            name: str(conversa?.participantName),
            username: str(conversa?.participantUsername),
            picture: str(conversa?.participantPicture),
          })
        : resolveIdentidadeSocial({
            id: str(remetente?.id),
            name: str(remetente?.name) ?? str(remetente?.displayName),
            username: str(remetente?.username),
            picture: str(remetente?.picture),
          })
      : saida
        ? resolveZernioIdentity(participanteDaConversa(conversa))
        : resolveZernioIdentity(remetente),
    // Posição exata NÃO VERIFICADA contra o provider real (nunca chegou um
    // clique de anúncio nesta instalação) — tenta na mensagem primeiro (forma
    // documentada da Cloud API), cai para o nível do evento como fallback.
    referral: m.referral ?? p.referral ?? null,
  };
}

/** O outro lado da conversa, na forma que `resolveZernioIdentity` entende. */
function participanteDaConversa(c: Bruto | null): Bruto | null {
  if (!c) return null;
  const id = str(c.participantId);
  if (!id) return null;
  // O provider entrega o telefone SEM `+` neste campo (medido: `595985321822`).
  // Normalizar aqui mantém a âncora idêntica à do caminho de entrada — sem
  // isso o MESMO cliente viraria dois contatos, um por direção.
  const digitos = id.replace(/\D/g, "");
  return {
    phoneNumber: digitos.length >= 8 ? `+${digitos}` : null,
    name: str(c.participantName),
  };
}

/**
 * A explicação da plataforma, que é o que diz ao operador o que fazer.
 *
 * O `code` chega como NÚMERO no payload real (`"code": 131047`), não string —
 * medido nos logs de entrega. Tratá-lo só como texto o descartava em silêncio,
 * e o operador via "Re-engagement message" sem o código que permite procurar o
 * que fazer.
 */
function explicacaoDoErro(e: Bruto | null): string | null {
  if (!e) return null;
  const codigo =
    typeof e.code === "number" ? String(e.code) : typeof e.code === "string" ? e.code : null;
  const partes = [codigo, str(e.title), str(e.explanation)].filter(Boolean);
  return partes.length > 0 ? partes.join(" — ") : null;
}

/**
 * A URL do anexo é um endpoint AUTENTICADO do provider, não um link público —
 * buscá-la sem o Bearer devolve 401, e a doc avisa que a Meta descarta a mídia
 * depois de um tempo, quando passa a devolver 400.
 *
 * Existe como função nomeada para que o chamador não seja tentado a repassar a
 * URL crua para o browser: o que ela devolve é para BAIXAR e guardar, agora.
 */
export function zernioMediaFetchInit(apiKey: string): RequestInit {
  return { headers: { Authorization: `Bearer ${apiKey}` } };
}
