import { PlanoDoTenantClient } from "./_client";

export const metadata = { title: "Plano do tenant — Admin Plataforma" };

/**
 * A aba Plano de um tenant (migration 0275): o plano atribuído, o que ele pode
 * usar de fato (plano | override | efetivo), as liberações especiais com prazo,
 * e onde se troca tudo isso — sempre com motivo, sempre auditado, sempre com
 * aviso na Central do cliente.
 */
export default async function AdminTenantPlanoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanoDoTenantClient tenantId={id} />;
}
