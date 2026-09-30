/**
 * Os slides da prévia: um por destino marcado, na ordem Instagram → Facebook →
 * WhatsApp e, dentro da rede, Feed → Stories → Reels. Puro, para o teste
 * provar a ordem e o rótulo sem montar React.
 */
import type { DestinoDaPublicacao, FormatoDaPublicacao, RedeDaPublicacao } from "@/lib/publicacoes/schema";

import { ROTULO_DA_REDE, ROTULO_DO_FORMATO } from "../rotulos";

export interface SlideDaPrevia {
  chave: string;
  rede: RedeDaPublicacao;
  formato: FormatoDaPublicacao;
  contaId: string;
  /** "Instagram · Feed" */
  rotulo: string;
  /** Só WhatsApp. */
  grupoIds: string[];
}

const ORDEM_DA_REDE: Record<RedeDaPublicacao, number> = { instagram: 0, facebook: 1, whatsapp: 2 };
const ORDEM_DO_FORMATO: Record<FormatoDaPublicacao, number> = { feed: 0, story: 1, reel: 2, group_message: 3 };

export function slidesDosDestinos(destinos: DestinoDaPublicacao[]): SlideDaPrevia[] {
  return [...destinos]
    .sort((a, b) => ORDEM_DA_REDE[a.network] - ORDEM_DA_REDE[b.network] || ORDEM_DO_FORMATO[a.format] - ORDEM_DO_FORMATO[b.format])
    .map((d) => ({
      chave: `${d.network}/${d.format}/${d.channel_session_id}`,
      rede: d.network,
      formato: d.format,
      contaId: d.channel_session_id,
      rotulo: `${ROTULO_DA_REDE[d.network]} · ${ROTULO_DO_FORMATO[d.format]}`,
      grupoIds: d.group_ids ?? [],
    }));
}

/** Mantém o slide atual quando a lista muda; se ele sumiu, volta ao primeiro. */
export function indiceValido(atual: number, slides: SlideDaPrevia[], chaveAtual: string | null): number {
  if (slides.length === 0) return 0;
  const porChave = chaveAtual ? slides.findIndex((s) => s.chave === chaveAtual) : -1;
  if (porChave >= 0) return porChave;
  return Math.min(Math.max(0, atual), slides.length - 1);
}
