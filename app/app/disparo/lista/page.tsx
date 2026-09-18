import type { Metadata } from "next";

import { DisparoPage } from "../_page";
import { exigirRecurso } from "@/lib/entitlements/exigir";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Disparo · Lista" };

export default async function ListaDeDisparosPage() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("broadcast");
  return <DisparoPage aba="agendamentos" />;
}
