import type { Metadata } from "next";

import { DisparoPage } from "../_page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Disparo · Grupos" };

export default function GruposDeDisparoPage() {
  return <DisparoPage aba="grupos" />;
}
