/**
 * Planos e entitlements (migration 0275) — a jornada, pela tela, como um dono
 * de instalação e um admin de cliente fariam.
 *
 *   1. O dono cria um plano "Starter" só com Atendimento em /admin/planos.
 *   2. O dono atribui o Starter à organização do cliente (aba Plano).
 *   3. O admin do cliente entra: o menu perdeu CRM, IA, Disparo e Análise;
 *      /app/kanban digitado cai em "não está incluído no seu plano"; a API de
 *      negócios responde 403 feature_not_entitled (medido pelo NAVEGADOR, não
 *      por curl); Billing diz CRM "Não incluído".
 *   4. O dono libera Agentes de IA por 30 dias: o cliente vê o grupo IA voltar e
 *      "Liberado até …" no Billing.
 *   5. O dono encerra a liberação: o grupo some de novo.
 *   6. Limpeza: a organização volta ao Legado (é compartilhada com as outras
 *      121 specs) e o plano de teste sai de circulação.
 *
 * Serial de propósito: cada caso depende do anterior, e é assim que a pessoa
 * usa — não há "criar override" sem antes ter um plano que não o inclua.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { generateTotp, msUntilNextTotpWindow } from "./utils/totp";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface E2ECreds {
  org_id: string;
  password: string;
  users: Record<string, { id: string; email: string }>;
  admin_totp?: { secret: string };
  dono_totp?: { secret: string };
}

function loadCreds(): E2ECreds {
  const precisa = (): boolean => {
    if (!fs.existsSync(CREDS_PATH)) return true;
    const c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
    return !c.users?.dono || !c.admin_totp?.secret || !c.dono_totp?.secret || !c.org_id;
  };
  // `shell` no Windows: `npx` é um script (.cmd) e o spawn sem shell não o acha.
  const opts = { stdio: "inherit" as const, shell: process.platform === "win32" };
  if (precisa()) execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], opts);
  // Promove `dono` a platform admin (idempotente).
  execFileSync("npx", ["tsx", "scripts/seed-e2e-system-update.ts"], opts);
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
}

const creds = loadCreds();
const SLUG = `e2e-starter-${Date.now().toString(36)}`;

async function loginComTotp(page: Page, email: string, secret: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click({ timeout: 15_000 });
  await page.waitForURL(/\/login\/mfa/);
  const digito1 = page.locator('input[aria-label="Dígito 1"]');
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (msUntilNextTotpWindow() < 3_000) await page.waitForTimeout(msUntilNextTotpWindow() + 200);
    await digito1.click({ timeout: 15_000 });
    await page.keyboard.type(generateTotp(secret), { delay: 40 });
    const entrou = await page.waitForURL(/\/app\//, { timeout: 60_000 }).then(() => true, () => false);
    if (entrou) return;
    await page.waitForTimeout(msUntilNextTotpWindow() + 200);
  }
  throw new Error(`MFA falhou para ${email} (url=${page.url()})`);
}

/** Limpeza fora do navegador, para valer mesmo se um caso do meio falhar. */
async function devolverAoLegado(): Promise<void> {
  const c = credenciaisSupabaseDeTeste();
  const admin = createClient(c.url, c.serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: legado } = await admin.from("platform_plans").select("id").eq("slug", "legado").maybeSingle();
  if (!legado) return;
  await admin.rpc("fn_definir_plano_da_organizacao", {
    p_actor: creds.users.dono!.id,
    p_org: creds.org_id,
    p_plan: legado.id,
    p_reason: "e2e: devolve a organização ao legado",
  });
  const { data: ativos } = await admin
    .from("organization_feature_overrides")
    .select("id")
    .eq("organization_id", creds.org_id)
    .is("revoked_at", null);
  for (const o of ativos ?? []) {
    await admin.rpc("fn_revogar_override_de_recurso", {
      p_actor: creds.users.dono!.id,
      p_org: creds.org_id,
      p_override: o.id,
      p_reason: "e2e: limpeza",
    });
  }
  await admin.from("platform_plans").update({ is_active: false }).eq("slug", SLUG);
}

test.describe.configure({ mode: "serial" });

test.describe("planos e entitlements — do catálogo ao menu do cliente", () => {
  test.setTimeout(180_000);
  test.afterAll(devolverAoLegado);

  const nomeDoPlano = `Starter E2E ${SLUG.slice(-4)}`;

  test("(0) o admin do CLIENTE não alcança o catálogo nem a atribuição — a parede entre as camadas", async ({ page }) => {
    await loginComTotp(page, creds.users.admin!.email, creds.admin_totp!.secret);
    // Leitura do catálogo: 403 (não é platform admin).
    expect((await page.request.get("/api/v1/admin/plans")).status()).toBe(403);
    // Escrita: criar plano, atribuir plano a si mesmo, liberar recurso a si mesmo — tudo 403.
    expect((await page.request.post("/api/v1/admin/plans", { data: { slug: "hack", name: "Hack", features: ["crm"] } })).status()).toBe(403);
    expect((await page.request.put(`/api/v1/admin/tenants/${creds.org_id}/plan`, { data: { plan_id: creds.org_id, reason: "auto-upgrade" } })).status()).toBe(403);
    expect((await page.request.post(`/api/v1/admin/tenants/${creds.org_id}/overrides`, { data: { feature: "ai_agents", mode: "enable", reason: "auto-upgrade" } })).status()).toBe(403);
    // E a página do admin manda embora.
    await page.goto("/admin/planos");
    await expect(page).toHaveURL(/\/admin\/forbidden/);
  });

  test("(1) o dono cria um plano só com Atendimento", async ({ page }) => {
    await loginComTotp(page, creds.users.dono!.email, creds.dono_totp!.secret);
    await page.goto("/admin/planos");
    await page.getByTestId("novo-plano").click();
    await page.locator("#slug").fill(SLUG);
    await page.locator("#name").fill(nomeDoPlano);
    // Canais vem marcado e travado; Atendimento é a única escolha.
    await expect(page.getByTestId("feature-channels")).toBeChecked();
    await expect(page.getByTestId("feature-channels")).toBeDisabled();
    await page.getByTestId("feature-inbox").check();
    await page.getByRole("button", { name: /criar plano/i }).click();
    await expect(page.getByText(/plano criado/i)).toBeVisible({ timeout: 15_000 });
    const linha = page.getByTestId(`plano-${SLUG}`);
    await expect(linha).toBeVisible();
    await expect(linha).toContainText("Atendimento");
    await expect(linha).not.toContainText("CRM");
    await page.screenshot({ path: ".superpowers/evidence/planos-1-catalogo.png", fullPage: true });
  });

  test("(2) o dono atribui o plano à organização do cliente", async ({ page }) => {
    await loginComTotp(page, creds.users.dono!.email, creds.dono_totp!.secret);
    await page.goto(`/admin/tenants/${creds.org_id}/plano`);
    await expect(page.getByTestId("plano-atual")).toContainText("Legado");
    await page.getByTestId("seletor-de-plano").selectOption({ label: nomeDoPlano });
    await page.getByTestId("motivo-do-plano").fill("e2e: contrato Starter");
    await page.getByTestId("atribuir-plano").click();
    await expect(page.getByText(/plano atribuído/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("plano-atual")).toContainText(nomeDoPlano);
    const efetivo = page.getByTestId("tabela-efetivo");
    await expect(efetivo.locator('[data-recurso="crm"]')).toHaveAttribute("data-efetivo", "nao");
    await expect(efetivo.locator('[data-recurso="inbox"]')).toHaveAttribute("data-efetivo", "sim");
    await expect(efetivo.locator('[data-recurso="channels"]')).toHaveAttribute("data-efetivo", "sim");
    await page.screenshot({ path: ".superpowers/evidence/planos-2-aba-plano.png", fullPage: true });
  });

  test("(3) o cliente perde o que o plano não tem — no menu, na URL digitada, na API e no Billing", async ({ page }) => {
    await loginComTotp(page, creds.users.admin!.email, creds.admin_totp!.secret);
    await page.goto("/app/inbox");
    const nav = page.getByRole("navigation", { name: /navegação principal/i });
    await expect(nav.getByRole("link", { name: /^inbox$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /funis/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /^agentes$/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /desempenho/i })).toHaveCount(0);
    await page.screenshot({ path: ".superpowers/evidence/planos-3-menu-starter.png", fullPage: true });

    await page.goto("/app/kanban");
    await expect(page).toHaveURL(/\/app\/recurso-indisponivel\?recurso=crm/);
    await expect(page.getByTestId("recurso-indisponivel")).toContainText(/CRM/);
    await page.screenshot({ path: ".superpowers/evidence/planos-3-recurso-indisponivel.png", fullPage: true });

    // A parede: a API recusa mesmo com o cookie de sessão válido.
    const resposta = await page.request.get("/api/v1/pipelines");
    expect(resposta.status()).toBe(403);
    const corpo = (await resposta.json()) as { error: { code: string; details?: { feature?: string } } };
    expect(corpo.error.code).toBe("feature_not_entitled");
    expect(corpo.error.details?.feature).toBe("crm");
    // …e o que o plano tem continua respondendo.
    expect((await page.request.get("/api/v1/conversations/counts")).status()).toBe(200);

    await page.goto("/app/settings/billing");
    await expect(page.getByTestId("plano-nome")).toContainText(nomeDoPlano);
    const lista = page.getByTestId("lista-de-recursos");
    await expect(lista.locator('[data-recurso="crm"]')).toHaveAttribute("data-ligado", "nao");
    await expect(lista.locator('[data-recurso="inbox"]')).toHaveAttribute("data-ligado", "sim");
    await expect(lista.locator('[data-recurso="channels"]')).toHaveAttribute("data-ligado", "sim");
    await page.screenshot({ path: ".superpowers/evidence/planos-3-billing.png", fullPage: true });
  });

  test("(4) o dono libera IA por 30 dias e o cliente vê o grupo voltar, com prazo", async ({ page, browser }) => {
    await loginComTotp(page, creds.users.dono!.email, creds.dono_totp!.secret);
    await page.goto(`/admin/tenants/${creds.org_id}/plano`);
    const form = page.getByTestId("novo-override");
    await form.locator("#ov-feature").selectOption("ai_agents");
    await form.locator("#ov-mode").selectOption("enable");
    const em30 = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const local = new Date(em30.getTime() - em30.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await page.getByTestId("override-ate").fill(local);
    await page.getByTestId("override-motivo").fill("e2e: teste de 30 dias");
    await page.getByTestId("criar-override").click();
    await expect(page.getByText(/liberação registrada/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tabela-efetivo").locator('[data-recurso="ai_agents"]')).toHaveAttribute("data-efetivo", "sim");
    await page.screenshot({ path: ".superpowers/evidence/planos-4-override.png", fullPage: true });

    const ctx = await browser.newContext();
    const cliente = await ctx.newPage();
    try {
      await loginComTotp(cliente, creds.users.admin!.email, creds.admin_totp!.secret);
      await cliente.goto("/app/inbox");
      await expect(cliente.getByRole("navigation", { name: /navegação principal/i }).getByRole("link", { name: /^agentes$/i })).toBeVisible();
      await cliente.goto("/app/settings/billing");
      const ia = cliente.getByTestId("lista-de-recursos").locator('[data-recurso="ai_agents"]');
      await expect(ia).toHaveAttribute("data-ligado", "sim");
      await expect(ia).toContainText(/liberado até/i);
      await cliente.screenshot({ path: ".superpowers/evidence/planos-4-cliente-com-ia.png", fullPage: true });
    } finally {
      await ctx.close();
    }
  });

  test("(5) o dono encerra a liberação e o cliente perde a IA de novo", async ({ page, browser }) => {
    await loginComTotp(page, creds.users.dono!.email, creds.dono_totp!.secret);
    await page.goto(`/admin/tenants/${creds.org_id}/plano`);
    const valendo = page.getByTestId("lista-de-overrides").locator('[data-ativo="sim"]').first();
    await valendo.getByRole("button", { name: /encerrar/i }).click();
    await valendo.getByPlaceholder(/motivo/i).fill("e2e: fim do teste");
    await valendo.getByRole("button", { name: /^encerrar$/i }).click();
    await expect(page.getByText(/liberação encerrada/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tabela-efetivo").locator('[data-recurso="ai_agents"]')).toHaveAttribute("data-efetivo", "nao");

    const ctx = await browser.newContext();
    const cliente = await ctx.newPage();
    try {
      await loginComTotp(cliente, creds.users.admin!.email, creds.admin_totp!.secret);
      await cliente.goto("/app/inbox");
      await expect(cliente.getByRole("navigation", { name: /navegação principal/i }).getByRole("link", { name: /^agentes$/i })).toHaveCount(0);
      await cliente.goto("/app/ai/agents");
      await expect(cliente).toHaveURL(/recurso-indisponivel\?recurso=ai_agents/);
    } finally {
      await ctx.close();
    }
  });
});
