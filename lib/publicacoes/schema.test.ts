import { describe, expect, it } from "vitest";

import { alterarPublicacaoSchema, chaveDeDestino, criarPublicacaoSchema } from "./schema";
import { horariosDaEntrada } from "./servico";

const CONTA = "11111111-1111-4111-8111-111111111111";
const FEED = { network: "instagram", format: "feed", channel_session_id: CONTA, settings: {} } as const;
const STORY = { network: "instagram", format: "story", channel_session_id: CONTA, settings: {} } as const;
const MIDIA = { kind: "image", storage_path: "org/publications/p/a.jpg", mime: "image/jpeg", size_bytes: 10 } as const;

describe("schema — cada data escolhe seus destinos (0284)", () => {
  it("aceita `occurrences` com chaves dos destinos declarados; `null` = todos", () => {
    const r = criarPublicacaoSchema.safeParse({
      media: [MIDIA],
      targets: [FEED, STORY],
      occurrences: [
        { scheduled_at: "2030-01-10T12:00:00Z", targets: [chaveDeDestino(FEED)] },
        { scheduled_at: "2030-01-11T12:00:00Z", targets: null },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("reprova data sem nenhuma rede (lista vazia) e chave que não é destino da publicação", () => {
    const vazia = criarPublicacaoSchema.safeParse({ media: [MIDIA], targets: [FEED], occurrences: [{ scheduled_at: "2030-01-10T12:00:00Z", targets: [] }] });
    expect(vazia.success).toBe(false);
    expect(JSON.stringify(vazia.error?.issues)).toContain("sem nenhuma rede");
    const alheia = criarPublicacaoSchema.safeParse({ media: [MIDIA], targets: [FEED], occurrences: [{ scheduled_at: "2030-01-10T12:00:00Z", targets: [chaveDeDestino(STORY)] }] });
    expect(alheia.success).toBe(false);
    expect(JSON.stringify(alheia.error?.issues)).toContain("não está na publicação");
  });

  it("agendar exige ao menos uma data — contada em `occurrences` quando ela vem", () => {
    const sem = criarPublicacaoSchema.safeParse({ status: "scheduled", media: [MIDIA], targets: [FEED], occurrences: [] });
    expect(sem.success).toBe(false);
    const com = criarPublicacaoSchema.safeParse({ status: "scheduled", media: [MIDIA], targets: [FEED], occurrences: [{ scheduled_at: "2030-01-10T12:00:00Z" }] });
    expect(com.success).toBe(true);
  });

  it("editar sem `targets` no corpo aceita as chaves (o serviço confere contra os destinos atuais)", () => {
    const r = alterarPublicacaoSchema.safeParse({ occurrences: [{ scheduled_at: "2030-01-10T12:00:00Z", targets: [chaveDeDestino(FEED)] }] });
    expect(r.success).toBe(true);
    const vazia = alterarPublicacaoSchema.safeParse({ occurrences: [{ scheduled_at: "2030-01-10T12:00:00Z", targets: [] }] });
    expect(vazia.success).toBe(false);
  });
});

describe("horariosDaEntrada — a forma que o serviço grava", () => {
  it("`scheduled_at` sozinho = todos os destinos em cada data", () => {
    const m = horariosDaEntrada({ scheduled_at: ["2030-01-10T12:00:00.000Z", "2030-01-11T12:00:00.000Z"] });
    expect([...m.entries()]).toEqual([
      ["2030-01-10T12:00:00.000Z", null],
      ["2030-01-11T12:00:00.000Z", null],
    ]);
  });

  it("`occurrences` manda sobre `scheduled_at`, normaliza o instante e funde a mesma data", () => {
    const m = horariosDaEntrada({
      scheduled_at: ["2030-01-01T00:00:00Z"],
      occurrences: [
        { scheduled_at: "2030-01-10T09:00:00-03:00", targets: ["a"] },
        { scheduled_at: "2030-01-10T12:00:00Z", targets: ["b", "a"] },
        { scheduled_at: "2030-01-11T12:00:00Z", targets: ["a"] },
        { scheduled_at: "2030-01-11T12:00:00Z", targets: null },
      ],
    });
    expect(m.get("2030-01-01T00:00:00.000Z")).toBeUndefined();
    expect(m.get("2030-01-10T12:00:00.000Z")).toEqual(["a", "b"]);
    expect(m.get("2030-01-11T12:00:00.000Z")).toBeNull();
  });
});
