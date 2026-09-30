/**
 * Playwright contra um servidor que JÁ está de pé (`next dev` ou `next start`
 * na porta 3001), sem subir nada — para provar uma tela durante o
 * desenvolvimento sem o ciclo `e2e:build` + `test:e2e`.
 *
 *   npx playwright test --config playwright.dev-server.config.ts tests/e2e/<spec>
 *
 * Usa o mesmo `.e2e-creds.json` e o mesmo banco local que a suíte oficial.
 * Não é o gate do CI: o CI continua em `playwright.config.ts`, que sobe o
 * `next start` sozinho e é o que prova a instalação fresca.
 */
import { defineConfig } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "on",
    video: "off",
  },
  outputDir: ".superpowers/evidence/publicacoes/playwright",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
