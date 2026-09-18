import type { Metadata } from "next";

import { DisparoPage } from "../_page";
import { exigirRecurso } from "@/lib/entitlements/exigir";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Disparo · Histórico" };

export default async function HistoricoDeDisparoPage() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("broadcast");
  return <DisparoPage aba="historico" />;
}
