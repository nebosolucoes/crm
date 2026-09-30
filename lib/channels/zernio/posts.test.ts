import { describe, expect, it } from "vitest";

import { categoriaDoProvedor, lerDesfechoDoPost, segundosDeRetryAfter } from "./posts";

describe("lerDesfechoDoPost — o que o provedor diz sobre a plataforma pedida", () => {
  it("published → sent com id do post, id na rede e URL", () => {
    const d = lerDesfechoDoPost(
      { post: { _id: "p1", status: "published", platforms: [{ platform: "instagram", status: "published", platformPostId: "ig-9", platformPostUrl: "https://ig/9" }] } },
      "instagram",
    );
    expect(d).toMatchObject({ estado: "sent", postId: "p1", platformPostId: "ig-9", url: "https://ig/9", providerStatus: "published" });
  });

  it("processing/uploading → accepted (o webhook fecha depois)", () => {
    for (const status of ["pending", "processing", "uploading"]) {
      const d = lerDesfechoDoPost({ post: { _id: "p1", status: "publishing", platforms: [{ platform: "facebook", status }] } }, "facebook");
      expect(d).toMatchObject({ estado: "accepted", postId: "p1", providerStatus: status });
    }
  });

  it("failed → failed com a categoria do provedor traduzida: auth_expired é permanente, platform_error é transitório", () => {
    const perm = lerDesfechoDoPost({ post: { _id: "p1", platforms: [{ platform: "instagram", status: "failed", errorMessage: "token", errorCategory: "auth_expired" }] } }, "instagram");
    expect(perm).toMatchObject({ estado: "failed", codigo: "provider_auth_expired", categoria: "permanente", mensagem: "token" });
    const trans = lerDesfechoDoPost({ post: { _id: "p1", platforms: [{ platform: "instagram", status: "failed", errorCategory: "platform_error" }] } }, "instagram");
    expect(trans).toMatchObject({ estado: "failed", categoria: "transitorio" });
  });

  it("207 traz o post com a plataforma falha — a leitura é a mesma", () => {
    const d = lerDesfechoDoPost(
      { post: { _id: "p2", status: "failed", platforms: [{ platform: "facebook", status: "failed", errorMessage: "Page token expired", errorCategory: "auth_expired" }] }, platformResults: [{ platform: "facebook", status: "failed", error: "x" }] },
      "facebook",
    );
    expect(d).toMatchObject({ estado: "failed", postId: "p2", categoria: "permanente" });
  });

  it("post sem plataformas: cai no status do post; sem id nenhum é unknown", () => {
    expect(lerDesfechoDoPost({ post: { _id: "p3", status: "published" } }, "instagram")).toMatchObject({ estado: "sent", postId: "p3" });
    expect(lerDesfechoDoPost({ message: "?" }, "instagram")).toMatchObject({ estado: "unknown", postId: null });
  });

  it("categoriaDoProvedor: só o que o provedor diz ser passageiro é transitório", () => {
    expect(categoriaDoProvedor("platform_rate_limit")).toBe("transitorio");
    expect(categoriaDoProvedor("system_error")).toBe("transitorio");
    expect(categoriaDoProvedor("unknown")).toBe("transitorio");
    expect(categoriaDoProvedor("user_content")).toBe("permanente");
    expect(categoriaDoProvedor("account_issue")).toBe("permanente");
    expect(categoriaDoProvedor(undefined)).toBe("permanente");
  });

  it("segundosDeRetryAfter lê o header e, na falta dele, o details do corpo", () => {
    expect(segundosDeRetryAfter(new Headers({ "retry-after": "12" }), null)).toBe(12);
    expect(segundosDeRetryAfter(null, { details: { retryAfterSeconds: 7 } })).toBe(7);
    expect(segundosDeRetryAfter(null, null)).toBeNull();
  });
});
