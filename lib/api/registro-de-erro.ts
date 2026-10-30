/**
 * Registro de todo erro da API — migration 0288 (`api_error_log`).
 *
 * O `X-Request-Id` de uma resposta de erro aparece na tela ("ID: …") para o
 * usuário mandar ao suporte, e até aqui não era gravado em lugar nenhum. Agora
 * cada erro deixa duas marcas:
 *
 *   1. uma linha JSON no log do contêiner, NA HORA (síncrona, nunca falha);
 *   2. uma linha em `api_error_log`, DEPOIS da resposta (`after()`), com método,
 *      caminho e usuário — procurável pelo ID.
 *
 * Nenhuma das duas pode quebrar ou atrasar a resposta: fora de um request (teste,
 * script) o `after()` lança e a gravação no banco é simplesmente pulada; falha
 * de escrita vira log, nunca exceção.
 *
 * Método e caminho vêm dos cabeçalhos que o `proxy.ts` carimba no request
 * (`x-pathname`, `x-method`), sempre sobrescrevendo o que o cliente mandou.
 */
import { after } from "next/server";
import { headers } from "next/headers";

import { logger } from "@/lib/logger";

/** Teto do `details` gravado: erro de validação grande não vira linha de 1 MB. */
const TETO_DOS_DETALHES = 4000;

export interface ErroDaApi {
  requestId: string;
  status: number;
  code: string;
  message: string;
  details?: unknown;
  /** Quando quem chama já sabe (ex.: `onRequestError`); senão vem dos cabeçalhos. */
  method?: string | null;
  path?: string | null;
}

export function detalhesGravaveis(details: unknown): unknown {
  if (details === undefined) return null;
  let texto: string;
  try {
    texto = JSON.stringify(details);
  } catch {
    return { nao_serializavel: true };
  }
  if (texto === undefined) return null;
  if (texto.length <= TETO_DOS_DETALHES) return details;
  return { truncado: true, inicio: texto.slice(0, TETO_DOS_DETALHES) };
}

export function registrarErroDaApi(erro: ErroDaApi): void {
  // A suíte de unidade chama `fail()` milhares de vezes; log ali é só ruído.
  if (process.env.VITEST) return;

  try {
    after(() => gravarNoBanco(erro));
  } catch {
    // Fora de um request: não há depois-da-resposta onde gravar nem cabeçalho
    // de onde tirar o ID canônico. Fica só a linha do log.
    logarErro(erro);
  }
}

function logarErro(erro: ErroDaApi): void {
  const contexto = {
    requestId: erro.requestId,
    status: erro.status,
    code: erro.code,
    message: erro.message,
    ...(erro.path ? { path: erro.path } : {}),
    ...(erro.method ? { method: erro.method } : {}),
  };
  if (erro.status >= 500) logger.error("[api] erro", contexto);
  else logger.warn("[api] erro", contexto);
}

/**
 * Exceção que escapou de uma rota, página ou server action (`onRequestError` do
 * `instrumentation.ts`). O ID gravado é o `digest` do Next — o mesmo que a tela
 * "Algo deu errado" mostra.
 */
export async function registrarExcecaoDeRequest(
  err: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string | string[] | undefined> },
): Promise<void> {
  if (process.env.VITEST) return;
  const digest =
    err && typeof err === "object" && "digest" in err && typeof err.digest === "string"
      ? err.digest
      : null;
  const doCabecalho = request.headers?.["x-request-id"];
  const requestId =
    digest ?? (typeof doCabecalho === "string" ? doCabecalho : null) ?? crypto.randomUUID();
  const erro: ErroDaApi = {
    requestId,
    status: 500,
    code: "unhandled_exception",
    message: err instanceof Error ? err.message : String(err),
    details: err instanceof Error && err.stack ? { stack: err.stack.slice(0, 3000) } : undefined,
    method: request.method ?? null,
    path: request.path ?? null,
  };
  // A linha de log sai em `gravarNoBanco`, já com o ID resolvido.
  await gravarNoBanco(erro);
}

async function gravarNoBanco(erro: ErroDaApi): Promise<void> {
  try {
    let cabecalhos: Headers | null = null;
    try {
      cabecalhos = (await headers()) as unknown as Headers;
    } catch {
      cabecalhos = null;
    }
    const method = erro.method ?? cabecalhos?.get("x-method") ?? null;
    const path = erro.path ?? cabecalhos?.get("x-pathname") ?? null;
    // O ID CANÔNICO é o do `proxy.ts`: o cabeçalho que ele põe na resposta vence
    // o que `fail()` sorteou, e é ele que a tela mostra ("ID: …"). Gravar o do
    // `fail()` faria o ID da tela nunca ser encontrado — medido em 30/10/2026.
    // Exceção: o digest de uma exceção não tratada, que é o que a tela de erro mostra.
    const idDoProxy = cabecalhos?.get("x-request-id")?.trim();
    if (idDoProxy && erro.code !== "unhandled_exception") erro = { ...erro, requestId: idDoProxy };
    logarErro({ ...erro, method, path });

    // Sessão expirada não tem usuário a resolver; nos demais casos, quem estava
    // logado é o dado que mais encurta o diagnóstico.
    let usuario: { id: string; email: string | null; nome: string | null } | null = null;
    if (erro.status !== 401) {
      try {
        const { createClient } = await import("@/lib/supabase/server");
        const supabase = await createClient();
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          const meta = data.user.user_metadata as { full_name?: unknown } | undefined;
          usuario = {
            id: data.user.id,
            email: data.user.email ?? null,
            nome: typeof meta?.full_name === "string" ? meta.full_name : null,
          };
        }
      } catch {
        usuario = null;
      }
    }
    const userId = usuario?.id ?? null;

    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { error } = await createAdminClient()
      .from("api_error_log" as never)
      .insert({
        request_id: erro.requestId,
        method: method?.slice(0, 16) ?? null,
        path: path?.slice(0, 500) ?? null,
        status: erro.status,
        code: erro.code.slice(0, 200),
        message: erro.message.slice(0, 2000),
        details: detalhesGravaveis(erro.details),
        user_id: userId,
      } as never);
    if (error) {
      logger.error("[api] erro não gravado em api_error_log", {
        requestId: erro.requestId,
        motivo: error.message,
      });
    }

    // Webhook de erro (Admin › Webhook de erro, migration 0290): um card por
    // erro na central de chamados. Vai mesmo se a gravação acima falhou — o
    // aviso é justamente o que sobra quando o banco está com problema.
    const { avisarErro } = await import("@/lib/suporte/webhook-de-erro");
    await avisarErro({
      requestId: erro.requestId,
      status: erro.status,
      code: erro.code,
      message: erro.message,
      method,
      path,
      details: erro.details,
      usuario,
      quando: new Date(),
    });
  } catch (err) {
    logger.error("[api] erro não gravado em api_error_log", {
      requestId: erro.requestId,
      motivo: err instanceof Error ? err.message : String(err),
    });
  }
}
