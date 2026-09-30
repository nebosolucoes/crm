import { redirect } from "next/navigation";

/** Rota legada (antes do Disparo): hoje é Publicações. Mantida por links salvos. */
export default function Page() {
  redirect("/app/publicacoes/lista");
}
