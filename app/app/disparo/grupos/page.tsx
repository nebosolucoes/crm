import type { Metadata } from "next";

import { DisparoPage } from "../_page";
import { exigirRecurso } from "@/lib/entitlements/exigir";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Disparo · Grupos" };

export default async function GruposDeDisparoPage() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("broadcast");
  return <DisparoPage aba="grupos" />;
}
