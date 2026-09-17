import { PlanosClient } from "./_client";

export const metadata = { title: "Planos — Admin Plataforma" };

/**
 * O catálogo comercial da instalação (migration 0275): os planos que o
 * platform admin vende, com os recursos de cada um, quem é o padrão e quantas
 * organizações estão em cada. A atribuição a UMA organização fica na aba
 * Plano do tenant — aqui é o catálogo, lá é o cliente.
 */
export default function AdminPlanosPage() {
  return <PlanosClient />;
}
