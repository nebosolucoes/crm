import { describe, expect, it, vi } from "vitest";

import { montarCorpoDoPost } from "./social";

vi.mock("../url-publica", () => ({ alcancavelPelaInternet: () => true }));

const pedido = {
  organizationId: "org",
  sessionRef: "acc-1",
  caption: "Coca-Cola 2L por R$ 9,99",
  settings: {},
  idempotencyKey: "k",
  referencia: "exec-1",
};
const foto = (n: number) => ({ url: `https://cdn/${n}.jpg`, mime: "image/jpeg", kind: "image" as const, filename: `${n}.jpg`, sizeBytes: 100 });
const video = { url: "https://cdn/v.mp4", mime: "video/mp4", kind: "video" as const, filename: "v.mp4", sizeBytes: 1000, coverUrl: "https://cdn/capa.jpg" };
const mesmaUrl = async (m: { url: string }) => m.url;

describe("montarCorpoDoPost — o pedido neutro vira o corpo do provedor", () => {
  it("Feed do Instagram: legenda + mediaItems + uma plataforma com a conta; publishNow e a referência em metadata", async () => {
    const corpo = await montarCorpoDoPost({ ...pedido, network: "instagram", format: "feed", media: [foto(1), foto(2)] }, mesmaUrl);
    expect(corpo).toMatchObject({
      content: "Coca-Cola 2L por R$ 9,99",
      publishNow: true,
      metadata: { crm_execution_id: "exec-1", crm_format: "feed" },
      platforms: [{ platform: "instagram", accountId: "acc-1", platformSpecificData: {} }],
    });
    expect((corpo.mediaItems as unknown[]).length).toBe(2);
    expect((corpo.mediaItems as Array<Record<string, unknown>>)[0]).toMatchObject({ type: "image", url: "https://cdn/1.jpg", mimeType: "image/jpeg" });
  });

  it("Story: contentType 'story' e SEM legenda (a rede não mostra)", async () => {
    const corpo = await montarCorpoDoPost({ ...pedido, network: "facebook", format: "story", media: [foto(1)] }, mesmaUrl);
    expect(corpo.content).toBeUndefined();
    expect((corpo.platforms as Array<Record<string, unknown>>)[0]).toMatchObject({ platform: "facebook", platformSpecificData: { contentType: "story" } });
  });

  it("Reels: no Facebook vai contentType 'reel' + title; no Instagram vai shareToFeed e a capa em instagramThumbnail", async () => {
    const fb = await montarCorpoDoPost({ ...pedido, network: "facebook", format: "reel", media: [video], settings: { title: "Oferta" } }, mesmaUrl);
    expect((fb.platforms as Array<Record<string, unknown>>)[0]!.platformSpecificData).toEqual({ contentType: "reel", title: "Oferta" });
    expect((fb.mediaItems as Array<Record<string, unknown>>)[0]).toMatchObject({ type: "video", thumbnail: "https://cdn/capa.jpg" });

    const ig = await montarCorpoDoPost({ ...pedido, network: "instagram", format: "reel", media: [video], settings: { share_to_feed: false } }, mesmaUrl);
    expect((ig.platforms as Array<Record<string, unknown>>)[0]!.platformSpecificData).toEqual({ shareToFeed: false });
    expect((ig.mediaItems as Array<Record<string, unknown>>)[0]).toMatchObject({ instagramThumbnail: "https://cdn/capa.jpg" });
  });

  it("opções neutras viram os campos do provedor só onde cabem (não em Story)", async () => {
    const feed = await montarCorpoDoPost({ ...pedido, network: "instagram", format: "feed", media: [foto(1)], settings: { first_comment: "Link na bio", comments_enabled: false, caption_override: "Só hoje!" } }, mesmaUrl);
    expect((feed.platforms as Array<Record<string, unknown>>)[0]!.platformSpecificData).toEqual({ firstComment: "Link na bio", commentsEnabled: false });
    expect(feed.content).toBe("Só hoje!");
    const story = await montarCorpoDoPost({ ...pedido, network: "instagram", format: "story", media: [foto(1)], settings: { first_comment: "x" } }, mesmaUrl);
    expect((story.platforms as Array<Record<string, unknown>>)[0]!.platformSpecificData).toEqual({ contentType: "story" });
  });

  it("GIF vira type 'gif'; a URL passa pelo resolvedor (que pode re-hospedar)", async () => {
    const rehost = async (m: { url: string }) => `https://provedor/${m.url.split("/").pop()}`;
    const corpo = await montarCorpoDoPost({ ...pedido, network: "facebook", format: "feed", media: [{ ...foto(1), mime: "image/gif" }] }, rehost);
    expect((corpo.mediaItems as Array<Record<string, unknown>>)[0]).toMatchObject({ type: "gif", url: "https://provedor/1.jpg" });
  });

  it("WhatsApp não é rede social: lança", async () => {
    await expect(montarCorpoDoPost({ ...pedido, network: "whatsapp", format: "group_message", media: [] }, mesmaUrl)).rejects.toThrow(/rede_nao_social/);
  });
});
