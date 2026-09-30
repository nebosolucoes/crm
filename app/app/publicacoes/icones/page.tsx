import type { Metadata } from "next";

import { exigirRecurso } from "@/lib/entitlements/exigir";

import { IconesClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ícones de canal" };

/**
 * Página de validação visual: as 8 combinações de rede × formato do
 * `ChannelIcon`, nos 3 estados, lado a lado. Não é destino de operação —
 * está na allowlist de `tests/unit/navegacao-completude.test.ts`.
 */
export default async function Page() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("broadcast");
  return <IconesClient />;
}
