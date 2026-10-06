/**
 * Sugerir legenda (J31.11–J31.15) pela tela, com a API mockada: o que se prova
 * é a cadeia da tela — o prompt vem das CONTAS marcadas (Instagram e Facebook
 * da mesma empresa dividem um; outra empresa tem o seu; conta sem prompt usa o
 * padrão da rede), a tela só pergunta quando há mais de um, e manda o prompt,
 * os destinos que ele cobre, a ideia e as imagens já subidas. A chamada real ao
 * modelo fica com a prova de recursos reais da spec 23 §7.1 (o CI não tem chave).
 */
import { expect, test, type Page } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const IG_PADARIA = "02860000-0000-4000-8000-000000000001";
const FB_PADARIA = "02860000-0000-4000-8000-000000000002";
const IG_LOJA = "02860000-0000-4000-8000-000000000003";
const WA = "02860000-0000-4000-8000-000000000004";
const GRUPO_1 = "02860000-0000-4000-8000-000000000011";
const P_PADARIA = "02860000-0000-4000-8000-0000000000a1";
const P_LOJA = "02860000-0000-4000-8000-0000000000a2";
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const conta = (id: string, network: string, nome: string) => ({ id, network, display_name: nome, username: null, avatar_url: null, status: "WORKING", disponivel: true, publica_grupos: network === "whatsapp" });
const CONTAS = [conta(IG_PADARIA, "instagram", "@padaria"), conta(FB_PADARIA, "facebook", "Padaria Müller"), conta(IG_LOJA, "instagram", "@loja"), conta(WA, "whatsapp", "WhatsApp Comercial")];
const GRUPOS = [{ id: GRUPO_1, channel_session_id: WA, external_group_id: "120363000000000000@g.us", name: "Clientes VIP", is_active: true, last_seen_at: null, metadata: {} }];
const PADROES = { instagram: "padrão ig", facebook: "padrão fb", whatsapp: "padrão wa" };

type Prompt = { id: string; name: string; instructions: string; channel_session_ids: string[]; updated_at: string };
const promptsIniciais = (): Prompt[] => [
  { id: P_PADARIA, name: "Padaria", instructions: "Tom caloroso de padaria.", channel_session_ids: [IG_PADARIA, FB_PADARIA], updated_at: "2026-10-06T12:00:00Z" },
  { id: P_LOJA, name: "Loja", instructions: "Tom de loja de roupa.", channel_session_ids: [IG_LOJA], updated_at: "2026-10-06T12:00:00Z" },
];

type Captura = { sugestoes: Array<Record<string, unknown>>; uploads: number; escritas: Array<{ metodo: string; corpo: unknown }> };

async function mockarApi(page: Page, cap: Captura, sugestao: { status: number; body: unknown }) {
  let n = 0;
  let prompts = promptsIniciais();
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
    if (p === "/api/v1/publicacoes/prompts-de-legenda" && m === "GET") return json({ prompts, padroes: PADROES });
    if (p === "/api/v1/publicacoes/prompts-de-legenda" && m === "POST") {
      const corpo = route.request().postDataJSON() as Omit<Prompt, "id" | "updated_at">;
      cap.escritas.push({ metodo: "POST", corpo });
      const novo = { ...corpo, id: "02860000-0000-4000-8000-0000000000a3", updated_at: new Date().toISOString() };
      prompts = [...prompts.map((x) => ({ ...x, channel_session_ids: x.channel_session_ids.filter((c) => !corpo.channel_session_ids.includes(c)) })), novo];
      return json(novo, 201);
    }
    if (p.startsWith("/api/v1/publicacoes/prompts-de-legenda/") && m === "PATCH") {
      const id = p.split("/").pop()!;
      const corpo = route.request().postDataJSON() as Partial<Prompt>;
      cap.escritas.push({ metodo: "PATCH", corpo: { id, ...corpo } });
      prompts = prompts.map((x) =>
        x.id === id
          ? { ...x, ...corpo, updated_at: new Date().toISOString() }
          : { ...x, channel_session_ids: x.channel_session_ids.filter((c) => !(corpo.channel_session_ids ?? []).includes(c)) },
      );
      return json(prompts.find((x) => x.id === id));
    }
    if (p.startsWith("/api/v1/publicacoes/prompts-de-legenda/") && m === "DELETE") {
      const id = p.split("/").pop()!;
      cap.escritas.push({ metodo: "DELETE", corpo: { id } });
      prompts = prompts.filter((x) => x.id !== id);
      return json({ id });
    }
    return json([]);
  });
  await page.route("**/api/v1/agendamentos/grupos**", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { groups: GRUPOS } }) }));
}

const LEGENDA_OK = {
  data: {
    caption: "Cheirinho de pão quente 🥖 Cuca a R$ 8,99 só esta semana! #padaria #oferta",
    origem: { tipo: "prompt", prompt_id: P_PADARIA, nome: "Padaria" },
    used_images: 2,
    ignored_videos: 0,
    model: "claude",
    llm_call_id: "c1",
  },
};

async function abrirAgendar(page: Page) {
  await page.goto("/app/publicacoes/agendar");
  await expect(page.getByRole("heading", { level: 1, name: "Agendar publicação" })).toBeVisible();
}

/** Marca um destino de UMA conta: rede com várias contas abre a janela de contas; com uma, liga direto. */
async function marcarConta(page: Page, rede: "instagram" | "facebook", formato: string, contaId: string) {
  await page.getByTestId(`destino-${rede}-${formato}`).click();
  const janela = page.getByTestId("dialogo-de-contas");
  const abriu = await janela.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false);
  if (abriu) {
    await page.getByTestId(`conta-${contaId}`).click();
    await page.getByTestId("concluir-contas").click();
    await expect(janela).toBeHidden();
  }
  await expect(page.getByTestId(`destino-${rede}-${formato}`)).toHaveAttribute("aria-checked", "true");
}

test("Instagram + Facebook da mesma empresa: um prompt só, gera direto e o Usar preenche", async ({ page }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());
  const cap: Captura = { sugestoes: [], uploads: 0, escritas: [] };
  await mockarApi(page, cap, { status: 200, body: LEGENDA_OK });
  await abrirAgendar(page);

  await expect(page.getByTestId("sugerir-legenda")).toBeDisabled();
  await marcarConta(page, "instagram", "feed", IG_PADARIA);
  await marcarConta(page, "facebook", "feed", FB_PADARIA);
  await page.locator('input[type="file"]').setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: PNG_1PX },
    { name: "b.png", mimeType: "image/png", buffer: PNG_1PX },
  ]);
  await expect(page.getByTestId("anexo-2")).toBeVisible();
  await page.getByTestId("pub-legenda").fill("cuca 8,99");

  await page.getByTestId("sugerir-legenda").click();
  await expect(page.getByTestId("sugerir-legenda-prompts")).toHaveCount(0);
  await expect(page.getByTestId("sugestao-de-legenda-texto")).toContainText("Cheirinho de pão");
  await expect(page.getByTestId("sugestao-de-legenda-nota")).toContainText("Prompt “Padaria”");
  await page.screenshot({ path: ".superpowers/evidence/publicacoes/sugerir-legenda/01-mesma-empresa.png", fullPage: true });

  expect(cap.uploads).toBe(2);
  expect(cap.sugestoes[0]).toMatchObject({
    prompt_id: P_PADARIA,
    destinos: [
      { network: "instagram", format: "feed" },
      { network: "facebook", format: "feed" },
    ],
    idea: "cuca 8,99",
    media_paths: ["org/publications/nova/1.png", "org/publications/nova/2.png"],
  });
  expect(cap.sugestoes[0]).not.toHaveProperty("network");
  await expect(page.getByTestId("pub-legenda")).toHaveValue("cuca 8,99");
  await page.getByTestId("sugestao-de-legenda-usar").click();
  await expect(page.getByTestId("pub-legenda")).toHaveValue(LEGENDA_OK.data.caption);
});

test("contas de empresas diferentes + WhatsApp sem prompt: pergunta qual usar", async ({ page }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());
  const cap: Captura = { sugestoes: [], uploads: 0, escritas: [] };
  await mockarApi(page, cap, { status: 200, body: LEGENDA_OK });
  await abrirAgendar(page);

  await marcarConta(page, "instagram", "feed", IG_LOJA);
  await marcarConta(page, "facebook", "feed", FB_PADARIA);
  await page.getByTestId("destino-whatsapp-group_message").click();
  await page.getByRole("checkbox", { name: "Clientes VIP" }).click();
  await page.getByTestId("concluir-grupos").click();
  await page.locator('input[type="file"]').setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: PNG_1PX }]);
  await expect(page.getByTestId("anexo-1")).toBeVisible();

  await page.getByTestId("sugerir-legenda").click();
  const opcoes = page.getByTestId("sugerir-legenda-prompts");
  await expect(opcoes).toBeVisible();
  await expect(opcoes.getByTestId(`sugerir-legenda-opcao-prompt:${P_LOJA}`)).toContainText("Loja");
  await expect(opcoes.getByTestId(`sugerir-legenda-opcao-prompt:${P_LOJA}`)).toContainText("@loja");
  await expect(opcoes.getByTestId(`sugerir-legenda-opcao-prompt:${P_PADARIA}`)).toContainText("Padaria Müller");
  await expect(opcoes.getByTestId("sugerir-legenda-opcao-padrao:whatsapp")).toContainText("Padrão do WhatsApp");
  await page.screenshot({ path: ".superpowers/evidence/publicacoes/sugerir-legenda/02-qual-prompt.png", fullPage: true });

  await opcoes.getByTestId("sugerir-legenda-opcao-padrao:whatsapp").click();
  await expect.poll(() => cap.sugestoes.length).toBe(1);
  expect(cap.sugestoes[0]).toMatchObject({ network: "whatsapp", destinos: [{ network: "whatsapp", format: "group_message" }] });
  expect(cap.sugestoes[0]).not.toHaveProperty("prompt_id");
});

test("modelo sem visão vira aviso com o caminho do conserto", async ({ page }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());
  const cap: Captura = { sugestoes: [], uploads: 0, escritas: [] };
  await mockarApi(page, cap, {
    status: 422,
    body: { error: { code: "modelo_sem_visao", message: "O modelo configurado para Legenda de publicação não lê imagens. Troque-o em IA › Provedores." } },
  });
  await abrirAgendar(page);
  await marcarConta(page, "instagram", "feed", IG_LOJA);
  await page.locator('input[type="file"]').setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: PNG_1PX }]);
  await expect(page.getByTestId("anexo-1")).toBeVisible();
  await page.getByTestId("sugerir-legenda").click();
  const falha = page.getByTestId("sugestao-de-legenda-falha");
  await expect(falha).toContainText("não lê imagens");
  await expect(falha.getByRole("link", { name: "Abrir IA › Provedores" })).toHaveAttribute("href", "/app/ai/providers");
});

test("Prompts de legenda: criar, ligar contas (movendo de outro prompt) e apagar", async ({ page }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());
  const cap: Captura = { sugestoes: [], uploads: 0, escritas: [] };
  await mockarApi(page, cap, { status: 200, body: LEGENDA_OK });
  await page.goto("/app/publicacoes/prompts");
  await expect(page.getByRole("heading", { level: 1, name: "Prompts de legenda" })).toBeVisible();
  await expect(page.getByTestId(`prompt-${P_PADARIA}`)).toBeVisible();
  await expect(page.getByTestId(`prompt-${P_PADARIA}-conta-${IG_PADARIA}`)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("padroes-das-redes")).toContainText("WhatsApp Comercial");

  await page.getByTestId("novo-prompt").click();
  await page.getByTestId("prompt-novo-nome").fill("Grupos");
  await page.getByTestId("prompt-novo-texto").fill("Curto, com *negrito*.");
  await page.getByTestId(`prompt-novo-conta-${WA}`).click();
  // A conta @loja é do prompt "Loja": marcá-la aqui a move.
  await expect(page.getByTestId(`prompt-novo-conta-${IG_LOJA}`)).toContainText("Loja");
  await page.getByTestId(`prompt-novo-conta-${IG_LOJA}`).click();
  await page.getByTestId("prompt-novo-salvar").click();
  await expect.poll(() => cap.escritas.length).toBe(1);
  expect(cap.escritas[0]).toEqual({ metodo: "POST", corpo: { name: "Grupos", instructions: "Curto, com *negrito*.", channel_session_ids: [WA, IG_LOJA] } });
  await expect(page.getByTestId(`prompt-${P_LOJA}-conta-${IG_LOJA}`)).toHaveAttribute("aria-checked", "false");
  await page.screenshot({ path: ".superpowers/evidence/publicacoes/sugerir-legenda/03-prompts.png", fullPage: true });

  await page.getByTestId(`prompt-${P_LOJA}-apagar`).click();
  await page.getByTestId(`prompt-${P_LOJA}-apagar-confirmar`).click();
  await expect.poll(() => cap.escritas.length).toBe(2);
  expect(cap.escritas[1]).toEqual({ metodo: "DELETE", corpo: { id: P_LOJA } });
  await expect(page.getByTestId(`prompt-${P_LOJA}`)).toHaveCount(0);
});
