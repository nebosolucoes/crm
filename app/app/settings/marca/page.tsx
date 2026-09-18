import { notFound } from "next/navigation";

export const metadata = { title: "Marca" };
export const dynamic = "force-dynamic";

export default async function MarcaDaOrganizacaoPage() {
  notFound();
}
