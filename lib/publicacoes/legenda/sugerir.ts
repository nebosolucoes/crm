import type pg from "pg";
import type { ModelMessage } from "ai";

import {
  LlmBudgetExceededError,
  LlmModelNotEnabledError,
  LlmNotConfiguredError,
  normalizarErro,
  runModelCall,
  type LlmEdgeConfig,
} from "@/lib/agent-engine/edge/llm/run-model-call";
import { visaoEmVigor } from "@/lib/ai/pontos/capacidade-em-vigor";
import { isPublicationMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";
import { INSTRUCAO_PADRAO } from "@/lib/publicacoes/legenda/instrucoes";
import { limparLegenda, montarPedidoDeLegenda, type ImagemDoPedido, type SugerirLegenda } from "@/lib/publicacoes/legenda/montar-pedido";

/**
 * SUGERIR LEGENDA — o ponto de IA `legenda_de_publicacao`.
 *
 * Lê a instrução da rede escolhida, baixa as imagens já anexadas (só do
 * prefixo desta organização), monta o pedido e chama o modelo pela MESMA camada
 * do resto do produto (`runModelCall`): chave da organização, modelo escolhido
 * por ponto em IA › Provedores, teto de orçamento e linha em `llm_calls`.
 *
 * As dependências entram por parâmetro para a regra ser testável sem banco,
 * bucket nem provedor; a rota (`app/api/v1/publicacoes/legenda/sugerir`) liga
 * as reais.
 */

export const PONTO_DA_LEGENDA = "legenda_de_publicacao";

/** A chamada real, pela camada única de IA. O `purpose` é literal de propósito: a cerca de pontos lê o literal. */
export function chamarModeloDaLegenda(db: pg.Pool, cfg: LlmEdgeConfig, orgId: string): DepsDaLegenda["chamarModelo"] {
  return async (pedido, conferir) => {
    const r = await runModelCall(
      db,
      cfg,
      { tenantId: orgId, purpose: "legenda_de_publicacao", system: pedido.system, messages: pedido.messages },
      { conferirAntesDeEnviar: conferir },
    );
    return { text: r.result.text, model: r.model, callId: r.callId };
  };
}

/** A mesma régua de visão do motor (`visaoEmVigor`): num roteador, o catálogo manda. */
export function enxergaPeloCatalogo(db: pg.Pool): DepsDaLegenda["enxerga"] {
  return async ({ provider, model }) =>
    (
      await visaoEmVigor({
        provider,
        modelId: model,
        catalogo: async () => {
          const { rows } = await db.query<{ supports_vision: boolean | null }>(
            "select supports_vision from ai_models where provider = $1 and model_id = $2 and deprecated_at is null limit 1",
            [provider, model],
          );
          return rows[0]?.supports_vision ?? null;
        },
      })
    ).enxerga;
}

export interface DepsDaLegenda {
  /** Instrução gravada da rede, ou `null` (vale o padrão). */
  lerInstrucao: () => Promise<string | null>;
  /** Bytes de um arquivo do bucket; `null` quando não existe. */
  baixar: (storagePath: string) => Promise<{ data: Uint8Array; mime: string } | null>;
  /**
   * Chama o modelo. `conferir` recebe provider/modelo decididos e pode recusar
   * antes de sair byte — é por onde a falta de visão vira motivo, não legenda inventada.
   */
  chamarModelo: (
    pedido: { system: string; messages: ModelMessage[] },
    conferir: (escolha: { provider: string; model: string }) => Promise<void>,
  ) => Promise<{ text: string; model: string; callId: string | null }>;
  /** O modelo escolhido enxerga imagem? */
  enxerga: (escolha: { provider: string; model: string }) => Promise<boolean>;
}

export interface LegendaSugerida {
  caption: string;
  network: SugerirLegenda["network"];
  used_images: number;
  ignored_videos: number;
  personalizada: boolean;
  model: string;
  llm_call_id: string | null;
}

/** Recusa nomeada — a rota vira 4xx com a frase; a tela mostra no painel. */
export class ErroDaLegenda extends Error {
  constructor(
    public readonly codigo:
      | "media_not_found"
      | "media_not_image"
      | "modelo_sem_visao"
      | "ia_nao_configurada"
      | "modelo_nao_habilitado"
      | "orcamento_esgotado"
      | "resposta_vazia"
      | "provedor_falhou",
    mensagem: string,
    public readonly status: number,
    public readonly detalhe?: string,
  ) {
    super(mensagem);
  }
}

class ModeloSemVisao extends Error {
  constructor(public readonly model: string) {
    super("modelo_sem_visao");
  }
}

export async function sugerirLegenda(orgId: string, pedido: SugerirLegenda, deps: DepsDaLegenda): Promise<LegendaSugerida> {
  const imagens: ImagemDoPedido[] = [];
  for (const path of pedido.media_paths) {
    if (!isPublicationMediaPathOwnedBy(path, orgId)) {
      throw new ErroDaLegenda("media_not_found", "Arquivo não encontrado.", 404);
    }
    const arquivo = await deps.baixar(path);
    if (!arquivo) throw new ErroDaLegenda("media_not_found", "Arquivo não encontrado.", 404);
    const mime = arquivo.mime.split(";")[0]!.trim().toLowerCase();
    if (!mime.startsWith("image/")) {
      throw new ErroDaLegenda("media_not_image", "A IA só lê imagens; vídeo e documento ficam de fora.", 422);
    }
    imagens.push({ data: arquivo.data, mediaType: mime });
  }

  const gravada = (await deps.lerInstrucao())?.trim() ?? "";
  const instrucao = gravada || INSTRUCAO_PADRAO[pedido.network];
  const { system, messages, limite } = montarPedidoDeLegenda({
    network: pedido.network,
    formats: pedido.formats,
    idea: pedido.idea,
    instrucao,
    imagens,
    videosIgnorados: pedido.ignored_videos,
  });

  let resposta: Awaited<ReturnType<DepsDaLegenda["chamarModelo"]>>;
  try {
    resposta = await deps.chamarModelo({ system, messages }, async (escolha) => {
      if (imagens.length > 0 && !(await deps.enxerga(escolha))) throw new ModeloSemVisao(escolha.model);
    });
  } catch (err) {
    throw traduzirFalha(err);
  }

  const caption = limparLegenda(resposta.text, limite);
  if (!caption) throw new ErroDaLegenda("resposta_vazia", "A IA respondeu em branco. Tente gerar outra.", 502);
  return {
    caption,
    network: pedido.network,
    used_images: imagens.length,
    ignored_videos: pedido.ignored_videos,
    personalizada: gravada.length > 0,
    model: resposta.model,
    llm_call_id: resposta.callId,
  };
}

function traduzirFalha(err: unknown): ErroDaLegenda {
  if (err instanceof ErroDaLegenda) return err;
  if (err instanceof ModeloSemVisao) {
    return new ErroDaLegenda(
      "modelo_sem_visao",
      "O modelo configurado para Legenda de publicação não lê imagens. Troque-o em IA › Provedores.",
      422,
      err.model,
    );
  }
  if (err instanceof LlmNotConfiguredError || (err instanceof Error && /modelo LLM não definido/.test(err.message))) {
    return new ErroDaLegenda("ia_nao_configurada", "A IA ainda não está configurada nesta organização. Cadastre uma chave em IA › Provedores.", 422);
  }
  if (err instanceof LlmModelNotEnabledError) {
    return new ErroDaLegenda("modelo_nao_habilitado", "O modelo escolhido não está habilitado para esta organização. Confira em IA › Provedores.", 422);
  }
  if (err instanceof LlmBudgetExceededError) {
    return new ErroDaLegenda("orcamento_esgotado", "O orçamento mensal de IA acabou. Ajuste em Uso de IA › Orçamento.", 422);
  }
  const { error_code } = normalizarErro(err);
  return new ErroDaLegenda(
    "provedor_falhou",
    "O provedor de IA não respondeu. O motivo ficou registrado em IA › Execuções.",
    502,
    error_code,
  );
}
