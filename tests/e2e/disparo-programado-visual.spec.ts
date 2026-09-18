import { expect, test } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const GRUPO_ID = "02630000-0000-4000-8000-000000000001";
const SESSAO_ID = "02630000-0000-4000-8000-000000000002";
const AGENDAMENTO_ID = "02630000-0000-4000-8000-000000000003";

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
  await expect(page.getByText("Com mídia")).toBeVisible();
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/disparo/agendar");
  const botaoMidia = page.getByRole("button", { name: /Adicionar foto ou vídeo/i });
  await expect(botaoMidia).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "oferta-teste.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText("oferta-teste.png")).toBeVisible();
  await expect(page.getByAltText("Prévia da foto selecionada")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const mobile = testInfo.outputPath("disparo-agendar-mobile.png");
  await page.screenshot({ path: mobile, fullPage: true });
  await testInfo.attach("disparo-agendar-mobile", { path: mobile, contentType: "image/png" });
});
