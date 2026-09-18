import { cn } from "@/lib/utils";

/**
 * A marca do PRODUTO — o que a tela mostra quando ninguém configurou marca
 * própria (`marcaEhADoProduto`, em `lib/branding.ts`).
 *
 * Neste fork a marca do produto é a Nebo, e ela vive como ARQUIVO em
 * `public/assets/`: `Icone.png` (o símbolo, quadrado) e `Logo_menu.png` (o
 * logotipo horizontal, fundo transparente). O favicon (`app/icon.tsx`) serve
 * `favicon.png` da mesma pasta. O desenho em SVG do produto original
 * (`lib/branding/desenho.ts`) foi removido junto — sem importador, seria
 * código morto contando outra marca.
 *
 * O `<img>` leva `data-marca-do-produto` DE PROPÓSITO: o e2e `marca-logo.spec.ts`
 * mede "barra sem `<img>` de revendedor" e precisa distinguir o logo do
 * produto do logo subido por quem hospeda — o seletor dele exclui este atributo.
 *
 * O texto alternativo é o `nome` que a tela já resolveu — nunca uma string
 * fixa, para que a catraca de marca (`tests/unit/branding.test.ts`) continue
 * contando ZERO ocorrências fora de `lib/branding.ts`.
 */

/** Os arquivos da marca do produto, servidos de `public/`. */
export const ARQUIVOS_DA_MARCA_DO_PRODUTO = {
  simbolo: "/assets/Icone.png",
  logotipo: "/assets/Logo_menu.png",
  favicon: "/assets/favicon.png",
} as const;

type Props = {
  readonly nome: string;
  readonly className?: string;
  /** `true` quando o texto ao lado já nomeia a marca — evita ler duas vezes. */
  readonly decorativo?: boolean;
};

function acessibilidade(nome: string, decorativo: boolean) {
  return decorativo ? ({ alt: "", "aria-hidden": true } as const) : ({ alt: nome } as const);
}

/** O símbolo sozinho — para a barra recolhida, avatar e cantos apertados. */
export function SimboloDoProduto({ nome, className, decorativo = false }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arquivo estático do produto; next/image exige allowlist/dimensões que não valem para o logo de revendedor ao lado
    <img
      src={ARQUIVOS_DA_MARCA_DO_PRODUTO.simbolo}
      data-marca-do-produto=""
      className={cn("shrink-0 rounded-md object-contain", className)}
      {...acessibilidade(nome, decorativo)}
    />
  );
}

/** Símbolo + nome — para a barra aberta e a fachada de entrada. */
export function LogotipoDoProduto({ nome, className, decorativo = false }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- idem: arquivo estático do produto
    <img
      src={ARQUIVOS_DA_MARCA_DO_PRODUTO.logotipo}
      data-marca-do-produto=""
      className={cn("shrink-0 object-contain", className)}
      {...acessibilidade(nome, decorativo)}
    />
  );
}
