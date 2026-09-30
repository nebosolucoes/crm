/**
 * Recorrência de Publicações: regra → ocorrências, em HORA DE PAREDE no fuso
 * da publicação.
 *
 * ─── Por que parede e não UTC ───────────────────────────────────────────────
 *
 * O Disparo avançava com `setUTCDate`: "todo dia às 19:30" era "a cada 24 h",
 * e numa virada de horário de verão a oferta passava a sair 18:30 ou 20:30.
 * Aqui o passo é dado nos CAMPOS do calendário (dia, mês) e o instante é lido
 * de novo pelo `instanteDe` de `lib/agenda/fuso.ts`, que resolve a virada
 * (hora que não existe ou existe duas vezes) do mesmo jeito que a Agenda.
 *
 * ─── Materialização com horizonte ───────────────────────────────────────────
 *
 * Ninguém gera "todas" as ocorrências (uma recorrência sem fim é infinita) nem
 * calcula "na hora" (o calendário precisa ver o futuro). O worker chama
 * `proximasOcorrencias` com o horizonte (`lib/publicacoes/politica.ts`) e
 * insere o que falta, `on conflict do nothing`. Mudar a regra regera só as
 * pendentes futuras.
 */
import { diaDaSemanaLocal, instanteDe, partesNoFuso, type ParedeLida } from "@/lib/agenda/fuso";

import type { ConfigDeRecorrencia, TipoDeRecorrencia } from "./schema";

export interface PedidoDeOcorrencias {
  kind: TipoDeRecorrencia;
  config: ConfigDeRecorrencia;
  /** A primeira data escolhida à mão: âncora do passo e da hora do dia. */
  base: Date;
  fuso: string;
  /** Gera só o que vem DEPOIS deste instante (a última já materializada, ou a base). */
  apos: Date;
  /** Gera só até este instante (inclusive): o fim do horizonte. */
  ate: Date;
  repeatUntil?: Date | null;
  maxOccurrences?: number | null;
  /** Quantas já existem (manuais + geradas), para respeitar `maxOccurrences`. */
  jaExistentes: number;
  /** Teto de saída desta chamada (o teto de pendentes da política). */
  limite: number;
}

/** Aritmética de calendário pura: soma dias a uma parede sem olhar fuso. */
function somarDias(p: ParedeLida, dias: number): ParedeLida {
  const d = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + dias, p.hora, p.minuto, p.segundo));
  return {
    ano: d.getUTCFullYear(),
    mes: d.getUTCMonth() + 1,
    dia: d.getUTCDate(),
    hora: p.hora,
    minuto: p.minuto,
    segundo: p.segundo,
  };
}

/**
 * Soma meses PRESERVANDO o dia pedido quando ele existe e travando no último
 * dia quando não existe (31/01 + 1 mês = 28/02, não 03/03). O `dia` original
 * fica na âncora, então 28/02 + 1 mês volta a 31/03.
 */
function somarMeses(p: ParedeLida, meses: number, diaAncora: number): ParedeLida {
  const primeiro = new Date(Date.UTC(p.ano, p.mes - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    ano: primeiro.getUTCFullYear(),
    mes: primeiro.getUTCMonth() + 1,
    dia: Math.min(diaAncora, ultimoDia),
    hora: p.hora,
    minuto: p.minuto,
    segundo: p.segundo,
  };
}

function inteiroPositivo(v: unknown, padrao: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : padrao;
}

/**
 * As próximas ocorrências da regra, estritamente depois de `apos` e até `ate`.
 * Devolve instantes ordenados; pode devolver vazio.
 */
export function proximasOcorrencias(pedido: PedidoDeOcorrencias): Date[] {
  const { kind, config, base, fuso } = pedido;
  if (kind === "none") return [];
  if (Number.isNaN(base.getTime())) return [];

  const saida: Date[] = [];
  const restantes =
    pedido.maxOccurrences && pedido.maxOccurrences > 0
      ? Math.max(0, pedido.maxOccurrences - pedido.jaExistentes)
      : Number.POSITIVE_INFINITY;
  const limite = Math.min(pedido.limite, restantes);
  if (limite <= 0) return [];

  const fim = pedido.repeatUntil && pedido.repeatUntil.getTime() < pedido.ate.getTime()
    ? pedido.repeatUntil
    : pedido.ate;

  const aceitar = (instante: Date): boolean => {
    if (instante.getTime() > fim.getTime()) return false;
    if (instante.getTime() > pedido.apos.getTime()) saida.push(instante);
    return saida.length < limite;
  };

  // `custom` com minutos é o único passo que NÃO é de calendário: é um intervalo
  // fixo de tempo (herdado do Disparo, usado em testes e em cadências curtas).
  const minutos = kind === "custom" ? inteiroPositivo(config.interval_minutes, 0) : 0;
  if (minutos > 0) {
    let atual = base.getTime();
    // Salta de uma vez até depois de `apos` — sem laço de milhares de passos.
    if (atual <= pedido.apos.getTime()) {
      const passos = Math.floor((pedido.apos.getTime() - atual) / (minutos * 60_000)) + 1;
      atual += passos * minutos * 60_000;
    }
    // Guarda de laço: 10 mil passos é mais do que qualquer horizonte de 90 dias
    // em cadência de minutos pede.
    for (let i = 0; i < 10_000; i += 1) {
      if (!aceitar(new Date(atual))) break;
      atual += minutos * 60_000;
    }
    return saida;
  }

  const paredeBase = partesNoFuso(base, fuso);
  const diaAncora = paredeBase.dia;
  const intervalo =
    kind === "custom" ? inteiroPositivo(config.interval_days, inteiroPositivo(config.interval, 1)) : inteiroPositivo(config.interval, 1);
  const diasDaSemana = new Set(kind === "weekdays" ? (config.weekdays ?? []) : []);

  let parede = paredeBase;
  let passo = 0;
  // Guarda de laço: 90 dias de horizonte em passo diário são 90 iterações;
  // 5 000 cobre qualquer combinação razoável de intervalo e horizonte.
  for (let i = 0; i < 5_000; i += 1) {
    passo += 1;
    if (kind === "daily") parede = somarDias(paredeBase, intervalo * passo);
    else if (kind === "weekly") parede = somarDias(paredeBase, 7 * intervalo * passo);
    else if (kind === "monthly") parede = somarMeses(paredeBase, intervalo * passo, diaAncora);
    else if (kind === "custom") parede = somarDias(paredeBase, intervalo * passo);
    else if (kind === "weekdays") parede = somarDias(paredeBase, passo);

    const instante = instanteDe(parede, fuso);
    if (kind === "weekdays" && !diasDaSemana.has(diaDaSemanaLocal(instante, fuso))) {
      if (instante.getTime() > fim.getTime()) break;
      continue;
    }
    if (!aceitar(instante)) break;
  }
  return saida;
}

/** Texto curto da regra para a tela ("Todo dia", "Seg, qua e sex", "A cada 3 dias"). */
export function descreverRecorrencia(kind: TipoDeRecorrencia, config: ConfigDeRecorrencia): string | null {
  const n = inteiroPositivo(config.interval, 1);
  switch (kind) {
    case "none":
      return null;
    case "daily":
      return n === 1 ? "Todo dia" : `A cada ${n} dias`;
    case "weekly":
      return n === 1 ? "Toda semana" : `A cada ${n} semanas`;
    case "monthly":
      return n === 1 ? "Todo mês" : `A cada ${n} meses`;
    case "weekdays": {
      const nomes = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
      const dias = [...(config.weekdays ?? [])].sort((a, b) => a - b).map((d) => nomes[d] ?? String(d));
      return dias.length > 0 ? dias.join(", ") : "Dias da semana";
    }
    case "custom": {
      const minutos = inteiroPositivo(config.interval_minutes, 0);
      if (minutos > 0) return `A cada ${minutos} min`;
      const dias = inteiroPositivo(config.interval_days, n);
      return dias === 1 ? "Todo dia" : `A cada ${dias} dias`;
    }
  }
}
