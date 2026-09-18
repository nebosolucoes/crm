/**
 * DSN do Sentry com opt-out em runtime.
 *
 * ⚠️ ESTE FORK NÃO TEM SENTRY DE COMUNIDADE, E É DE PROPÓSITO.
 *
 * O upstream (`melgarafael/DeskcommCRM`) fixa aqui o DSN do Sentry DELE, e a regra
 * de lá é "`SENTRY_DSN` vazio → manda pro Sentry do projeto". Num fork privado isso
 * é erro de produção da NOSSA instalação caindo na caixa de um terceiro — e caindo
 * por OMISSÃO, que é o pior jeito: bastava o `.env` da VPS ter a chave em branco,
 * que é exatamente como os dois `.env.*.example` saíam.
 *
 * Aqui o default é NÃO ENVIAR. Quem hospeda controla pelo `.env`, sem rebuild:
 *
 *   SENTRY_DSN=  (vazio)     → nenhuma telemetria (padrão deste fork)
 *   SENTRY_DSN=off           → o mesmo, dito em voz alta
 *   SENTRY_DSN=<seu-dsn>     → manda os erros pro SEU Sentry
 *
 * Vale para servidor (process.env) e navegador (window.__PUBLIC_ENV__.SENTRY_DSN,
 * injetado em runtime pelo <PublicEnvScript/>).
 *
 * ⚠️ AO TRAZER `main` DO UPSTREAM, confira que o merge não ressuscitou o literal:
 *
 *   grep -rn "ingest\..*sentry\.io" lib app workers --include=*.ts --include=*.tsx
 *
 * O esperado é vazio, e `tests/unit/sentry-comunidade-so-erro.test.ts` reprova
 * quando não é — um conflito resolvido no automático não devolve o DSN em silêncio.
 */
export const DEFAULT_SENTRY_DSN: string | undefined = undefined;

export function resolveSentryDsn(value: string | undefined | null): string | undefined {
  const v = (value ?? "").trim().toLowerCase() === "off" ? "off" : (value ?? "").trim();
  if (v === "off" || v === "false" || v === "0") return undefined;
  return v.length > 0 ? v : DEFAULT_SENTRY_DSN;
}

/**
 * Estamos mandando para um Sentry COLETIVO, e não para o do operador?
 *
 * ⚠️ NESTE FORK A RESPOSTA É SEMPRE `false`: `DEFAULT_SENTRY_DSN` é `undefined`, então
 * ou a telemetria está desligada, ou o DSN é de quem hospeda. O que segue descreve a
 * política herdada do upstream, e continua valendo se a constante voltar a apontar
 * para algum lugar.
 *
 * Isso decide a amostragem (issue #100). No DSN da comunidade só vai ERRO:
 * `tracesSampleRate` e `replaysSessionSampleRate` vão a 0. O que ajuda a corrigir
 * "bug que afeta todo mundo" é o stack trace — não 100% das transações nem 10% das
 * sessões de um CRM que não é nosso. Quem aponta para o próprio Sentry recebe tudo,
 * porque aí o dado não sai da infraestrutura de quem é dono dele.
 */
export function isCommunityDsn(dsn: string | undefined): boolean {
  // O `!== undefined` não é decorativo: sem ele, `isCommunityDsn(undefined)` — o
  // caso de telemetria DESLIGADA, que é o padrão deste fork — devolveria `true`,
  // porque a constante também é `undefined`. Neste fork a resposta é sempre
  // `false`; a função fica porque volta a valer sozinha se alguém um dia apontar
  // a constante para um DSN coletivo nosso.
  return DEFAULT_SENTRY_DSN !== undefined && dsn === DEFAULT_SENTRY_DSN;
}

/** Integração default do SDK que emite as sessões de release health do browser. */
export const INTEGRACAO_DE_SESSAO = "BrowserSession";

/**
 * Integração default do SDK que instrumenta performance (pageload/navegação) e,
 * como parte disso, registra `PerformanceObserver`s para Web Vitals (CLS/LCP/TTFB
 * etc. — `browserTracingIntegration` → `@sentry/react` → uma cópia interna do
 * `web-vitals`). Mesma classe de custo que `INTEGRACAO_DE_SESSAO`: no DSN da
 * comunidade `tracesSampleRate` já é 0 (declarado logo abaixo), então nenhum
 * trace desses observers É ENVIADO — mas os observers continuam INSTALADOS e
 * RODANDO mesmo assim, porque a decisão de amostragem do SDK acontece depois da
 * coleta, não antes de instalar o listener.
 *
 * Achado em produção (self-host, 2026-09-09): `TypeError: Cannot read
 * properties of undefined (reading 'startTime')` no console do navegador, saindo
 * de dentro do coletor de CLS/LCP desta integração — a lista de entries de um
 * `PerformanceObserver` trouxe um item `undefined`, quase certamente por uma
 * extensão do navegador que intercepta/corrompe a Performance API da página (o
 * mesmo usuário via outros dois erros de console vindos de uma extensão sua,
 * na mesma tela). O bug em si é upstream (`web-vitals`/Sentry SDK, não dá pra
 * corrigir daqui) — mas rodar esse coletor sem NUNCA poder enviar nada é o
 * exato "custo invisível" que este arquivo já rejeita para sessão. Tirar a
 * integração pra quem está na comunidade elimina o crash pra essa população
 * inteira, de graça, sem perder telemetria nenhuma (não havia o que perder).
 *
 * Quem aponta pro PRÓPRIO Sentry (`tracesSampleRate: 1`) mantém a integração —
 * ali o trace tem para onde ir, e o crash upstream (se acontecer, sob a mesma
 * combinação de extensão de navegador) é risco que a pessoa já assumiu ao
 * habilitar tracing de verdade.
 */
export const INTEGRACAO_DE_TRACING = "BrowserTracing";

/**
 * Quais integrações do browser valem para o DSN em uso.
 *
 * A política de `isCommunityDsn` estava DECLARADA e não estava em vigor. As duas
 * amostragens foram a zero (`tracesSampleRate`, `replaysSessionSampleRate`) e o
 * fluxo de SESSÃO ficou de fora da conta: `browserSessionIntegration` entra por
 * default no `@sentry/browser` e o `lifecycle` dela é `"route"`, então cada troca
 * de rota fecha uma sessão e abre outra — duas por navegação, `errors: 0`.
 *
 * Sessão não é stack trace: ela não explica bug de ninguém, e é exatamente o que o
 * comentário do `isCommunityDsn` diz não querer ("não 100% das transações nem 10%
 * das sessões de um CRM que não é nosso"). O custo era invisível porque o dado ia
 * embora sozinho.
 *
 * Medido em 2026-08-10 sobre `dc2f9f96`, um percurso de 7 telas: 17 respostas do
 * ingest, TODAS `429`, com `x-sentry-rate-limits: 60::organization:suspended` —
 * lista de categorias vazia, isto é, todas as categorias. A organização estava
 * suspensa por cota, então nem o erro real de instalação real entrava; e cada
 * tentativa barrada virava erro de console no browser de quem hospeda.
 *
 * Quem aponta para o PRÓPRIO Sentry continua recebendo tudo, sessão inclusive: lá
 * o dado não sai da infraestrutura de quem é dono dele, e release health é
 * legítimo. A assimetria é a mesma das amostragens.
 */
export function integracoesDoCliente<T extends { name: string }>(
  padraoDoSdk: readonly T[],
  paraAComunidade: boolean,
): T[] {
  if (!paraAComunidade) return [...padraoDoSdk];
  return padraoDoSdk.filter(
    (i) => i.name !== INTEGRACAO_DE_SESSAO && i.name !== INTEGRACAO_DE_TRACING,
  );
}
