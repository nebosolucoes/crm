/**
 * Comentários de Instagram e Facebook na inbox (spec 22) — o que quem atende VÊ.
 *
 * Semeia pelos MESMOS caminhos de banco que a ingestão usa
 * (`fn_upsert_social_contact` e `fn_upsert_comment_conversation`), como o
 * spec da spec 21: o webhook assinado ponta a ponta exige a chave de cifra da
 * instalação, que o Supabase do CI não tem — ele é provado contra o servidor
 * local e registrado no mapa de jornadas.
 *
 * A conexão de prova tem uma conta FICTÍCIA no provedor (a trava
 * `channel_sessions_provider_ref_check` exige o campo). Nada aqui escreve na
 * rede social: no CI não há chave e a conferência do cron pula a conta; com a
 * chave local, ela faz uma LEITURA para uma conta que não existe, recebe erro e
 * segue — o aviso não depende dela.
 *
 * Perguntas, pela tela:
 *   1. o comentário aparece na lista com o balão da rede e o nome da conta, e o
 *      filtro "Só comentários" separa do Direct da MESMA pessoa;
 *   2. o atendimento mostra o post, o anúncio, o link — e o composer responde
 *      "No post" (aviso de público) ou "No Direct", sem janela de 24h;
 *   3. parado além do prazo, vira aviso na Central, que leva à inbox filtrada;
 *   4. fechar sem responder pede o motivo, e o aviso some sozinho;
 *   5. Configurações › Atendimento guarda a política; Conexões diz o que entra.
 */
import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const env = carregarEnvLocal();
const admin: SupabaseClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const SEGREDO_CRON = process.env.INTERNAL_SECRET ?? env.INTERNAL_SECRET ?? "e2e-placeholder-nao-e-segredo";

const SESSAO = "aaaaaaaa-e2e0-4000-8000-00000000c022";
const CONTA = "@loja.coment.e2e";
const NOME = "Rita Comenta-E2E";
const EVIDENCIA = ".superpowers/evidence/comentarios-na-inbox";
const H = 60 * 60 * 1000;
// Longa de propósito: a tela corta em 3 linhas com reticências.
const LEGENDA =
  "Promoção de outubro: kit completo com frete grátis para todo o Brasil. " +
  "Escolha a cor, o tamanho e o acabamento — e ainda leve um brinde na primeira compra. " +
  "Válido enquanto durarem os estoques, uma unidade por CPF, não cumulativo com outras ofertas da loja.";

const orgId = () => (lerCreds() as unknown as { org_id: string }).org_id;

async function limpar(org: string) {
  const { data: ids } = await admin
    .from("contact_platform_identities")
    .select("contact_id")
    .eq("organization_id", org)
    .like("platform_user_id", "e2e-coment-%");
  for (const { contact_id } of (ids ?? []) as { contact_id: string }[]) {
    await admin.from("crm_leads").delete().eq("contact_id", contact_id);
    await admin.from("messages").delete().eq("contact_id", contact_id);
    await admin.from("conversations").delete().eq("contact_id", contact_id);
    await admin.from("contacts").delete().eq("id", contact_id);
  }
  await admin.from("agent_inbox_items").delete().eq("organization_id", org).eq("kind", "comment_unanswered").eq("ref_id", SESSAO);
  await admin.from("channel_sessions").delete().eq("id", SESSAO);
}

async function semear(org: string): Promise<{ comentario: string; direct: string }> {
  await limpar(org);
  const { error: eSess } = await admin.from("channel_sessions").insert({
    id: SESSAO,
    organization_id: org,
    provider: "zernio",
    platform: "instagram",
    zernio_account_id: "e2e-coment-conta-ficticia",
    webhook_path_token: `e2ecoment${Date.now()}`,
    webhook_secret_encrypted: "\\x00",
    display_name: CONTA,
    status: "WORKING",
    inbox_direct: true,
    inbox_comments: true,
    metadata: { social_username: "loja.coment.e2e" },
  });
  if (eSess) throw new Error(`fixture de canal falhou: ${eSess.message}`);

  const { data: contato, error: eCt } = await admin.rpc("fn_upsert_social_contact", {
    p_org: org,
    p_platform: "instagram",
    p_user_id: "e2e-coment-rita",
    p_session: SESSAO,
    p_username: "rita.e2e",
    p_name: NOME,
  });
  if (eCt || !contato) throw new Error(`fixture de contato falhou: ${eCt?.message ?? "sem id"}`);

  // O Direct da MESMA pessoa na MESMA conta — o filtro tem de separar.
  const { data: direct } = await admin.rpc("fn_upsert_wa_conversation", { p_org: org, p_contact: contato, p_session: SESSAO });
  const { data: comentario, error: eFio } = await admin.rpc("fn_upsert_comment_conversation", {
    p_org: org,
    p_contact: contato,
    p_session: SESSAO,
    p_root_comment_id: "e2e-coment-raiz-1",
    p_contexto: {
      platform_post_id: "e2e-post-1",
      permalink: "https://www.instagram.com/p/e2e-post-1/",
      post_text: LEGENDA,
      // Imagem do próprio app: a prova não depende de CDN de terceiro.
      post_image_url: "/assets/Icone.png",
      is_ad: true,
    },
  });
  if (eFio || !comentario || !direct) throw new Error(`fixture de fio falhou: ${eFio?.message ?? "sem id"}`);

  const seisHoras = new Date(Date.now() - 6 * H).toISOString();
  const umDia = new Date(Date.now() - 24 * H).toISOString();
  await admin.from("messages").insert([
    {
      organization_id: org,
      conversation_id: comentario,
      contact_id: contato,
      channel_session_id: SESSAO,
      external_id: "e2e-coment-raiz-1",
      direction: "inbound",
      sent_via: "external_device",
      status: "delivered",
      type: "text",
      body: "Quanto custa o kit?",
      sent_at: seisHoras,
      metadata: { comentario: { parent_comment_id: null, platform_post_id: "e2e-post-1" } },
    },
    {
      organization_id: org,
      conversation_id: direct,
      contact_id: contato,
      channel_session_id: SESSAO,
      external_id: "e2e-coment-dm-1",
      direction: "inbound",
      sent_via: "external_device",
      status: "delivered",
      type: "text",
      body: "Oi, mandei mensagem no Direct",
      sent_at: umDia,
    },
  ]);
  await admin
    .from("conversations")
    .update({ last_inbound_at: seisHoras, last_message_at: seisHoras, last_message_preview: "Quanto custa o kit?", bot_silenced_until: "infinity" })
    .eq("id", comentario);
  await admin
    .from("conversations")
    .update({ last_inbound_at: umDia, last_message_at: umDia, last_message_preview: "Oi, mandei mensagem no Direct", bot_silenced_until: "infinity" })
    .eq("id", direct);
  return { comentario: comentario as string, direct: direct as string };
}

async function abrirTodas(page: Page) {
  await page.goto("/app/inbox?filter=all");
  await expect(page.locator("[data-conversation-id]").first()).toBeVisible({ timeout: 30_000 });
}

async function rodarCron(page: Page) {
  const r = await page.request.post("/api/v1/cron/comments-watcher", { headers: { authorization: `Bearer ${SEGREDO_CRON}` } });
  expect(r.status(), "o cron de comentários tem que responder 200").toBe(200);
}

test.describe("Comentários na inbox — a tela", () => {
  test.describe.configure({ timeout: 180_000, mode: "serial" });
  let ids: { comentario: string; direct: string };

  test.beforeAll(async () => {
    ids = await semear(orgId());
  });
  test.afterAll(async () => {
    await limpar(orgId());
  });

  test("lista: balão de comentário, o nome da conta, e o filtro separa do Direct", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirTodas(page);

    const fio = page.locator(`[data-conversation-id="${ids.comentario}"]`);
    await expect(fio).toBeVisible({ timeout: 30_000 });
    await expect(fio.locator('svg[data-origem="comentario"]').first()).toBeVisible();
    await expect(fio.getByTestId("selo-da-conta")).toHaveText(CONTA);
    await expect(page.locator(`[data-conversation-id="${ids.direct}"]`)).toBeVisible();
    await page.screenshot({ path: `${EVIDENCIA}/01-lista-com-comentario-e-direct.png` });

    await page.getByTestId("filtro-tipo").click();
    await page.getByRole("option", { name: "Só comentários" }).click();
    await expect(fio).toBeVisible();
    await expect(page.locator(`[data-conversation-id="${ids.direct}"]`)).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCIA}/02-filtro-so-comentarios.png` });
  });

  test("atendimento: o post, o anúncio, e responder no post ou no Direct", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await page.goto(`/app/inbox/${ids.comentario}`);

    const contexto = page.getByTestId("contexto-do-comentario");
    await expect(contexto).toContainText(`Comentário em ${CONTA}`, { timeout: 30_000 });
    await expect(contexto).toContainText("Anúncio");

    // O post, à direita, ANTES dos botões: miniatura, legenda em até 3 linhas, link embaixo.
    const post = page.getByTestId("post-do-comentario");
    await expect(post).toBeVisible();
    await expect(post.getByRole("link", { name: /Ver publicação/ })).toHaveAttribute(
      "href",
      "https://www.instagram.com/p/e2e-post-1/",
    );
    const medidas = await page.evaluate(() => {
      const caixa = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const legenda = document.querySelector('[data-testid="legenda-do-post"]') as HTMLElement;
      const estilo = getComputedStyle(legenda);
      const assumir = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Assumir");
      return {
        clamp: estilo.webkitLineClamp,
        linhas: Math.round(legenda.getBoundingClientRect().height / parseFloat(estilo.lineHeight)),
        cortada: legenda.scrollHeight > legenda.clientHeight,
        larguraDaLegenda: legenda.getBoundingClientRect().width,
        miniatura: caixa('[data-testid="miniatura-do-post"]').width,
        postAntesDosBotoes: assumir ? caixa('[data-testid="post-do-comentario"]').right <= assumir.getBoundingClientRect().left + 1 || caixa('[data-testid="post-do-comentario"]').bottom <= assumir.getBoundingClientRect().top + 1 : null,
      };
    });
    expect(medidas.clamp).toBe("3");
    expect(medidas.linhas).toBeLessThanOrEqual(3);
    expect(medidas.cortada, "a legenda longa tem que ser cortada com reticências").toBe(true);
    expect(medidas.larguraDaLegenda).toBeLessThanOrEqual(260);
    expect(medidas.miniatura).toBeGreaterThanOrEqual(62);
    expect(medidas.postAntesDosBotoes).not.toBe(false);

    await page.getByTestId("miniatura-do-post").click();
    const ampliada = page.getByTestId("imagem-do-post-ampliada");
    await expect(ampliada).toBeVisible();
    // A imagem tem de CARREGAR e ocupar espaço — largura sozinha o `w-full` dá até sem imagem.
    const imagem = ampliada.locator("img");
    await expect
      .poll(() => imagem.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const caixa = await imagem.evaluate((img) => {
      const r = img.getBoundingClientRect();
      return { largura: r.width, altura: r.height };
    });
    expect(caixa.altura).toBeGreaterThan(medidas.miniatura * 3);
    await page.screenshot({ path: `${EVIDENCIA}/03b-post-ampliado.png` });
    await page.keyboard.press("Escape");
    await expect(ampliada).toBeHidden();
    // Comentário não tem janela de 24h.
    await expect(page.getByText(/^Janela \d/)).toHaveCount(0);

    await expect(page.getByTestId("onde-responder")).toBeVisible();
    await expect(page.getByTestId("aviso-de-resposta")).toHaveText("Resposta pública: aparece no post para todo mundo.");
    await page.screenshot({ path: `${EVIDENCIA}/03-atendimento-responder-no-post.png` });

    await page.getByTestId("onde-responder").getByRole("button", { name: "No Direct" }).click();
    await expect(page.getByTestId("aviso-de-resposta")).toContainText("mensagem privada");
    await page.screenshot({ path: `${EVIDENCIA}/04-atendimento-responder-no-direct.png` });
  });

  test("parado além do prazo: aviso na Central, que abre a inbox nos comentários da conta", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await rodarCron(page);

    await page.goto("/app/ai/inbox");
    const aviso = page.getByText(`Comentário sem resposta em ${CONTA}`).first();
    await expect(aviso).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${EVIDENCIA}/05-central-aviso-por-conta.png` });

    await page.getByRole("link", { name: "Ver comentários" }).first().click();
    await expect(page).toHaveURL(/tipo=comment/);
    await expect(page.locator(`[data-conversation-id="${ids.comentario}"]`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[data-conversation-id="${ids.direct}"]`)).toHaveCount(0);
  });

  test("fechar sem responder pede o motivo — e o aviso some sozinho", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await page.goto(`/app/inbox/${ids.comentario}`);

    await page.getByTestId("fechar-comentario").click();
    const dialogo = page.getByTestId("motivo-do-fechamento");
    await expect(dialogo).toBeVisible();
    await page.screenshot({ path: `${EVIDENCIA}/06-fechar-pede-motivo.png` });
    await dialogo.getByRole("button", { name: /Spam/ }).click();
    // Primeira chamada à rota em `next dev` compila sob demanda: o prazo é o dos demais passos.
    await expect(dialogo).toBeHidden({ timeout: 30_000 });

    await expect
      .poll(async () => (await admin.from("conversations").select("status, metadata").eq("id", ids.comentario).single()).data, {
        timeout: 30_000,
      })
      .toMatchObject({ status: "closed", metadata: { comentario: { fechamento: { motivo: "spam" } } } });

    await rodarCron(page);
    const { data: aberto } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("kind", "comment_unanswered")
      .eq("ref_id", SESSAO)
      .eq("status", "open");
    expect(aberto ?? []).toHaveLength(0);
  });

  test("configuração: a política fica salva, e a conexão diz o que entra na inbox", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await page.goto("/app/settings/atendimento");
    const cartao = page.getByTestId("config-comentarios");
    await expect(cartao).toBeVisible({ timeout: 30_000 });
    const prazo = cartao.getByLabel(/Avisar comentário sem resposta/);
    const antes = await prazo.inputValue();
    await prazo.fill("2");
    await cartao.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Configuração de comentários salva.")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("config-comentarios").getByLabel(/Avisar comentário sem resposta/)).toHaveValue("2");
    await page.screenshot({ path: `${EVIDENCIA}/07-configuracoes-atendimento.png` });
    // Devolve o que estava: o banco local é compartilhado.
    await page.getByTestId("config-comentarios").getByLabel(/Avisar comentário sem resposta/).fill(antes || "4");
    await page.getByTestId("config-comentarios").getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Configuração de comentários salva.")).toBeVisible();

    await page.goto("/app/connections");
    const conexao = page.locator(`[data-conexao="${SESSAO}"]`);
    await expect(conexao).toBeVisible({ timeout: 30_000 });
    await expect(conexao.getByTestId("entrega-na-lista")).toContainText("Mensagens e comentários");
    await conexao.getByTestId("entrega-na-lista").getByRole("button").first().click();
    await expect(conexao.getByTestId("escolha-da-entrega")).toBeVisible();
    await page.screenshot({ path: `${EVIDENCIA}/08-conexao-o-que-entra.png` });
  });
});
