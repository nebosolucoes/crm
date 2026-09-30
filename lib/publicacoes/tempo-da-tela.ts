/**
 * Tempo na tela de Publicações — SEMPRE no fuso da publicação (o da
 * organização), nunca no do navegador. O Disparo convertia o `datetime-local`
 * com `new Date(v)`: um gestor em Lisboa agendava 19:30 e a oferta saía 15:30
 * em São Paulo. Aqui a parede digitada vira instante pelo `instanteDe`
 * (DST-safe), e o instante vira parede pelo `partesNoFuso`.
 *
 * Puro: sem React, sem I/O. Testado em `tempo-da-tela.test.ts`.
 */
import { diaLocalISO, instanteDe, partesNoFuso } from "@/lib/agenda/fuso";

const dois = (n: number) => String(n).padStart(2, "0");

/** `"2026-09-30T19:30"` (valor de um `<input type="datetime-local">`) → instante ISO, no fuso dado. */
export function paredeParaInstante(valorDoInput: string, fuso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(valorDoInput.trim());
  if (!m) return null;
  const d = instanteDe(
    { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]), hora: Number(m[4]), minuto: Number(m[5]), segundo: Number(m[6] ?? 0) },
    fuso,
  );
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Instante ISO → `"2026-09-30T19:30"` no fuso dado (para preencher o input). */
export function instanteParaParede(iso: string | Date, fuso: string): string {
  const p = partesNoFuso(new Date(iso), fuso);
  return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}T${dois(p.hora)}:${dois(p.minuto)}`;
}

/** `"HH:mm"` no fuso. */
export function horaLocal(iso: string | Date, fuso: string): string {
  const p = partesNoFuso(new Date(iso), fuso);
  return `${dois(p.hora)}:${dois(p.minuto)}`;
}

/** `"YYYY-MM-DD"` no fuso — a chave de agrupamento por dia. */
export function diaLocal(iso: string | Date, fuso: string): string {
  return diaLocalISO(new Date(iso), fuso);
}

/** Soma dias a um instante preservando a hora de parede no fuso. */
export function mesmaHoraOutroDia(iso: string | Date, dias: number, fuso: string): string {
  const p = partesNoFuso(new Date(iso), fuso);
  return instanteDe({ ano: p.ano, mes: p.mes, dia: p.dia + dias, hora: p.hora, minuto: p.minuto, segundo: 0 }, fuso).toISOString();
}

/** A sugestão de primeiro horário: a próxima hora cheia, pelo menos 5 minutos à frente. */
export function proximaHoraCheia(agora: Date, fuso: string): string {
  const p = partesNoFuso(new Date(agora.getTime() + 5 * 60_000), fuso);
  return instanteDe({ ano: p.ano, mes: p.mes, dia: p.dia, hora: p.hora + 1, minuto: 0, segundo: 0 }, fuso).toISOString();
}

export type RotuloDeDia = { chave: string; tipo: "hoje" | "amanha" | "ontem" | "data"; data: Date };

/** Como o dia de um instante se apresenta na Lista: Hoje, Amanhã, ou a data. */
export function rotuloDoDia(iso: string | Date, agora: Date, fuso: string): RotuloDeDia {
  const chave = diaLocal(iso, fuso);
  const hoje = diaLocal(agora, fuso);
  const amanha = diaLocal(new Date(agora.getTime() + 24 * 60 * 60 * 1000), fuso);
  const ontem = diaLocal(new Date(agora.getTime() - 24 * 60 * 60 * 1000), fuso);
  const p = partesNoFuso(new Date(iso), fuso);
  const data = new Date(Date.UTC(p.ano, p.mes - 1, p.dia, 12));
  if (chave === hoje) return { chave, tipo: "hoje", data };
  if (chave === amanha) return { chave, tipo: "amanha", data };
  if (chave === ontem) return { chave, tipo: "ontem", data };
  return { chave, tipo: "data", data };
}

/** Agrupa itens por dia local, mantendo a ordem de entrada. */
export function agruparPorDia<T>(itens: T[], quando: (item: T) => string, fuso: string): Array<{ dia: string; itens: T[] }> {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    const dia = diaLocal(quando(item), fuso);
    const lista = grupos.get(dia) ?? [];
    lista.push(item);
    grupos.set(dia, lista);
  }
  return [...grupos.entries()].map(([dia, itens]) => ({ dia, itens }));
}

/** Os limites (instantes) de um mês no fuso: do 1º dia 00:00 ao último 23:59:59. */
export function limitesDoMes(ano: number, mes1a12: number, fuso: string): { de: string; ate: string } {
  const de = instanteDe({ ano, mes: mes1a12, dia: 1 }, fuso);
  const ultimoDia = new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
  const ate = instanteDe({ ano, mes: mes1a12, dia: ultimoDia, hora: 23, minuto: 59, segundo: 59 }, fuso);
  return { de: de.toISOString(), ate: ate.toISOString() };
}

/** As células de um mês (semana começa no domingo), com dias vazios como null. */
export function diasDaGradeDoMes(ano: number, mes1a12: number): Array<{ dia: number; chave: string } | null> {
  const primeiro = new Date(Date.UTC(ano, mes1a12 - 1, 1));
  const inicio = primeiro.getUTCDay();
  const total = new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
  const grade: Array<{ dia: number; chave: string } | null> = Array<null>(inicio).fill(null);
  for (let d = 1; d <= total; d += 1) grade.push({ dia: d, chave: `${ano}-${dois(mes1a12)}-${dois(d)}` });
  while (grade.length % 7 !== 0) grade.push(null);
  return grade;
}
