import { expect, test } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const GRUPO_ID = "02630000-0000-4000-8000-000000000001";
const GRUPO_2_ID = "02630000-0000-4000-8000-000000000006";
const SESSAO_ID = "02630000-0000-4000-8000-000000000002";
const AGENDAMENTO_ID = "02630000-0000-4000-8000-000000000003";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("disparo programado mostra execução, mídia e ocupa a página sem overflow", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await loginComoAdmin(page, lerCreds());

  await page.route("**/api/v1/channel-sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: SESSAO_ID,
            display_name: "Conexão de demonstração",
            provider: "waha",
            status: "WORKING",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/agendamentos**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const data =
      pathname === "/api/v1/agendamentos/grupos"
        ? {
            groups: [
              {
                id: GRUPO_ID,
                channel_session_id: SESSAO_ID,
                external_group_id: "120363000000000000@g.us",
                name: "Clientes VIP",
                is_active: true,
                last_seen_at: "2026-09-17T11:50:00.000Z",
              },
              {
                id: GRUPO_2_ID,
                channel_session_id: SESSAO_ID,
                external_group_id: "120363000000000001@g.us",
                name: "Revendedores",
                is_active: true,
                last_seen_at: "2026-09-17T11:50:00.000Z",
              },
            ],
          }
        : pathname === "/api/v1/agendamentos/execucoes"
          ? {
              runs: [
                {
                  id: "02630000-0000-4000-8000-000000000004",
                  scheduled_message_id: AGENDAMENTO_ID,
                  scheduled_for: "2026-09-17T12:00:00.000Z",
                  status: "failed",
                  sent_at: null,
                  error_code: "channel_unavailable",
                  error_message: "A conexão não estava disponível no horário programado.",
                  scheduled_group_messages: {
                    title: "Oferta de setembro",
                    body: "Condição especial para o grupo.",
                  },
                  scheduled_whatsapp_groups: {
                    name: "Clientes VIP",
                    external_group_id: "120363000000000000@g.us",
                  },
                },
              ],
            }
          : {
              schedules: [
                {
                  id: AGENDAMENTO_ID,
                  channel_session_id: SESSAO_ID,
                  group_id: GRUPO_ID,
                  title: "Oferta de setembro",
                  body: "Condição especial para o grupo.",
                  status: "completed",
                  starts_at: "2026-09-17T12:00:00.000Z",
                  timezone: "America/Sao_Paulo",
                  recurrence_kind: "none",
                  recurrence_config: {},
                  repeat_until: null,
                  max_runs: 1,
                  next_run_at: null,
                  last_run_at: "2026-09-17T12:00:00.000Z",
                  media: {
                    kind: "image",
                    storage_path:
                      "02630000-0000-4000-8000-000000000005/scheduled-groups/oferta.png",
                    mime: "image/png",
                    size_bytes: 68,
                    filename: "oferta.png",
                  },
                  latest_execution: {
                    id: "02630000-0000-4000-8000-000000000004",
                    scheduled_for: "2026-09-17T12:00:00.000Z",
                    status: "failed",
                    attempt: 1,
                    sent_at: null,
                    error_code: "channel_unavailable",
                    error_message: "A conexão não estava disponível no horário programado.",
                  },
                  scheduled_whatsapp_groups: {
                    name: "Clientes VIP",
                    external_group_id: "120363000000000000@g.us",
                  },
                },
              ],
            };

    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data }) });
  });

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/app/disparo/lista");
  // `h1`, não `getByRole("heading")`: a sidebar agrupada também tem um heading
  // "Disparo" (o `<h2>` do grupo), e o strict mode resolve dois elementos.
  await expect(page.locator("h1", { hasText: "Disparo" })).toBeVisible();
  await expect(page.getByText("Última execução: Falhou")).toBeVisible();
  await expect(page.getByText("1 arquivo(s)")).toBeVisible();
  await expect(
    page.getByText("A conexão não estava disponível no horário programado."),
  ).toBeVisible();

  const larguraDoConteudo = await page
    .locator("h1", { hasText: "Disparo" })
    .locator("xpath=../..")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(larguraDoConteudo).toBeGreaterThan(900);

  const desktop = testInfo.outputPath("disparo-lista-desktop.png");
  await page.screenshot({ path: desktop, fullPage: true });
  await testInfo.attach("disparo-lista-desktop", { path: desktop, contentType: "image/png" });

  // ─── Agendar: vários grupos, vários arquivos e a prévia do celular ───────
  //
  // As duas rotas de escrita são interceptadas: o upload devolve um recibo por
  // arquivo e o POST guarda o corpo. O que se prova aqui é a cadeia da TELA —
  // marcar dois grupos, anexar dois arquivos, ver a prévia com dois balões e a
  // legenda só no último — e o contrato que ela manda para a API
  // (`group_ids` com os dois, `media_items` com os dois, na ordem).
  let uploads = 0;
  await page.route("**/api/v1/agendamentos/media", async (route) => {
    uploads += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          media: {
            kind: uploads === 1 ? "image" : "document",
            storage_path: `02630000-0000-4000-8000-000000000005/scheduled-groups/out-${uploads}.bin`,
            mime: uploads === 1 ? "image/png" : "application/pdf",
            size_bytes: 68,
            filename: uploads === 1 ? "oferta-teste.png" : "tabela.pdf",
          },
        },
      }),
    });
  });
  let corpoDoPost: Record<string, unknown> | null = null;
  await page.route("**/api/v1/agendamentos", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    corpoDoPost = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: { schedule: null, schedules: [] } }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/app/disparo/agendar");
  const previa = page.locator("[data-previa-do-celular]");
  await expect(previa).toBeVisible();

  // Dois grupos, pela caixa de marcar.
  await page.getByRole("checkbox", { name: "Clientes VIP" }).click();
  await page.getByRole("checkbox", { name: "Revendedores" }).click();
  await expect(page.getByText("2 de 2 grupo(s) selecionado(s)")).toBeVisible();
  await expect(previa.getByText("Clientes VIP")).toBeVisible();
  await expect(previa.getByText("e mais 1 grupo(s)")).toBeVisible();

  // A mensagem, com formatação do WhatsApp — a prévia mostra negrito, não asteriscos.
  await page.getByPlaceholder("Escreva a mensagem que será enviada ao grupo").fill(
    "Chegou o *catálogo* de setembro!",
  );
  await expect(previa.locator("strong", { hasText: "catálogo" })).toBeVisible();
  await expect(previa.getByText("*catálogo*")).toHaveCount(0);

  // Dois arquivos de uma vez.
  await expect(page.getByRole("button", { name: /Adicionar arquivos/i })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "oferta-teste.png", mimeType: "image/png", buffer: PNG_1PX },
    { name: "tabela.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fake") },
  ]);
  const lista = page.locator("[data-lista-de-anexos] li");
  await expect(lista).toHaveCount(2);
  await expect(lista.nth(0)).toContainText("oferta-teste.png");
  await expect(lista.nth(1)).toContainText("tabela.pdf");

  // A prévia: um balão por arquivo, na ordem, e a legenda só no último.
  const baloes = previa.locator("[data-balao]");
  await expect(baloes).toHaveCount(2);
  await expect(baloes.nth(0).locator("img")).toBeVisible();
  await expect(baloes.nth(0)).not.toContainText("catálogo");
  await expect(baloes.nth(1)).toContainText("tabela.pdf");
  await expect(baloes.nth(1).locator("strong", { hasText: "catálogo" })).toBeVisible();

  const desktopAgendar = testInfo.outputPath("disparo-agendar-desktop.png");
  await page.screenshot({ path: desktopAgendar, fullPage: true });
  await testInfo.attach("disparo-agendar-desktop", {
    path: desktopAgendar,
    contentType: "image/png",
  });

  // O envio: dois uploads, e um POST com os dois grupos e os dois arquivos.
  await page.getByRole("button", { name: /Criar agendamento/i }).click();
  await expect.poll(() => corpoDoPost).not.toBeNull();
  expect(uploads).toBe(2);
  expect(corpoDoPost!.group_ids).toEqual([GRUPO_ID, GRUPO_2_ID]);
  expect((corpoDoPost!.media_items as { filename: string }[]).map((m) => m.filename)).toEqual([
    "oferta-teste.png",
    "tabela.pdf",
  ]);
  expect(corpoDoPost!.body).toBe("Chegou o *catálogo* de setembro!");

  // No celular a página inteira continua sem rolagem horizontal.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/disparo/agendar");
  await expect(page.getByRole("button", { name: /Adicionar arquivos/i })).toBeVisible();
  await expect(page.locator("[data-previa-do-celular]")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const mobile = testInfo.outputPath("disparo-agendar-mobile.png");
  await page.screenshot({ path: mobile, fullPage: true });
  await testInfo.attach("disparo-agendar-mobile", { path: mobile, contentType: "image/png" });
});
