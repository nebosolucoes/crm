/**
 * Instagram Direct e Messenger (spec 21) — o que quem atende VÊ.
 *
 * Semeia pelos MESMOS caminhos de banco que a ingestão usa
 * (`fn_upsert_social_contact` e `fn_upsert_wa_conversation`), e não por insert
 * cru: a conversa nasce com a rede da sessão porque a função a lê, e é isso que
 * a tela precisa receber. O webhook assinado de ponta a ponta (entrada →
 * contato → conversa → lead) exige a chave de cifra da instalação, que o
 * Supabase do CI não tem; ele foi provado contra o servidor local e está
 * registrado no mapa de jornadas (J30).
 *
 * Três perguntas, pela tela:
 *   1. a conversa de Instagram aparece na lista com o selo da rede, e o
 *      cabeçalho diz "Instagram · @usuario" no lugar do telefone;
 *   2. depois de 24h o selo diz "Só humano" — e o composer continua liberado,
 *      porque uma pessoa ainda pode responder;
 *   3. Conexões tem a aba "Redes sociais", com a conexão listada.
 */
import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";
import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const env = carregarEnvLocal();
const admin: SupabaseClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SESSAO = "aaaaaaaa-e2e0-4000-8000-00000000c021";
const NOME_ABERTA = "Iara Direct-Aberta";
const NOME_HUMANO = "Otavio Direct-Humano";
const H = 60 * 60 * 1000;

async function limpar(orgId: string) {
  const { data: ids } = await admin
    .from("contact_platform_identities")
    .select("contact_id")
    .eq("organization_id", orgId)
    .like("platform_user_id", "e2e-social-%");
  for (const { contact_id } of (ids ?? []) as { contact_id: string }[]) {
    await admin.from("crm_leads").delete().eq("contact_id", contact_id);
    await admin.from("messages").delete().eq("contact_id", contact_id);
    await admin.from("conversations").delete().eq("contact_id", contact_id);
    await admin.from("contacts").delete().eq("id", contact_id);
  }
  await admin.from("channel_sessions").delete().eq("id", SESSAO);
}

async function semear(orgId: string) {
  await limpar(orgId);
  const { error: eSess } = await admin.from("channel_sessions").insert({
    id: SESSAO,
    organization_id: orgId,
    provider: "zernio",
    platform: "instagram",
    zernio_account_id: `e2e-social-${Date.now()}`,
    webhook_path_token: `e2esocial${Date.now()}`,
    webhook_secret_encrypted: "\\x00",
    display_name: "@loja.e2e",
    status: "WORKING",
    metadata: { social_username: "loja.e2e" },
  });
  if (eSess) throw new Error(`fixture de canal falhou: ${eSess.message}`);

  for (const [nome, usuario, horasAtras] of [
    [NOME_ABERTA, "iara.e2e", 1],
    [NOME_HUMANO, "otavio.e2e", 30],
  ] as const) {
    const { data: contato, error: eCt } = await admin.rpc("fn_upsert_social_contact", {
      p_org: orgId,
      p_platform: "instagram",
      p_user_id: `e2e-social-${usuario}`,
      p_session: SESSAO,
      p_username: usuario,
      p_name: nome,
    });
    if (eCt || !contato) throw new Error(`fixture de contato falhou: ${eCt?.message ?? "sem id"}`);
    const { data: conversa, error: eConv } = await admin.rpc("fn_upsert_wa_conversation", {
      p_org: orgId,
      p_contact: contato,
      p_session: SESSAO,
    });
    if (eConv || !conversa) throw new Error(`fixture de conversa falhou: ${eConv?.message ?? "sem id"}`);
    const quando = new Date(Date.now() - horasAtras * H).toISOString();
    await admin
      .from("conversations")
      .update({
        last_inbound_at: quando,
        last_message_at: quando,
        last_message_preview: "Oi! Vi o post de vocês",
        provider_conversation_id: `e2e-thread-${usuario}`,
        // Sem dono e sem robô: cai em Todas para o admin.
        bot_silenced_until: "infinity",
      })
      .eq("id", conversa);
  }
}

const orgId = () => (lerCreds() as unknown as { org_id: string }).org_id;

/** Abre a aba "Todas" da inbox — a que o admin vê sem filtro de dono. */
async function abrirTodas(page: Page) {
  await page.goto("/app/inbox");
  await page.getByRole("tab", { name: /Todas/i }).first().click();
}

test.describe("Instagram Direct e Messenger — a tela", () => {
  // Login com MFA já consome boa parte do teto global de 30 s.
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => {
    await semear(orgId());
  });
  test.afterAll(async () => {
    await limpar(orgId());
  });

  test("a conversa de Instagram tem o selo da rede, o @ no cabeçalho e a janela certa", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirTodas(page);

    const linha = page.locator("[data-conversation-id]", { hasText: NOME_ABERTA });
    await expect(linha).toBeVisible({ timeout: 30_000 });
    await expect(linha.locator('svg[data-plataforma="instagram"]')).toBeVisible();

    await linha.click();
    await expect(page.getByTestId("identidade-social")).toHaveText("Instagram · @iara.e2e");
    // Dentro das 24h: relógio da janela, não "só modelo" (não há modelo aqui).
    await expect(page.getByText(/^Janela \d/)).toBeVisible();
    await page.screenshot({ path: ".superpowers/evidence/canais-sociais-01-inbox-instagram.png" });
  });

  test("depois de 24h: 'Só humano', e o composer segue liberado", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await abrirTodas(page);

    const linha = page.locator("[data-conversation-id]", { hasText: NOME_HUMANO });
    await expect(linha).toBeVisible({ timeout: 30_000 });
    await linha.click();
    await expect(page.getByText(/^Só humano ·/)).toBeVisible();
    // Nenhum aviso de janela fechada: a pessoa ainda pode escrever.
    await expect(page.getByText(/Passou o prazo para responder nesta rede/)).toHaveCount(0);
    await expect(page.getByRole("textbox").last()).toBeEnabled();
    await page.screenshot({ path: ".superpowers/evidence/canais-sociais-02-so-humano.png" });
  });

  test("Conexões tem a aba Redes sociais, com a conexão listada", async ({ page }) => {
    await loginComoAdmin(page, lerCreds());
    await page.goto("/app/connections?aba=social");

    await expect(page.getByRole("heading", { name: /Instagram Direct e Messenger/ })).toBeVisible({ timeout: 30_000 });
    const cartao = page.locator('[data-conexao-social="instagram"]', { hasText: "@loja.e2e" });
    await expect(cartao).toBeVisible();
    await page.screenshot({ path: ".superpowers/evidence/canais-sociais-03-conexoes.png", fullPage: true });
  });
});
