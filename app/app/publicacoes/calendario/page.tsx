import type { Metadata } from "next";

import { exigirRecurso } from "@/lib/entitlements/exigir";

import { contextoDePublicacoes } from "../_pagina";
import { CalendarioClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendário" };

export default async function Page() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("broadcast");
  const ctx = await contextoDePublicacoes();
  return <CalendarioClient podeEditar={ctx.podeEditar} fuso={ctx.fuso} />;
}
