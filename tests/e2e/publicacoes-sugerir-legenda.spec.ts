/**
 * Sugerir legenda (J31.11–J31.15) pela tela, com a API mockada: o que se prova
 * é a cadeia da tela — quando o botão liga, quando pergunta a rede, o que ele
 * manda (rede, formatos, ideia, imagens já subidas) e o "Usar" preenchendo o
 * campo. A chamada real ao modelo fica com a prova de recursos reais da spec 23
 * §7.1 (o CI não tem chave de IA).
 */
import { expect, test, type Page } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const SESSAO_WA = "02860000-0000-4000-8000-000000000001";
const SESSAO_IG = "02860000-0000-4000-8000-000000000002";
const GRUPO_1 = "02860000-0000-4000-8000-000000000011";
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const CONTAS = [
  { id: SESSAO_WA, network: "whatsapp", display_name: "WhatsApp Comercial", username: null, avatar_url: null, status: "WORKING", disponivel: true, publica_grupos: true },
  { id: SESSAO_IG, network: "instagram", display_name: "@nebo.demo", username: "nebo.demo", avatar_url: null, status: "WORKING", disponivel: true, publica_grupos: false },
];
const GRUPOS = [{ id: GRUPO_1, channel_session_id: SESSAO_WA, external_group_id: "120363000000000000@g.us", name: "Clientes VIP", is_active: true, last_seen_at: null, metadata: {} }];

const INSTRUCOES = [
  { network: "instagram", instructions: "Tom divertido, 3 hashtags.", personalizada: true, padrao: "padrão ig", updated_at: "2026-10-06T12:00:00Z" },
  { network: "facebook", instructions: "padrão fb", personalizada: false, padrao: "padrão fb", updated_at: null },
  { network: "whatsapp", instructions: "padrão wa", personalizada: false, padrao: "padrão wa", updated_at: null },
];

type Captura = { sugestoes: Array<Record<string, unknown>>; uploads: number; instrucoes: Array<Record<string, unknown>> };

async function mockarApi(page: Page, cap: Captura, sugestao: { status: number; body: unknown }) {
  let n = 0;
  await page.route("**/api/v1/publicacoes**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const m = route.request().method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data }) });
    if (p === "/api/v1/publicacoes/contas") return json(CONTAS);
    if (p === "/api/v1/publicacoes/media" && m === "POST") {
      cap.uploads += 1;
      n += 1;
      return json({ media: { kind: "image", storage_path: `org/publications/nova/${n}.png`, mime: "image/png", size_bytes: PNG_1PX.length, filename: `${n}.png` } }, 201);
    }
    if (p === "/api/v1/publicacoes/legenda/sugerir" && m === "POST") {
      cap.sugestoes.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: sugestao.status, contentType: "application/json", body: JSON.stringify(sugestao.body) });
    }
    if (p === "/api/v1/publicacoes/instrucoes-de-legenda" && m === "GET") return json(INSTRUCOES);
    if (p === "/api/v1/publicacoes/instrucoes-de-legenda" && m === "PUT") {
      const corpo = route.request().postDataJSON() as { network: string; instructions: string };
      cap.instrucoes.push(corpo);
      return json(INSTRUCOES.map((i) => (i.network === corpo.network ? { ...i, instructions: corpo.instructions, personalizada: true, updated_at: new Date().toISOString() } : i)));
    }
    return json([]);
  });
  await page.route("**/api/v1/agendamentos/grupos**", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { groups: GRUPOS } }) }));
}

const LEGENDA_OK = {
  data: { caption: "Coca gelada pra fechar a semana 🥤 Só hoje, 2L por R$ 9,99! #oferta #coca #sextou", network: "instagram", used_images: 2, ignored_videos: 0, personalizada: true, model: "claude", llm_call_id: "c1" },
};

test("duas redes: pergunta qual instrução, manda as imagens já subidas e o Usar preenche a legenda", async ({ page }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());
  const cap: Captura = { sugestoes: [], uploads: 0, instrucoes: [] };
  await mockarApi(page, cap, { status: 200, body: LEGENDA_OK });
  await page.goto("/app/publicacoes/agendar");
  await expect(page.getByRole("heading", { level: 1, name: "Agendar publicação" })).toBeVisible();

  // Sem rede e sem conteúdo o botão não liga, e diz por quê.
  await expect(page.getByTestId("sugerir-legenda")).toBeDisabled();
  await page.getByTestId("sugerir-legenda-bloqueado").hover();
  await expect(page.getByRole("tooltip")).toContainText("Marque pelo menos uma rede");

  await page.getByTestId("destino-instagram-feed").click();
  await page.getByTestId("destino-whatsapp-group_message").click();
  await page.getByRole("checkbox", { name: "Clientes VIP" }).click();
  await page.getByTestId("concluir-grupos").click();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: PNG_1PX },
    { name: "b.png", mimeType: "image/png", buffer: PNG_1PX },
  ]);
  await expect(page.getByTestId("anexo-2")).toBeVisible();
  await page.getByTestId("pub-legenda").fill("promo coca 2L 9,99");
  await page.screenshot({ path: ".superpowers/evidence/publicacoes/sugerir-legenda/01-antes.png", fullPage: true });

  await page.getByTestId("sugerir-legenda").click();
  const redes = page.getByTestId("sugerir-legenda-redes");
  await expect(redes).toBeVisible();
  await expect(redes.getByTestId("sugerir-legenda-rede-instagram")).toBeVisible();
  await expect(redes.getByTestId("sugerir-legenda-rede-whatsapp")).toBeVisible();
  await expect(redes.getByTestId("sugerir-legenda-rede-facebook")).toHaveCount(0);
  await page.screenshot({ path: ".superpowers/evidence/publicacoes/sugerir-legenda/02-qual-rede.png", fullPage: true });
  await redes.getByTestId("sugerir-legenda-rede-instagram").click();

  const painel = page.getByTestId("sugestao-de-legenda");
  await expect(painel).toBeVisible();
  await expect(page.getByTestId("sugestao-de-legenda-texto")).toContainText("Coca gelada");
  await expect(page.getByTestId("sugestao-de-legenda-nota")).toContainText("Instrução do Instagram");
  await expect(page.getByTestId("sugestao-de-legenda-nota")).toContainText("2 imagens lidas");
  await page.screenshot({ path: ".superpowers/evidence/publicacoes/sugerir-legenda/03-sugestao.png", fullPage: true });

  expect(cap.uploads).toBe(2);
  expect(cap.sugestoes).toHaveLength(1);
  expect(cap.sugestoes[0]).toMatchObject({ network: "instagram", formats: ["feed"], idea: "promo coca 2L 9,99", media_paths: ["org/publications/nova/1.png", "org/publications/nova/2.png"], ignored_videos: 0 });
  // O campo só muda no "Usar".
  await expect(page.getByTestId("pub-legenda")).toHaveValue("promo coca 2L 9,99");
  await page.getByTestId("sugestao-de-legenda-usar").click();
  await expect(page.getByTestId("pub-legenda")).toHaveValue(LEGENDA_OK.data.caption);
  await expect(painel).toBeHidden();
  await page.screenshot({ path: ".superpowers/evidence/publicacoes/sugerir-legenda/04-usada.png", fullPage: true });
});

test("uma rede só: gera direto, sem perguntar; modelo sem visão vira aviso com o caminho do conserto", async ({ page }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());
  const cap: Captura = { sugestoes: [], uploads: 0, instrucoes: [] };
  await mockarApi(page, cap, {
    status: 422,
    body: { error: { code: "modelo_sem_visao", message: "O modelo configurado para Legenda de publicação não lê imagens. Troque-o em IA › Provedores." } },
  });
  await page.goto("/app/publicacoes/agendar");
  await page.getByTestId("destino-instagram-feed").click();
  await page.locator('input[type="file"]').setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: PNG_1PX }]);
  await expect(page.getByTestId("anexo-1")).toBeVisible();

  await page.getByTestId("sugerir-legenda").click();
  await expect(page.getByTestId("sugerir-legenda-redes")).toHaveCount(0);
  const falha = page.getByTestId("sugestao-de-legenda-falha");
  await expect(falha).toContainText("não lê imagens");
  await expect(falha.getByRole("link", { name: "Abrir IA › Provedores" })).toHaveAttribute("href", "/app/ai/providers");
  expect(cap.sugestoes[0]).toMatchObject({ network: "instagram", media_paths: ["org/publications/nova/1.png"] });
  await page.screenshot({ path: ".superpowers/evidence/publicacoes/sugerir-legenda/05-sem-visao.png", fullPage: true });
});

test("Instruções de legenda: três redes, salvar e restaurar o padrão", async ({ page }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());
  const cap: Captura = { sugestoes: [], uploads: 0, instrucoes: [] };
  await mockarApi(page, cap, { status: 200, body: LEGENDA_OK });
  await page.goto("/app/publicacoes/instrucoes");
  await expect(page.getByRole("heading", { level: 1, name: "Instruções de legenda" })).toBeVisible();
  for (const rede of ["instagram", "facebook", "whatsapp"]) await expect(page.getByTestId(`instrucao-${rede}`)).toBeVisible();
  await expect(page.getByTestId("instrucao-instagram-origem")).toHaveText("Personalizada");
  await expect(page.getByTestId("instrucao-facebook-origem")).toHaveText("Padrão do produto");

  await expect(page.getByTestId("instrucao-facebook-salvar")).toBeDisabled();
  await page.getByTestId("instrucao-facebook-texto").fill("Tom de vizinho, sem hashtag.");
  await page.getByTestId("instrucao-facebook-salvar").click();
  await expect.poll(() => cap.instrucoes.length).toBe(1);
  expect(cap.instrucoes[0]).toEqual({ network: "facebook", instructions: "Tom de vizinho, sem hashtag." });
  await expect(page.getByTestId("instrucao-facebook-origem")).toHaveText("Personalizada");

  await page.getByTestId("instrucao-instagram-restaurar").click();
  await expect.poll(() => cap.instrucoes.length).toBe(2);
  expect(cap.instrucoes[1]).toEqual({ network: "instagram", instructions: "" });
  await page.screenshot({ path: ".superpowers/evidence/publicacoes/sugerir-legenda/06-instrucoes.png", fullPage: true });
});
