import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("relógio local dos crons", () => {
  it("aciona o worker de disparos agendados", () => {
    const fonte = readFileSync(resolve(process.cwd(), "scripts/dev-crons.ts"), "utf8");

    expect(fonte).toContain('"/api/v1/cron/scheduled-group-messages"');
  });
});
