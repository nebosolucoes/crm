import type { Metadata } from "next";

import { exigirRecurso } from "@/lib/entitlements/exigir";

import { contextoDePublicacoes } from "../_pagina";
import { InstrucoesClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Instruções de legenda" };

export default async function Page() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("broadcast");
  const ctx = await contextoDePublicacoes();
  return <InstrucoesClient podeEditar={ctx.podeEditar} />;
}
