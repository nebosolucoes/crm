"use client";
import { useSyncExternalStore } from "react";

/**
 * A ficha do contato (coluna direita do Inbox, ≥ xl) recolhida ou aberta —
 * preferência POR NAVEGADOR (pedido do dono, 28/09: recolhida por padrão).
 *
 * External store, e não `useState` + `useEffect`: o servidor não conhece o
 * localStorage, então a primeira pintura tem de ser a mesma dos dois lados
 * (`getServerSnapshot` = recolhida) e a preferência entra na re-renderização
 * seguinte — sem `setState` dentro de efeito, que é o que o compilador do
 * React aponta como cascata. Mesma decisão de `lib/notifications/prefs.ts`.
 */
const KEY = "inbox.ficha.recolhida.v1";
const ouvintes = new Set<() => void>();

export function lerFichaRecolhida(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function gravarFichaRecolhida(recolhida: boolean): void {
  try {
    window.localStorage.setItem(KEY, recolhida ? "1" : "0");
  } catch {
    // sem localStorage (janela privada, site data bloqueado): vale só nesta tela
  }
  for (const l of ouvintes) l();
}

function assinar(l: () => void): () => void {
  ouvintes.add(l);
  window.addEventListener("storage", l);
  return () => {
    ouvintes.delete(l);
    window.removeEventListener("storage", l);
  };
}

export function useFichaRecolhida(): boolean {
  return useSyncExternalStore(assinar, lerFichaRecolhida, () => true);
}
