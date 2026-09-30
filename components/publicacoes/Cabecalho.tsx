"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { Plus } from "@/lib/ui/icons";

/** O topo das telas de Publicações: título, o que a tela é, e a porta para agendar. */
export function CabecalhoDePublicacoes({ titulo, descricao, podeEditar, acao }: { titulo: string; descricao: string; podeEditar: boolean; acao?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {acao}
        {podeEditar ? (
          <Button asChild size="sm">
            <Link href="/app/publicacoes/agendar" data-testid="nova-publicacao">
              <Plus size={14} aria-hidden />
              {t("Agendar publicação")}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
