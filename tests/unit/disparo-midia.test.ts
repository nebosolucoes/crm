import { describe, expect, it } from "vitest";

import {
  metadataComMidiaAgendada,
  midiaAgendadaDoMetadata,
} from "@/lib/agendamentos-grupos/schema";
import { isScheduledMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";

const FOTO = {
  kind: "image" as const,
  storage_path: "org-1/scheduled-groups/out-foto.jpg",
  mime: "image/jpeg",
  size_bytes: 1234,
  filename: "foto.jpg",
};

describe("mídia de disparo programado", () => {
  it("preserva metadata alheio e encapsula a mídia", () => {
    const metadata = metadataComMidiaAgendada({ origem: "tela" }, FOTO);

    expect(metadata).toMatchObject({ origem: "tela" });
    expect(midiaAgendadaDoMetadata(metadata)).toEqual(FOTO);
  });

  it("remove somente a mídia e ignora payload interno inválido", () => {
    const comMidia = metadataComMidiaAgendada({ origem: "tela" }, FOTO);

    expect(metadataComMidiaAgendada(comMidia, null)).toEqual({ origem: "tela" });
    expect(midiaAgendadaDoMetadata({ scheduled_media: { kind: "audio" } })).toBeNull();
  });

  it("aceita apenas arquivo da pasta da própria organização", () => {
    expect(isScheduledMediaPathOwnedBy(FOTO.storage_path, "org-1")).toBe(true);
    expect(isScheduledMediaPathOwnedBy(FOTO.storage_path, "org-2")).toBe(false);
    expect(isScheduledMediaPathOwnedBy("org-1/outra-pasta/foto.jpg", "org-1")).toBe(false);
  });
});
