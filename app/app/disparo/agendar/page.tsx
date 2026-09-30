import { redirect } from "next/navigation";

/** Rota legada do Disparo: Publicações é o sucessor (migration 0283). Mantida uma release por links salvos. */
export default function Page() {
  redirect("/app/publicacoes/agendar");
}
