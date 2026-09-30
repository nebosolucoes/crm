/**
 * O relógio local (`scripts/dev-crons.ts`) aciona o worker de Publicações —
 * o sucessor do disparo agendado (migration 0283). Sem esta linha, quem
 * desenvolve agenda uma publicação e ela nunca sai; o cron antigo não existe mais.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("relógio local dos crons", () => {
  it("aciona o worker de Publicações e não cita mais o cron antigo", () => {
    const fonte = readFileSync(resolve(process.cwd(), "scripts/dev-crons.ts"), "utf8");
    expect(fonte).toContain('"/api/v1/cron/publications-worker"');
    expect(fonte).not.toContain("scheduled-group-messages");
  });
});
