/**
 * A chave que liga e desliga o TEMA ESCURO no produto inteiro.
 *
 * Decisão do dono do produto (2026-09-21): por enquanto só o tema claro. O
 * escuro continua todo no lugar — tokens em `app/globals.css`, `ThemeProvider`
 * em `lib/theme.tsx`, botão em `components/theme/theme-toggle.tsx` — e volta
 * inteiro trocando UMA linha: `TEMA_ESCURO_HABILITADO = true`.
 *
 * Por que uma constante e não uma env: env é decisão de quem instala, e isto é
 * decisão do produto. Além disso o script anti-flash de `app/layout.tsx` é uma
 * string inline que precisa saber a resposta no build, não em runtime.
 *
 * Quem consulta a chave (e o que cada um faz com ela desligada):
 * - `lib/theme.tsx` — a preferência lida do localStorage e a do sistema
 *   operacional colapsam para "light"; gravar "dark"/"system" grava "light".
 * - `app/layout.tsx` — o script inline pinta `data-theme="light"` sem olhar o
 *   localStorage; a cor da barra do navegador fica só a do tema claro.
 * - `components/theme/theme-toggle.tsx` — o botão (e o atalho) somem.
 *
 * Vigiado por `tests/unit/tema-escuro-desligado.test.tsx`. O arquivo NÃO tem
 * `"use client"` de propósito: `app/layout.tsx` é Server Component e precisa
 * do VALOR, não de uma referência de cliente.
 */
export const TEMA_ESCURO_HABILITADO = false;

/** O vocabulário de `lib/theme.tsx`, repetido aqui para não importar módulo cliente. */
export type PreferenciaDeTema = "light" | "dark" | "system";

/**
 * Reduz uma preferência ao que a chave permite. Com o escuro desligado, tudo
 * vira "light" — inclusive "system", porque "system" num SO escuro resolveria
 * para escuro.
 */
export function preferenciaPermitida(pref: PreferenciaDeTema): PreferenciaDeTema {
  return TEMA_ESCURO_HABILITADO ? pref : "light";
}
