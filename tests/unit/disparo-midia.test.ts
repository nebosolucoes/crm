import { describe, expect, it } from "vitest";

import {
  gruposDoPedido,
  loteDoMetadata,
  metadataComLote,
  metadataComMidiaAgendada,
  metadataComMidiasAgendadas,
  midiaAgendadaDoMetadata,
  midiasAgendadasDoMetadata,
  midiasDoPedido,
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

describe("vários arquivos por disparo", () => {
  const PDF = {
    kind: "document" as const,
    storage_path: "org-1/scheduled-groups/out-tabela.pdf",
    mime: "application/pdf",
    size_bytes: 4321,
    filename: "tabela.pdf",
  };

  it("grava a lista e, para rollback, o formato antigo com o primeiro foto/vídeo", () => {
    const metadata = metadataComMidiasAgendadas({ origem: "tela" }, [PDF, FOTO]);
    expect(midiasAgendadasDoMetadata(metadata)).toEqual([PDF, FOTO]);
    // O código anterior só conhecia foto/vídeo: o PDF na chave antiga seria
    // recusado pelo Zod dele e o disparo sairia sem anexo nenhum.
    expect(midiaAgendadaDoMetadata({ scheduled_media: metadata.scheduled_media })).toEqual(FOTO);
    expect(metadata).toMatchObject({ origem: "tela" });
  });

  it("lê o formato antigo como lista de um, e lista vazia limpa as duas chaves", () => {
    expect(midiasAgendadasDoMetadata({ scheduled_media: FOTO })).toEqual([FOTO]);
    const limpo = metadataComMidiasAgendadas(metadataComMidiasAgendadas({}, [PDF]), []);
    expect(limpo).toEqual({});
  });

  it("o pedido: `media_items` vence `media`; `group_ids` vence `group_id` e não repete", () => {
    expect(midiasDoPedido({ media: FOTO, media_items: [PDF] })).toEqual([PDF]);
    expect(midiasDoPedido({ media: FOTO })).toEqual([FOTO]);
    expect(midiasDoPedido({ media: null })).toEqual([]);
    expect(midiasDoPedido({})).toBeUndefined();
    expect(gruposDoPedido({ group_id: "a", group_ids: ["b", "c", "b"] })).toEqual(["b", "c"]);
    expect(gruposDoPedido({ group_id: "a" })).toEqual(["a"]);
    expect(gruposDoPedido({})).toEqual([]);
  });

  it("o lote é encapsulado no jsonb e lido de volta", () => {
    const lote = { id: "3f2b6c4e-9a1d-4c3b-8e2f-1a2b3c4d5e6f", size: 3, index: 1 };
    expect(loteDoMetadata(metadataComLote({ x: 1 }, lote))).toEqual(lote);
    expect(loteDoMetadata({ batch: { id: "nope" } })).toBeNull();
    expect(metadataComLote(metadataComLote({}, lote), null)).toEqual({});
  });
});
