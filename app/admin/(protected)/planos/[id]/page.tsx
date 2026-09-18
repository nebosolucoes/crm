import { PlanoEditarClient } from "./_client";

export const metadata = { title: "Editar plano — Admin Plataforma" };

export default async function AdminPlanoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanoEditarClient id={id} />;
}
