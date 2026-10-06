/** Ordem alfabética do seletor de modelos.
 *
 * O catálogo da OpenRouter tem centenas de modelos e a rota os devolve por
 * preço — útil para os provedores curados, ilegível para quem procura um nome.
 * Aqui a ordem é só o nome exibido: sem caixa ("inclusionAI" fica entre os I),
 * sem acento, com números em ordem natural ("GPT-4" antes de "GPT-10"). O
 * `model_id` desempata, para a ordem não depender da que a rota devolveu.
 */
const COLADOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export function ordenarModelosPorNome<T extends { display_name: string; model_id: string }>(
  modelos: readonly T[],
): T[] {
  return [...modelos].sort(
    (a, b) =>
      COLADOR.compare(a.display_name, b.display_name) || COLADOR.compare(a.model_id, b.model_id),
  );
}
