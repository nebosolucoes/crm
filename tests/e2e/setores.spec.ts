import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

/**
 * SETORES DE ATENDIMENTO — a jornada como o dono a usaria (spec 20, fase 4).
 *
 * Org própria e isolada (estilo `roteamento-por-canal.spec.ts`): uma gestora,
 * duas atendentes (Ana no Financeiro, Bruno no Comercial), duas conversas.
 *
 *   [P0] a gestora cria os dois setores pela tela e põe cada atendente no seu;
 *   [P0] Ana só vê a conversa do Financeiro; a do Comercial não aparece para ela;
 *   [P0] Bruno transfere a dele para o Financeiro pelo diálogo: ela passa a
 *        aparecer para Ana e, pela passagem de bastão, continua com Bruno até
 *        Ana responder.
 *
 * O banco é a autoridade nas asserções de estado (sector_id, handover); a tela
 * é a autoridade no que a pessoa vê.
 */
const credentials = credenciaisSupabaseDeTeste();
const db = createClient(credentials.url, credentials.serviceRole, { auth: { persistSession: false } });
const evidence = ".superpowers/evidence/setores";

test.use({ trace: "on" });
test.describe.configure({ timeout: 240_000 });

const SENHA = "Setores!2026";

async function criarUsuario(nome: string): Promise<{ id: string; email: string }> {
  const email = `${nome.toLowerCase()}-${randomUUID().slice(0, 8)}@setores.test`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { full_name: nome },
  });
  if (error || !data.user) throw error ?? new Error("usuario_nao_criado");
  return { id: data.user.id, email };
}

async function insert(table: string, value: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.from(table).insert(value).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/senha/i).fill(SENHA);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
}

test("setores: criar pela tela, ver só o seu, transferir para outro setor com passagem de bastão", async ({ browser }) => {
  mkdirSync(evidence, { recursive: true });
  const org = randomUUID();
  const gestora = await criarUsuario("Gestora");
  const ana = await criarUsuario("Ana");
  const bruno = await criarUsuario("Bruno");
  const usuarios = [gestora, ana, bruno];
  try {
    await db.from("organizations").insert({
      id: org,
      slug: `setores-${org.slice(0, 8)}`,
      display_name: "Setores E2E",
      legal_name: "Setores E2E Ltda",
      onboarded_at: new Date().toISOString(),
      settings: { routing: { mode: "manual" }, visibility_mode: "own_and_unassigned" },
    });
    for (const [u, role] of [[gestora, "manager"], [ana, "agent"], [bruno, "agent"]] as const) {
      await db.from("user_organizations").insert({ organization_id: org, user_id: u.id, role, accepted_at: new Date().toISOString() });
      await db.from("attendant_availability").insert({ organization_id: org, user_id: u.id, is_available: true, capacity: 5, schedule: {} });
    }
    const canal = await insert("channel_sessions", {
      organization_id: org,
      waha_session_name: `setores-${org.slice(0, 8)}`,
      display_name: "Número E2E",
      webhook_secret_encrypted: "\\x00",
    });

    // ── [P0] A gestora cria os setores e escolhe quem atende ──────────────
    const ctxGestora = await browser.newContext();
    const pg = await ctxGestora.newPage();
    await login(pg, gestora.email);
    await pg.goto("/app/settings/setores");
    await expect(pg.getByRole("heading", { name: "Setores de atendimento" })).toBeVisible();

    for (const [nome, descricao] of [
      ["Financeiro", "boletos, segunda via, reembolso"],
      ["Comercial", "orçamento, proposta, preço"],
    ] as const) {
      await pg.getByLabel("Nome", { exact: true }).first().fill(nome);
      await pg.getByLabel("Quando mandar para cá (a IA lê isto)").first().fill(descricao);
      await pg.getByRole("button", { name: "Criar setor" }).click();
      await expect(pg.getByRole("group", { name: new RegExp(`^${nome}`) })).toBeVisible();
    }
    // Espera a RESPOSTA do PUT, não o toast: o toast do primeiro salvamento ainda
    // está na tela quando o segundo dispara, e o texto é o mesmo.
    const salvarMembros = async (grupo: ReturnType<typeof pg.getByRole>, nome: string) => {
      await grupo.getByLabel(nome).check();
      const resposta = pg.waitForResponse((r) => r.url().includes("/members") && r.request().method() === "PUT");
      await grupo.getByRole("button", { name: "Salvar membros" }).click();
      expect((await resposta).status()).toBe(200);
    };
    await salvarMembros(pg.getByRole("group", { name: /^Financeiro/ }), "Ana");
    await salvarMembros(pg.getByRole("group", { name: /^Comercial/ }), "Bruno");
    await expect(pg.getByText("Membros do setor salvos.").first()).toBeVisible();
    await pg.screenshot({ path: `${evidence}/01-setores-criados.png`, fullPage: true });

    const { data: setores } = await db.from("sectors").select("id, slug").eq("organization_id", org);
    const idFin = setores!.find((s) => s.slug === "financeiro")!.id as string;
    const idCom = setores!.find((s) => s.slug === "comercial")!.id as string;
    const { data: membros } = await db.from("sector_members").select("sector_id, user_id").eq("organization_id", org);
    expect(membros).toEqual(expect.arrayContaining([
      { sector_id: idFin, user_id: ana.id },
      { sector_id: idCom, user_id: bruno.id },
    ]));
    await ctxGestora.close();

    // ── Duas conversas, uma em cada setor (a do Comercial já com Bruno) ─────
    const contatoFin = await insert("contacts", { organization_id: org, display_name: "Cliente do Boleto", phone_number: "+5511999990001" });
    const contatoCom = await insert("contacts", { organization_id: org, display_name: "Cliente do Orçamento", phone_number: "+5511999990002" });
    const convFin = await insert("conversations", { organization_id: org, contact_id: contatoFin, channel_session_id: canal, status: "open", sector_id: idFin, last_inbound_at: new Date().toISOString() });
    const convCom = await insert("conversations", {
      organization_id: org, contact_id: contatoCom, channel_session_id: canal, status: "claimed", sector_id: idCom,
      assigned_to_user_id: bruno.id, assigned_at: new Date().toISOString(), last_inbound_at: new Date().toISOString(),
    });
    for (const [conv, contato, texto] of [[convFin, contatoFin, "quero a segunda via do boleto"], [convCom, contatoCom, "quanto custa o plano?"]] as const) {
      await insert("messages", { organization_id: org, conversation_id: conv, channel_session_id: canal, contact_id: contato, type: "text", direction: "inbound", status: "received", body: texto });
    }

    // ── [P0] Ana (Financeiro) vê a sua e não vê a do Comercial ──────────────
    const ctxAna = await browser.newContext();
    const pa = await ctxAna.newPage();
    await login(pa, ana.email);
    await pa.goto("/app/inbox");
    await expect(pa.getByText("Cliente do Boleto")).toBeVisible();
    await expect(pa.getByText("Cliente do Orçamento")).toHaveCount(0);
    await expect(pa.locator("[data-testid='chip-setor']", { hasText: "Financeiro" }).first()).toBeVisible();
    await pa.screenshot({ path: `${evidence}/02-ana-so-ve-financeiro.png`, fullPage: true });

    // ── [P0] Bruno transfere a dele para o Financeiro pelo diálogo ──────────
    const ctxBruno = await browser.newContext();
    const pb = await ctxBruno.newPage();
    await login(pb, bruno.email);
    await pb.goto(`/app/inbox/${convCom}`);
    await pb.getByRole("button", { name: /transferir/i }).first().click();
    await pb.getByRole("tab", { name: "Para um setor" }).click();
    await pb.getByRole("combobox", { name: /setor de destino/i }).click();
    await pb.getByRole("option", { name: "Financeiro" }).click();
    // A resposta da rota é a prova; o toast some sozinho e o servidor de dev
    // compila a rota na primeira chamada.
    const transferido = pb.waitForResponse((r) => r.url().includes("/transfer") && r.request().method() === "POST", { timeout: 120_000 });
    await pb.getByRole("button", { name: "Transferir", exact: true }).click();
    expect((await transferido).status()).toBe(200);
    await expect(pb.getByRole("dialog", { name: "Transferir conversa" })).toHaveCount(0);
    await pb.screenshot({ path: `${evidence}/03-bruno-transferiu-para-financeiro.png`, fullPage: true });

    const { data: depois } = await db.from("conversations").select("sector_id, assigned_to_user_id, handover_from_user_id, status").eq("id", convCom).single();
    expect(depois).toMatchObject({ sector_id: idFin, assigned_to_user_id: null, handover_from_user_id: bruno.id, status: "pending" });

    // Passagem de bastão: Bruno ainda vê; Ana passou a ver.
    await pb.goto("/app/inbox");
    await expect(pb.getByText("Cliente do Orçamento")).toBeVisible();
    await pa.goto("/app/inbox");
    await expect(pa.getByText("Cliente do Orçamento")).toBeVisible();
    await pa.screenshot({ path: `${evidence}/04-ana-recebeu-a-transferida.png`, fullPage: true });

    // Ana assume e responde: a passagem termina e Bruno deixa de ver.
    await db.rpc("fn_conversation_assign", { p_organization_id: org, p_conversation_id: convCom, p_to_user_id: ana.id, p_reason: "claim" });
    await insert("messages", { organization_id: org, conversation_id: convCom, channel_session_id: canal, contact_id: contatoCom, type: "text", direction: "outbound", status: "sent", body: "Oi, aqui é do financeiro", sent_via: "crm", sent_by_user_id: ana.id });
    const { data: fim } = await db.from("conversations").select("handover_from_user_id").eq("id", convCom).single();
    expect(fim!.handover_from_user_id).toBeNull();
    await pb.goto("/app/inbox");
    await expect(pb.getByText("Cliente do Orçamento")).toHaveCount(0);
    await pb.screenshot({ path: `${evidence}/05-bruno-deixou-de-ver.png`, fullPage: true });

    await ctxAna.close();
    await ctxBruno.close();
  } finally {
    await db.from("organizations").delete().eq("id", org);
    for (const u of usuarios) await db.auth.admin.deleteUser(u.id);
  }
});
