import { describe, expect, it } from "vitest";

import { enderecoEhSeguro, lerCodigoDeInstalacao } from "./codigo-de-instalacao";

const CODIGO = `<script src="https://suporte.exemplo.com/widget.js" data-key="pk_3690fe6c59cbcb08ddf650a6" async></script>
<script>
  window.NeboSupport = window.NeboSupport || [];
  NeboSupport.push(["identify", {
    id: "ID_DO_USUARIO",
    hash: "HMAC_GERADO_NO_SERVIDOR"
  }]);
</script>`;

describe("lerCodigoDeInstalacao", () => {
  it("tira endereço e chave do código colado da central de chamados", () => {
    expect(lerCodigoDeInstalacao(CODIGO)).toEqual({
      scriptUrl: "https://suporte.exemplo.com/widget.js",
      publicKey: "pk_3690fe6c59cbcb08ddf650a6",
    });
  });

  it("aceita aspas simples e atributos em outra ordem", () => {
    expect(
      lerCodigoDeInstalacao(`<script async data-key='pk_x' src='https://a.b/widget.js'></script>`),
    ).toEqual({ scriptUrl: "https://a.b/widget.js", publicKey: "pk_x" });
  });

  it("texto que não é o código: nada é inventado", () => {
    expect(lerCodigoDeInstalacao("olá")).toEqual({ scriptUrl: null, publicKey: null });
  });

  it("http é recusado antes de salvar (o navegador bloquearia numa tela https)", () => {
    expect(enderecoEhSeguro("http://localhost:3100/widget.js")).toBe(false);
    expect(enderecoEhSeguro("https://suporte.exemplo.com/widget.js")).toBe(true);
  });
});
