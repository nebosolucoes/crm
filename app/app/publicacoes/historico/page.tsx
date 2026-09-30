import type { Metadata } from "next";

import { exigirRecurso } from "@/lib/entitlements/exigir";

import { contextoDePublicacoes } from "../_pagina";
import { HistoricoClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Histórico" };

export default async function Page() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("broadcast");
  const ctx = await contextoDePublicacoes();
  return <HistoricoClient podeEditar={ctx.podeEditar} fuso={ctx.fuso} />;
}
