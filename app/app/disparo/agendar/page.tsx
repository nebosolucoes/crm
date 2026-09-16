import type { Metadata } from "next";

import { DisparoPage } from "../_page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Disparo · Agendar" };

export default function AgendarDisparoPage() {
  return <DisparoPage aba="agendar" />;
}
