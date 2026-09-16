import type { Metadata } from "next";

import { DisparoPage } from "../_page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Disparo · Histórico" };

export default function HistoricoDeDisparoPage() {
  return <DisparoPage aba="historico" />;
}
