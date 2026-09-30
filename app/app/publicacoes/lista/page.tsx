import type { Metadata } from "next";

import { exigirRecurso } from "@/lib/entitlements/exigir";

import { contextoDePublicacoes } from "../_pagina";
import { ListaClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Publicações" };

export default async function Page() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("broadcast");
  const ctx = await contextoDePublicacoes();
  return <ListaClient podeEditar={ctx.podeEditar} fuso={ctx.fuso} agoraIso={new Date().toISOString()} />;
}
