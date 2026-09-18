import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agendamentos" };

export default async function AgendamentosPage() {
  redirect("/app/disparo/lista");
}
