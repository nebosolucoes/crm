import type { Metadata } from "next";

import { DisparoPage } from "../_page";
import { exigirRecurso } from "@/lib/entitlements/exigir";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Disparo · Agendar" };

export default async function AgendarDisparoPage() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("broadcast");
  return <DisparoPage aba="agendar" />;
}
