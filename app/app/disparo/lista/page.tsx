import type { Metadata } from "next";

import { DisparoPage } from "../_page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Disparo · Lista" };

export default function ListaDeDisparosPage() {
  return <DisparoPage aba="agendamentos" />;
}
