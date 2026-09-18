import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

import { ARQUIVOS_DA_MARCA_DO_PRODUTO } from "@/components/branding/MarcaDoProduto";
import { iconeEhODoProduto } from "@/lib/branding";
import { letraDoIcone } from "@/lib/branding/icone";
import { marcaDaSaida } from "@/lib/branding/saida";

/**
 * O ícone da aba, DESENHADO em runtime com a marca da instalação.
 *
 * ─── O que existia antes: nada ──────────────────────────────────────────────
 *
 * Zero `app/icon.*`, zero `app/favicon.ico`, zero `public/favicon*` (medido:
 * `public/` tem dois arquivos, `.gitkeep` e `llms.txt`). O navegador pedia
 * `/favicon.ico` por conta própria e recebia 404 — em produção, 19.435 bytes,
 * porque o 404 é a `app/not-found.tsx` INTEIRA servida para um pedido de
 * ícone. Na prática: aba sem marca nenhuma, para nós e para todo revendedor.
 *
 * ─── Por que continua sendo uma ROTA, e não `app/favicon.ico` ──────────────
 *
 * `Dockerfile:75-79` copia `public/` para a imagem final, e a imagem é UMA SÓ
 * para todas as marcas. Um `favicon.ico` estático entregaria a marca do
 * produto na aba de todo revendedor que configurou a dele. A rota decide por
 * requisição: marca do produto → o arquivo da Nebo; marca própria → o ladrilho
 * de cor + inicial. É o mesmo modo de falha que `lib/branding.ts:12-16`
 * documenta para `NEXT_PUBLIC_*`, evitado do mesmo jeito.
 *
 * ─── Cor + inicial, NUNCA o `logo_url` ──────────────────────────────────────
 *
 * `platform_branding.logo_url` é `text` livre, sem CHECK de host
 * (`supabase/baseline.sql:11832-11848`). Buscá-la aqui seria uma requisição de
 * saída disparada pelo `<head>` de TODA página, com a URL vinda de um campo que
 * o operador digita — SSRF com gatilho em cada page load. Derivar o ícone de
 * cor + inicial não toca a rede: o accent vem do mesmo resolvedor que pinta os
 * e-mails (`marcaDaSaida`) e a fonte (`Geist-Regular.ttf`) vem embutida no
 * `@vercel/og` que o Next já traz — nenhuma dependência nova, nenhum download.
 *
 * ─── O ícone do produto, quando a marca é a do produto ──────────────────────
 *
 * Com o NOME do produto em vigor (`iconeEhODoProduto` — o logo não conta,
 * ver o porquê em `lib/branding.ts`), a aba recebe o `favicon.png` de
 * `public/assets/` — o arquivo da marca deste fork, lido do disco (a pasta
 * `public/` vai inteira para a imagem Docker) e devolvido como está, sem
 * satori e sem rede. É o mesmo arquivo que a barra lateral e a fachada
 * mostram (`components/branding/MarcaDoProduto.tsx`), para a aba e a tela
 * contarem a mesma marca. Quem configurou um nome próprio segue com cor +
 * inicial: o ícone da Nebo na aba de quem se chama "Acme" seria a nossa
 * marca vazando.
 *
 * ─── `force-dynamic` não é zelo ─────────────────────────────────────────────
 *
 * O loader de metadata NÃO injeta `force-static` na variante gerada por código
 * (`next-metadata-route-loader.js`, `getSingleImageRouteCode`), mas também não
 * a torna dinâmica sozinha — sem esta linha o `next build` congelaria o ícone
 * dentro da imagem pré-buildada, com a marca de quem buildou. E o defeito seria
 * invisível em dev, em teste e na Vercel: só apareceria na VPS do revendedor,
 * que é o único lugar onde a marca é outra. O loader re-exporta todo named
 * export do arquivo do usuário (`:43`), então declarar aqui basta.
 *
 * ─── Custo ──────────────────────────────────────────────────────────────────
 *
 * Um `ImageResponse` por requisição a `/icon`. O `Cache-Control` abaixo é o que
 * mantém isso em uma renderização por minuto por navegador em vez de uma por
 * navegação. A leitura da marca é a MESMA que o `generateMetadata` do layout já
 * faz, memoizada por 30s (`lib/branding/instalacao.ts:209`) — nenhuma consulta
 * a mais no banco.
 *
 * ⚠️ `/icon` precisa estar em `PUBLIC_PATHS` (`lib/auth/public-paths.ts`): o
 * matcher do `proxy.ts:128` só dispensa caminho COM extensão, e `/icon` não tem
 * — sem a entrada, o ícone responde 307 para `/login` a quem ainda não entrou,
 * que é exatamente a primeira tela que um comprador vê.
 */

export const dynamic = "force-dynamic";

/** 64 e não 32: a aba pede 16-32 CSS px, e em tela retina isso são 32-64 reais. */
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
  const marca = await marcaDaSaida(null);

  if (iconeEhODoProduto({ name: marca.nome })) {
    const arquivo = await lerFaviconDoProduto();
    if (arquivo) {
      return new Response(new Uint8Array(arquivo), {
        headers: { ...CACHE, "content-type": contentType },
      });
    }
    // Sem o arquivo (imagem montada sem `public/`?), a aba não fica em 404:
    // cai no ladrilho de cor + inicial, que não depende de disco.
  }

  const letra = letraDoIcone(marca.nome);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: marca.accent,
        color: marca.accentFg,
        // 62% da altura: a caixa maiúscula do Geist ocupa ~72% do em, então
        // a letra fica com respiro sem virar um selo minúsculo no meio.
        fontSize: Math.round(size.height * 0.62),
        // O ladrilho é quadrado e cheio: o navegador já arredonda o favicon
        // no chrome dele, e arredondar aqui também produz canto duplo.
        borderRadius: 0,
      }}
    >
      {letra ?? ""}
    </div>,
    { ...size, headers: CACHE },
  );
}

// 60s é deliberado, e o par com o TTL da marca: o operador que troca a cor em
// `/admin/marca` vê a aba acompanhar dentro de um minuto. Um `immutable` de um
// ano tornaria a tela de marca uma promessa que o ícone não cumpre; `no-store`
// faria o satori rodar a cada navegação.
const CACHE = { "cache-control": "public, max-age=60, stale-while-revalidate=600" };

/**
 * O favicon do produto, do disco. `null` quando não dá para ler — e quem chama
 * degrada, porque um throw aqui é aba sem ícone em TODA página.
 */
async function lerFaviconDoProduto(): Promise<Buffer | null> {
  try {
    return await readFile(
      path.join(
        process.cwd(),
        "public",
        ...ARQUIVOS_DA_MARCA_DO_PRODUTO.favicon.split("/").filter(Boolean),
      ),
    );
  } catch {
    return null;
  }
}
