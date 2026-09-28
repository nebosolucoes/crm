/**
 * O painel por setor (spec 20 §4, fase 5) — a agregação PURA, separada da
 * consulta para ser medida sem banco.
 *
 * Uma linha por setor ativo, mais a linha "Sem setor" no fim, sempre: conversa
 * sem setor é um estado real (organização que não criou setor, ou setor
 * desativado), e escondê-la seria contar menos do que existe.
 */

export interface SetorDoPainel {
  id: string;
  name: string;
}

export interface EntradaDoPainel {
  setores: readonly SetorDoPainel[];
  /** Conversas ABERTAS (open/pending/claimed/ai_handling): setor e dono. */
  abertas: ReadonlyArray<{ sector_id: string | null; assigned_to_user_id: string | null }>;
  /** Conversas com mensagem de saída nas últimas 24 h. */
  respondidas: ReadonlyArray<{ sector_id: string | null }>;
  /** Eventos `sector_transfer` dos últimos 30 dias: o setor de ORIGEM. */
  transferencias: ReadonlyArray<{ from_sector_id: string | null }>;
  /** Conversas com handoff da IA nos últimos 30 dias: o setor em que estão. */
  handoffs: ReadonlyArray<{ sector_id: string | null }>;
}

export interface LinhaDoPainel {
  /** `null` = a linha "Sem setor". */
  sectorId: string | null;
  nome: string;
  semDono: number;
  comDono: number;
  respondidas: number;
  transferidasParaFora: number;
  handoffsRecebidos: number;
}

/** Rótulo canônico da linha sem setor — a tela traduz com `t()`. */
export const ROTULO_SEM_SETOR = "Sem setor";

export function agruparPainelPorSetor(entrada: EntradaDoPainel): LinhaDoPainel[] {
  const conhecidos = new Set(entrada.setores.map((s) => s.id));
  // Setor inativo (ou apagado) vira "Sem setor": é como a RLS o trata.
  const chave = (id: string | null | undefined): string | null => (id && conhecidos.has(id) ? id : null);
  const linhas = new Map<string | null, LinhaDoPainel>();
  const linha = (id: string | null): LinhaDoPainel => {
    let l = linhas.get(id);
    if (!l) {
      l = {
        sectorId: id,
        nome: id === null ? ROTULO_SEM_SETOR : (entrada.setores.find((s) => s.id === id)?.name ?? id),
        semDono: 0,
        comDono: 0,
        respondidas: 0,
        transferidasParaFora: 0,
        handoffsRecebidos: 0,
      };
      linhas.set(id, l);
    }
    return l;
  };
  for (const s of entrada.setores) linha(s.id);
  linha(null);

  for (const c of entrada.abertas) {
    const l = linha(chave(c.sector_id));
    if (c.assigned_to_user_id) l.comDono += 1;
    else l.semDono += 1;
  }
  for (const c of entrada.respondidas) linha(chave(c.sector_id)).respondidas += 1;
  for (const e of entrada.transferencias) linha(chave(e.from_sector_id)).transferidasParaFora += 1;
  for (const c of entrada.handoffs) linha(chave(c.sector_id)).handoffsRecebidos += 1;

  const ordenadas = [...linhas.values()].filter((l) => l.sectorId !== null);
  ordenadas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return [...ordenadas, linha(null)];
}
