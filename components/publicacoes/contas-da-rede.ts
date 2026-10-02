import { FORMATOS_POR_REDE, chaveDeDestino, type DestinoDaPublicacao, type FormatoDaPublicacao, type RedeDaPublicacao } from "@/lib/publicacoes/schema";

/** As contas que uma rede usa nesta publicação, na ordem em que entraram. */
export function contasMarcadasDaRede(destinos: DestinoDaPublicacao[], rede: RedeDaPublicacao): string[] {
  return [...new Set(destinos.filter((d) => d.network === rede).map((d) => d.channel_session_id))];
}

/**
 * Grava a escolha da janela de contas: todo formato ligado da rede (mais o
 * `formatoNovo`, quando a janela abriu por um ícone apagado) sai em CADA conta
 * marcada. Destino que já existia é mantido como está (id e opções); o que
 * nasce copia as opções de um irmão do mesmo formato. Nenhuma conta marcada
 * tira a rede da publicação.
 */
export function aplicarContasNaRede(
  destinos: DestinoDaPublicacao[],
  rede: RedeDaPublicacao,
  formatoNovo: FormatoDaPublicacao | null,
  contas: string[],
): DestinoDaPublicacao[] {
  const outros = destinos.filter((d) => d.network !== rede);
  const daRede = destinos.filter((d) => d.network === rede);
  if (contas.length === 0) return outros;
  const ligados = new Set(daRede.map((d) => d.format));
  if (formatoNovo) ligados.add(formatoNovo);
  const porChave = new Map(daRede.map((d) => [chaveDeDestino(d), d]));
  const novos: DestinoDaPublicacao[] = [];
  for (const format of FORMATOS_POR_REDE[rede]) {
    if (!ligados.has(format)) continue;
    const irmao = daRede.find((d) => d.format === format);
    for (const conta of contas) {
      const existente = porChave.get(chaveDeDestino({ network: rede, format, channel_session_id: conta }));
      novos.push(existente ?? { network: rede, format, channel_session_id: conta, group_ids: undefined, settings: { ...(irmao?.settings ?? {}) } });
    }
  }
  return [...outros, ...novos];
}
