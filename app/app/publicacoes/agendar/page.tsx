import type { Metadata } from "next";
import { Suspense } from "react";

import { exigirRecurso } from "@/lib/entitlements/exigir";

import { contextoDePublicacoes } from "../_pagina";
import { AgendarClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agendar publicação" };

export default async function Page() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("broadcast");
  const ctx = await contextoDePublicacoes();
  return (
    <Suspense fallback={null}>
      <AgendarClient fuso={ctx.fuso} agoraIso={new Date().toISOString()} />
    </Suspense>
  );
}
