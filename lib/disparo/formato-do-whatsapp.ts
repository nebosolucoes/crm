/**
 * O texto como o WhatsApp o mostra: `*negrito*`, `_itálico_`, `~riscado~` e
 * ```monoespaçado```. Puro — devolve tokens, e quem desenha decide a tag.
 *
 * Existe porque a prévia do celular (`components/disparo/PreviaDoCelular.tsx`)
 * promete mostrar "como vai ficar", e um `*Promoção*` mostrado com os
 * asteriscos à vista quebra a promessa na primeira mensagem que alguém
 * formata. As regras seguem as do WhatsApp, não as do Markdown: o marcador é
 * UM caractere de cada lado, não atravessa linha, e precisa colar no texto
 * (`* x *` fica literal). Aninhamento (`*_x_*`) é resolvido de fora para
 * dentro; dentro de monoespaçado nada é interpretado.
 */

export type EstiloDoWhatsApp = "negrito" | "italico" | "riscado" | "mono";

export type TokenDoWhatsApp =
  | { tipo: "texto"; texto: string }
  | { tipo: "quebra" }
  | { tipo: "estilo"; estilo: EstiloDoWhatsApp; filhos: TokenDoWhatsApp[] };

const MARCADORES: ReadonlyArray<{ estilo: EstiloDoWhatsApp; abre: string; fecha: string }> = [
  { estilo: "mono", abre: "```", fecha: "```" },
  { estilo: "negrito", abre: "*", fecha: "*" },
  { estilo: "italico", abre: "_", fecha: "_" },
  { estilo: "riscado", abre: "~", fecha: "~" },
];

/** Quebra o texto em linhas e formata cada uma — marcador não atravessa `\n`. */
export function tokenizarFormatoDoWhatsApp(texto: string): TokenDoWhatsApp[] {
  const linhas = texto.split("\n");
  const saida: TokenDoWhatsApp[] = [];
  linhas.forEach((linha, i) => {
    if (i > 0) saida.push({ tipo: "quebra" });
    saida.push(...formatarLinha(linha));
  });
  return saida;
}

function ehEspaco(c: string | undefined): boolean {
  return c === undefined || /\s/.test(c);
}

function formatarLinha(linha: string): TokenDoWhatsApp[] {
  const tokens: TokenDoWhatsApp[] = [];
  let literal = "";
  let i = 0;

  const despejar = () => {
    if (literal) tokens.push({ tipo: "texto", texto: literal });
    literal = "";
  };

  while (i < linha.length) {
    let casou = false;
    for (const marcador of MARCADORES) {
      if (!linha.startsWith(marcador.abre, i)) continue;
      // O marcador de abertura precisa colar no texto (`*x`), e o anterior a
      // ele não pode ser letra — `2*3*4` é conta, não negrito.
      const anterior = linha[i - 1];
      const seguinte = linha[i + marcador.abre.length];
      if (ehEspaco(seguinte) || seguinte === marcador.abre[0]) continue;
      if (anterior !== undefined && /[\p{L}\p{N}]/u.test(anterior) && marcador.estilo !== "mono")
        continue;

      const inicioDoConteudo = i + marcador.abre.length;
      const fim = linha.indexOf(marcador.fecha, inicioDoConteudo);
      if (fim === -1) continue;
      const conteudo = linha.slice(inicioDoConteudo, fim);
      if (conteudo.length === 0 || ehEspaco(conteudo[conteudo.length - 1])) continue;
      // O fechamento também não pode ser seguido de letra: `*a*b` fica literal.
      const depois = linha[fim + marcador.fecha.length];
      if (depois !== undefined && /[\p{L}\p{N}]/u.test(depois) && marcador.estilo !== "mono")
        continue;

      despejar();
      tokens.push({
        tipo: "estilo",
        estilo: marcador.estilo,
        filhos:
          marcador.estilo === "mono"
            ? [{ tipo: "texto", texto: conteudo }]
            : formatarLinha(conteudo),
      });
      i = fim + marcador.fecha.length;
      casou = true;
      break;
    }
    if (casou) continue;
    literal += linha[i];
    i += 1;
  }
  despejar();
  return tokens;
}
