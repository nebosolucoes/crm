/**
 * Publicações pela tela, com a API mockada (o que se prova é a cadeia da tela
 * e o contrato que ela manda) — o mesmo recorte do spec do Disparo que este
 * substitui. Cobre J31.1, J31.2 (pré-checagem), J31.7 e J31.8 do mapa de
 * jornadas; o envio real fica com a prova de recursos reais da spec 23.
 */
import { expect, test } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const SESSAO_WA = "02830000-0000-4000-8000-000000000001";
const SESSAO_IG = "02830000-0000-4000-8000-000000000002";
const GRUPO_1 = "02830000-0000-4000-8000-000000000011";
const GRUPO_2 = "02830000-0000-4000-8000-000000000012";
const PUB = "02830000-0000-4000-8000-000000000021";
const OCC_1 = "02830000-0000-4000-8000-000000000031";
const OCC_2 = "02830000-0000-4000-8000-000000000032";
const OCC_DONE = "02830000-0000-4000-8000-000000000033";
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

// A primeira data é HOJE, daqui a 2 h (fica no mês corrente do calendário); a
// segunda é amanhã. O rótulo do dia e a hora são lidos no fuso de São Paulo, o
// mesmo que a tela usa — a máquina que roda o teste pode estar em outro fuso.
const amanha = new Date(Date.now() + 2 * 60 * 60 * 1000);
amanha.setUTCSeconds(0, 0);
const depois = new Date(amanha.getTime() + 24 * 60 * 60 * 1000);
const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
const HORA_SP = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }).format(amanha);

const CONTAS = [
  { id: SESSAO_WA, network: "whatsapp", display_name: "WhatsApp Comercial", username: null, avatar_url: null, status: "WORKING", disponivel: true, publica_grupos: true },
  { id: SESSAO_IG, network: "instagram", display_name: "@nebo.demo", username: "nebo.demo", avatar_url: null, status: "WORKING", disponivel: true, publica_grupos: false },
];
const GRUPOS = [
  { id: GRUPO_1, channel_session_id: SESSAO_WA, external_group_id: "120363000000000000@g.us", name: "Clientes VIP", is_active: true, last_seen_at: null, metadata: { participant_count: 42 } },
  { id: GRUPO_2, channel_session_id: SESSAO_WA, external_group_id: "120363000000000001@g.us", name: "Ofertas da Semana", is_active: true, last_seen_at: null, metadata: { participant_count: 120 } },
];
const targets = [
  { id: "t-wa", network: "whatsapp", format: "group_message", channel_session_id: SESSAO_WA, display_name: "WhatsApp Comercial", group_count: 2, removido: false },
  { id: "t-ig", network: "instagram", format: "feed", channel_session_id: SESSAO_IG, display_name: "@nebo.demo", group_count: 0, removido: false },
  { id: "t-st", network: "instagram", format: "story", channel_session_id: SESSAO_IG, display_name: "@nebo.demo", group_count: 0, removido: false },
];
const ocorrencia = (id: string, quando: Date, status: string, executions = { total: 0, sent: 0, failed: 0, pending: 0, sending: 0, skipped: 0, cancelled: 0 }) => ({
  id,
  publication_id: PUB,
  scheduled_at: quando.toISOString(),
  source: "manual",
  status,
  skipped_reason: null,
  processed_at: null,
  finished_at: null,
  title: "Oferta Coca-Cola",
  body: "Coca-Cola 2L por R$ 9,99 só hoje!",
  timezone: "America/Sao_Paulo",
  publication_status: "scheduled",
  recurrence_kind: "none",
  recurrence_config: {},
  thumb: { storage_path: "org/publications/x/a.jpg", kind: "image", mime: "image/jpeg" },
  media_count: 3,
  targets,
  executions,
});
const PENDENTES = [ocorrencia(OCC_1, amanha, "pending"), ocorrencia(OCC_2, depois, "pending")];
const FEITA = ocorrencia(OCC_DONE, ontem, "partial", { total: 4, sent: 3, failed: 1, pending: 0, sending: 0, skipped: 0, cancelled: 0 });

const publicacao = {
  id: PUB,
  organization_id: "org",
  title: "Oferta Coca-Cola",
  body: "Coca-Cola 2L por R$ 9,99 só hoje!",
  status: "scheduled",
  timezone: "America/Sao_Paulo",
  recurrence: { kind: "none", config: {}, repeat_until: null, max_occurrences: null },
  created_by: null,
  created_at: ontem.toISOString(),
  updated_at: ontem.toISOString(),
  cancelled_at: null,
  cancel_reason: null,
  deleted_at: null,
  media: [
    { id: "m1", position: 1, kind: "image", storage_path: "org/publications/x/a.jpg", mime: "image/jpeg", size_bytes: 100, filename: "a.jpg", width: 1080, height: 1350, duration_ms: null, cover_storage_path: null },
    { id: "m2", position: 2, kind: "image", storage_path: "org/publications/x/b.jpg", mime: "image/jpeg", size_bytes: 100, filename: "b.jpg", width: 1080, height: 1350, duration_ms: null, cover_storage_path: null },
    { id: "m3", position: 3, kind: "image", storage_path: "org/publications/x/c.jpg", mime: "image/jpeg", size_bytes: 100, filename: "c.jpg", width: 1080, height: 1350, duration_ms: null, cover_storage_path: null },
  ],
  targets: [
    { id: "t-wa", network: "whatsapp", format: "group_message", channel_session_id: SESSAO_WA, settings: {}, removido: false, group_ids: [GRUPO_1, GRUPO_2], display_name: "WhatsApp Comercial", groups: [{ id: GRUPO_1, name: "Clientes VIP", external_group_id: "1@g.us", is_active: true }, { id: GRUPO_2, name: "Ofertas da Semana", external_group_id: "2@g.us", is_active: true }] },
    { id: "t-ig", network: "instagram", format: "feed", channel_session_id: SESSAO_IG, settings: {}, removido: false, group_ids: [], display_name: "@nebo.demo", groups: [] },
    { id: "t-st", network: "instagram", format: "story", channel_session_id: SESSAO_IG, settings: {}, removido: false, group_ids: [], display_name: "@nebo.demo", groups: [] },
  ],
  occurrences: [
    { id: OCC_1, scheduled_at: amanha.toISOString(), source: "manual", status: "pending", skipped_reason: null, processed_at: null, finished_at: null },
    { id: OCC_2, scheduled_at: depois.toISOString(), source: "manual", status: "pending", skipped_reason: null, processed_at: null, finished_at: null },
  ],
};
const EXECUCOES_DA_FEITA = [
  { id: "e1", target_id: "t-wa", group_id: GRUPO_1, media_id: null, position: 1, attempt: 1, status: "sent", external_post_id: "true_1@g.us_ABC", external_url: null, provider_status: null, error_code: null, error_category: null, error_message: null, retry_at: null, started_at: null, finished_at: ontem.toISOString(), created_at: ontem.toISOString(), group_name: "Clientes VIP" },
  { id: "e2", target_id: "t-wa", group_id: GRUPO_2, media_id: null, position: 2, attempt: 1, status: "failed", external_post_id: null, external_url: null, provider_status: null, error_code: "group_inactive", error_category: "permanente", error_message: "grupo desativado", retry_at: null, started_at: null, finished_at: ontem.toISOString(), created_at: ontem.toISOString(), group_name: "Ofertas da Semana" },
  { id: "e3", target_id: "t-ig", group_id: null, media_id: null, position: 0, attempt: 1, status: "sent", external_post_id: "post-1", external_url: "https://instagram.com/p/x", provider_status: "published", error_code: null, error_category: null, error_message: null, retry_at: null, started_at: null, finished_at: ontem.toISOString(), created_at: ontem.toISOString(), group_name: null },
  { id: "e4", target_id: "t-st", group_id: null, media_id: "m1", position: 1, attempt: 1, status: "sent", external_post_id: "post-2", external_url: null, provider_status: "published", error_code: null, error_category: null, error_message: null, retry_at: null, started_at: null, finished_at: ontem.toISOString(), created_at: ontem.toISOString(), group_name: null },
];

async function mockarApi(page: import("@playwright/test").Page, capturar: { criadas: unknown[]; reagendadas: unknown[] }) {
  await page.route("**/api/v1/publicacoes**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const m = route.request().method();
    const json = (data: unknown, meta?: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(meta ? { data, meta } : { data }) });
    if (p === "/api/v1/publicacoes/contas") return json(CONTAS);
    if (p === "/api/v1/publicacoes/ocorrencias") {
      const incluir = url.searchParams.get("incluir");
      return json(incluir === "todas" ? [...PENDENTES, FEITA] : PENDENTES);
    }
    if (p === `/api/v1/publicacoes/ocorrencias/${OCC_1}` && m === "GET") return json({ occurrence: PENDENTES[0], publication: publicacao, executions: [] });
    if (p === `/api/v1/publicacoes/ocorrencias/${OCC_DONE}` && m === "GET") return json({ occurrence: FEITA, publication: publicacao, executions: EXECUCOES_DA_FEITA });
    if (p.startsWith("/api/v1/publicacoes/ocorrencias/") && m === "PATCH") {
      capturar.reagendadas.push(route.request().postDataJSON());
      return json({ ...PENDENTES[0], scheduled_at: (route.request().postDataJSON() as { scheduled_at: string }).scheduled_at });
    }
    if (p === "/api/v1/publicacoes/historico") return json([FEITA], { has_more: false });
    if (p === "/api/v1/publicacoes/media/url") return json({ url: "data:image/png;base64," + PNG_1PX.toString("base64"), expires_in: 600 });
    if (p === "/api/v1/publicacoes/media" && m === "POST") return json({ media: { kind: "image", storage_path: "org/publications/nova/x.png", mime: "image/png", size_bytes: PNG_1PX.length, filename: "foto.png" } }, undefined, 201);
    if (p === "/api/v1/publicacoes" && m === "POST") {
      capturar.criadas.push(route.request().postDataJSON());
      return json(publicacao, undefined, 201);
    }
    if (p === "/api/v1/publicacoes" && m === "GET") return json([]);
    return json([]);
  });
  // O contrato real da rota de grupos: a lista vem embrulhada em `groups`.
  await page.route("**/api/v1/agendamentos/grupos**", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { groups: GRUPOS } }) }));
}

test("Lista: só o pendente, por dia, com chips por rede, '1 de 2' e o Sheet com destinos", async ({ page }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());
  const capturar = { criadas: [] as unknown[], reagendadas: [] as unknown[] };
  await mockarApi(page, capturar);
  await page.goto("/app/publicacoes/lista");
  await expect(page.getByRole("heading", { level: 1, name: "Publicações" })).toBeVisible();
  await expect(page.getByText(/^(Hoje|Amanhã)$/).first()).toBeVisible();
  const cartao = page.getByTestId(`ocorrencia-${OCC_1}`);
  await expect(cartao).toBeVisible();
  await expect(cartao).toContainText(HORA_SP);
  await expect(cartao).toContainText("1 de 2");
  await expect(cartao).toContainText("2 grupos");
  await expect(cartao).toContainText("Stories");
  // O que já saiu NÃO está na Lista.
  await expect(page.getByTestId(`ocorrencia-${OCC_DONE}`)).toHaveCount(0);

  await cartao.click();
  const sheet = page.getByTestId("sheet-da-ocorrencia");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Oferta Coca-Cola");
  await expect(sheet).toContainText("Clientes VIP");
  await expect(sheet).toContainText("Ofertas da Semana");
  await expect(sheet.getByRole("button", { name: "Alterar horário" })).toBeVisible();

  // Alterar horário muda SÓ esta ocorrência: o PATCH vai para /ocorrencias/{id}.
  await sheet.getByRole("button", { name: "Alterar horário" }).click();
  const input = page.getByLabel("Nova data e hora");
  await expect(input).toBeVisible();
  await input.fill("2030-01-15T10:00");
  await page.getByRole("button", { name: "Salvar horário" }).click();
  await expect.poll(() => capturar.reagendadas.length).toBe(1);
  expect((capturar.reagendadas[0] as { scheduled_at: string }).scheduled_at).toBe("2030-01-15T13:00:00.000Z"); // 10:00 em São Paulo
});

test("Agendar: 2 arquivos, WhatsApp com 2 grupos, Instagram Feed + Stories, 2 datas → UM POST com tudo", async ({ page }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());
  const capturar = { criadas: [] as unknown[], reagendadas: [] as unknown[] };
  await mockarApi(page, capturar);
  await page.goto("/app/publicacoes/agendar");
  await expect(page.getByRole("heading", { level: 1, name: "Agendar publicação" })).toBeVisible();

  await page.getByTestId("pub-titulo").fill("Oferta Coca-Cola");
  await page.getByTestId("pub-legenda").fill("Coca-Cola 2L por R$ 9,99 só hoje!");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: PNG_1PX },
    { name: "b.png", mimeType: "image/png", buffer: PNG_1PX },
  ]);
  await expect(page.getByTestId("anexo-2")).toBeVisible();

  await page.getByTestId("destino-whatsapp-group_message").click();
  await page.getByRole("checkbox", { name: "Clientes VIP" }).click();
  await page.getByRole("checkbox", { name: "Ofertas da Semana" }).click();
  await expect(page.getByText("2 grupos selecionados")).toBeVisible();
  await page.getByTestId("destino-instagram-feed").click();
  await page.getByTestId("destino-instagram-story").click();
  // Reels com foto reprova na hora (regra por formato), e o erro aparece no card.
  await page.getByTestId("destino-instagram-reel").click();
  await expect(page.getByTestId("rede-instagram")).toContainText("Reels precisa de um vídeo");
  await page.getByTestId("destino-instagram-reel").click();

  // A prévia: um aparelho por destino, setas trocam de rede; a conta e as
  // marcas de cada formato aparecem (o @ no Feed, as barras no Story).
  await expect(page.getByTestId("previa-rotulo")).toContainText("Instagram · Feed");
  await expect(page.getByTestId("previa-instagram-feed")).toContainText("nebo.demo");
  await page.getByTestId("previa-proximo").click();
  await expect(page.getByTestId("previa-rotulo")).toContainText("Instagram · Stories");
  await expect(page.getByTestId("previa-instagram-story")).toBeVisible();
  await page.getByTestId("previa-proximo").click();
  await expect(page.getByTestId("previa-rotulo")).toContainText("WhatsApp · Grupos");
  await expect(page.getByTestId("previa-whatsapp-group_message")).toContainText("Clientes VIP");
  await page.getByTestId("previa-anterior").click();
  await expect(page.getByTestId("previa-rotulo")).toContainText("Instagram · Stories");

  // Cada data mostra os ícones das redes marcadas; a 2ª data sai só no Feed
  // e nos grupos — os Stories dela são apagados com um clique no ícone.
  await page.getByRole("button", { name: "Amanhã, mesmo horário" }).click();
  await expect(page.getByTestId("horario-2")).toBeVisible();
  await expect(page.getByTestId("horario-1-destino-instagram-story")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("horario-2-destino-instagram-story").click();
  await expect(page.getByTestId("horario-2-destino-instagram-story")).toHaveAttribute("aria-checked", "false");
  // Apagar TODAS as redes de uma data trava o Agendar e explica no tooltip.
  await page.getByTestId("horario-2-destino-instagram-feed").click();
  await page.getByTestId("horario-2-destino-whatsapp-group_message").click();
  await expect(page.getByTestId("agendar-publicacao")).toBeDisabled();
  await page.getByTestId("agendar-bloqueado").hover();
  await expect(page.getByTestId("tooltip-pendencias").first()).toContainText("sem nenhuma rede");
  await page.getByTestId("horario-2-destino-instagram-feed").click();
  await page.getByTestId("horario-2-destino-whatsapp-group_message").click();
  await expect(page.getByTestId("agendar-publicacao")).toBeEnabled();

  await page.getByTestId("agendar-publicacao").click();
  await expect.poll(() => capturar.criadas.length).toBe(1);
  const corpo = capturar.criadas[0] as {
    status: string;
    media: unknown[];
    targets: Array<{ network: string; format: string; group_ids?: string[] }>;
    scheduled_at: string[];
    occurrences: Array<{ scheduled_at: string; targets: string[] | null }>;
    timezone: string;
  };
  expect(corpo.status).toBe("scheduled");
  expect(corpo.media).toHaveLength(2);
  expect(corpo.scheduled_at).toHaveLength(2);
  expect(corpo.timezone).toBe("America/Sao_Paulo");
  expect(corpo.targets.map((t) => `${t.network}/${t.format}`).sort()).toEqual(["instagram/feed", "instagram/story", "whatsapp/group_message"]);
  expect(corpo.targets.find((t) => t.network === "whatsapp")?.group_ids).toEqual([GRUPO_1, GRUPO_2]);
  // 1ª data: todos (null). 2ª data: só Feed e grupos — os Stories ficaram de fora.
  expect(corpo.occurrences).toHaveLength(2);
  expect(corpo.occurrences[0]!.targets).toBeNull();
  expect(corpo.occurrences[1]!.targets?.map((k) => k.split("/").slice(0, 2).join("/")).sort()).toEqual(["instagram/feed", "whatsapp/group_message"]);
  await expect(page).toHaveURL(/\/app\/publicacoes\/lista/);
});

test("Calendário e Histórico: um chip por ocorrência, '+N', e o desfecho por destino sem overflow", async ({ page }) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());
  const capturar = { criadas: [] as unknown[], reagendadas: [] as unknown[] };
  await mockarApi(page, capturar);
  await page.goto("/app/publicacoes/calendario");
  await expect(page.getByTestId("calendario-de-publicacoes")).toBeVisible();
  await expect(page.locator(`[data-testid="chip-${OCC_1}"]:visible`)).toBeVisible();
  await page.locator(`[data-testid="chip-${OCC_1}"]:visible`).click();
  await expect(page.getByTestId("sheet-da-ocorrencia")).toContainText("Oferta Coca-Cola");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Próximo mês" }).click();
  await page.getByRole("button", { name: "Hoje" }).click();
  await expect(page.locator(`[data-testid="chip-${OCC_1}"]:visible`)).toBeVisible();

  await page.goto("/app/publicacoes/historico");
  const linha = page.getByTestId(`historico-${OCC_DONE}`);
  await expect(linha).toBeVisible();
  await expect(linha).toContainText("Parcial");
  await expect(linha).toContainText("3/4");
  await linha.click();
  const sheet = page.getByTestId("sheet-da-ocorrencia");
  await expect(sheet).toContainText("O grupo está desativado no cadastro.");
  await expect(sheet.getByRole("button", { name: "Reenviar" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Ver no destino" })).toBeVisible();

  for (const largura of [1440, 390]) {
    await page.setViewportSize({ width: largura, height: 900 });
    await page.goto("/app/publicacoes/calendario");
    await expect(page.getByTestId("calendario-de-publicacoes")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `overflow horizontal em ${largura}px`).toBeLessThanOrEqual(0);
  }
});
