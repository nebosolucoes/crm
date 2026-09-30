import { describe, expect, it } from "vitest";

import { unidadesDoDestino, validarDestino, type MidiaParaRegras } from "./regras-por-destino";

const foto = (extra: Partial<MidiaParaRegras> = {}): MidiaParaRegras => ({
  kind: "image", mime: "image/jpeg", size_bytes: 500_000, ...extra,
});
const video = (extra: Partial<MidiaParaRegras> = {}): MidiaParaRegras => ({
  kind: "video", mime: "video/mp4", size_bytes: 20_000_000, ...extra,
});
const codigos = (v: { erros: { codigo: string }[] }) => v.erros.map((e) => e.codigo);
const avisos = (v: { avisos: { codigo: string }[] }) => v.avisos.map((e) => e.codigo);

describe("validarDestino — Instagram", () => {
  it("Feed com 1 foto passa; com 11 arquivos reprova; com 5 fotos vira carrossel (passa)", () => {
    expect(validarDestino({ network: "instagram", format: "feed", body: "Oferta", media: [foto()] }).ok).toBe(true);
    expect(codigos(validarDestino({ network: "instagram", format: "feed", body: "x", media: Array.from({ length: 11 }, () => foto()) }))).toContain("muitas_midias");
    expect(validarDestino({ network: "instagram", format: "feed", body: "x", media: Array.from({ length: 5 }, () => foto()) }).ok).toBe(true);
  });

  it("Feed com um vídeo único avisa que vira Reel (não reprova)", () => {
    const v = validarDestino({ network: "instagram", format: "feed", body: "x", media: [video({ duration_ms: 20_000 })] });
    expect(v.ok).toBe(true);
    expect(avisos(v)).toContain("vira_reel");
  });

  it("Feed sem mídia e sem legenda reprova; legenda acima de 2200 reprova", () => {
    expect(codigos(validarDestino({ network: "instagram", format: "feed", body: "", media: [] }))).toEqual(expect.arrayContaining(["sem_midia", "sem_conteudo"]));
    expect(codigos(validarDestino({ network: "instagram", format: "feed", body: "a".repeat(2201), media: [foto()] }))).toContain("legenda_longa");
  });

  it("Stories: cada arquivo é um Story; 5 passam, 11 reprovam, legenda vira aviso", () => {
    expect(unidadesDoDestino("story")).toBe("por_midia");
    expect(unidadesDoDestino("feed")).toBe("uma");
    const cinco = validarDestino({ network: "instagram", format: "story", body: "texto", media: Array.from({ length: 5 }, () => foto()) });
    expect(cinco.ok).toBe(true);
    expect(avisos(cinco)).toContain("sem_legenda_em_story");
    expect(codigos(validarDestino({ network: "instagram", format: "story", body: null, media: Array.from({ length: 11 }, () => foto()) }))).toContain("muitas_midias");
  });

  it("Story com vídeo de 61 s reprova; sem duração conhecida só avisa", () => {
    expect(codigos(validarDestino({ network: "instagram", format: "story", body: null, media: [video({ duration_ms: 61_000 })] }))).toContain("video_longo");
    const semDuracao = validarDestino({ network: "instagram", format: "story", body: null, media: [video()] });
    expect(semDuracao.ok).toBe(true);
    expect(avisos(semDuracao)).toContain("duracao_desconhecida");
  });

  it("Reels exige exatamente um vídeo de 3 a 90 s", () => {
    expect(codigos(validarDestino({ network: "instagram", format: "reel", body: "x", media: [foto()] }))).toContain("reel_sem_video");
    expect(codigos(validarDestino({ network: "instagram", format: "reel", body: "x", media: [video(), video()] }))).toContain("muitas_midias");
    expect(codigos(validarDestino({ network: "instagram", format: "reel", body: "x", media: [] }))).toContain("sem_midia");
    expect(codigos(validarDestino({ network: "instagram", format: "reel", body: "x", media: [video({ duration_ms: 91_000 })] }))).toContain("video_longo");
    expect(codigos(validarDestino({ network: "instagram", format: "reel", body: "x", media: [video({ duration_ms: 2_000 })] }))).toContain("video_curto");
    expect(validarDestino({ network: "instagram", format: "reel", body: "x", media: [video({ duration_ms: 30_000, width: 1080, height: 1920 })] }).ok).toBe(true);
  });

  it("áudio e documento não entram em rede social; foto acima de 8 MB só avisa no Instagram", () => {
    expect(codigos(validarDestino({ network: "instagram", format: "feed", body: "x", media: [{ kind: "audio", mime: "audio/ogg", size_bytes: 10 }] }))).toContain("tipo_nao_aceito");
    const grande = validarDestino({ network: "instagram", format: "feed", body: "x", media: [foto({ size_bytes: 9 * 1024 * 1024 })] });
    expect(grande.ok).toBe(true);
    expect(avisos(grande)).toContain("imagem_grande");
  });
});

describe("validarDestino — Facebook", () => {
  it("Feed não mistura foto e vídeo, aceita só um vídeo, e aceita texto puro", () => {
    expect(codigos(validarDestino({ network: "facebook", format: "feed", body: "x", media: [foto(), video()] }))).toContain("feed_misto");
    expect(codigos(validarDestino({ network: "facebook", format: "feed", body: "x", media: [video(), video()] }))).toContain("muitos_videos");
    expect(validarDestino({ network: "facebook", format: "feed", body: "Só texto", media: [] }).ok).toBe(true);
    expect(validarDestino({ network: "facebook", format: "feed", body: "x", media: Array.from({ length: 10 }, () => foto()) }).ok).toBe(true);
  });

  it("foto acima de 4 MB reprova no Facebook (o provedor não comprime); GIF é aceito", () => {
    expect(codigos(validarDestino({ network: "facebook", format: "feed", body: "x", media: [foto({ size_bytes: 5 * 1024 * 1024 })] }))).toContain("imagem_grande");
    expect(validarDestino({ network: "facebook", format: "feed", body: "x", media: [foto({ mime: "image/gif" })] }).ok).toBe(true);
    expect(codigos(validarDestino({ network: "instagram", format: "feed", body: "x", media: [foto({ mime: "image/gif" })] }))).toContain("imagem_nao_aceita");
  });

  it("Reels do Facebook: 3 a 60 s; Story aceita vídeo até 120 s", () => {
    expect(codigos(validarDestino({ network: "facebook", format: "reel", body: "x", media: [video({ duration_ms: 75_000 })] }))).toContain("video_longo");
    expect(validarDestino({ network: "facebook", format: "story", body: null, media: [video({ duration_ms: 100_000 })] }).ok).toBe(true);
  });
});

describe("validarDestino — WhatsApp", () => {
  it("exige grupo; aceita texto puro; aceita documento e áudio; limita a 30 arquivos", () => {
    expect(codigos(validarDestino({ network: "whatsapp", format: "group_message", body: "oi", media: [], groupCount: 0 }))).toContain("sem_grupos");
    expect(validarDestino({ network: "whatsapp", format: "group_message", body: "oi", media: [], groupCount: 2 }).ok).toBe(true);
    expect(validarDestino({ network: "whatsapp", format: "group_message", body: null, media: [{ kind: "document", mime: "application/pdf", size_bytes: 10 }], groupCount: 1 }).ok).toBe(true);
    expect(codigos(validarDestino({ network: "whatsapp", format: "group_message", body: null, media: [], groupCount: 1 }))).toContain("sem_conteudo");
    expect(codigos(validarDestino({ network: "whatsapp", format: "group_message", body: "x", media: Array.from({ length: 31 }, () => foto()), groupCount: 1 }))).toContain("muitos_arquivos");
  });
});
