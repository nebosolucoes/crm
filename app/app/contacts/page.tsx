import type { Metadata } from "next";
import { ContactsListClient } from "./_client";
import { exigirRecurso } from "@/lib/entitlements/exigir";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contatos" };

export default async function ContactsPage() {
  // O plano da organização (migration 0275): antes de qualquer dado.
  await exigirRecurso("crm");
  return <ContactsListClient />;
}
