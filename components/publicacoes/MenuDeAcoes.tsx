"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/hooks/i18n/useT";
import { DotsThree } from "@/lib/ui/icons";

/**
 * As quatro ações de uma ocorrência pendente, com a regra decidida no plano:
 * "Alterar horário" e "Cancelar" agem NA OCORRÊNCIA; "Editar" abre a
 * publicação (e avisa que muda todas as datas pendentes); "Excluir" é da
 * publicação. Ocorrência que já saiu não tem menu — só o Histórico.
 */
export function MenuDeAcoes({
  publicacaoId,
  pendente,
  onAlterarHorario,
  onCancelarOcorrencia,
  onCancelarPublicacao,
  onExcluir,
}: {
  publicacaoId: string;
  pendente: boolean;
  onAlterarHorario?: () => void;
  onCancelarOcorrencia?: () => void;
  onCancelarPublicacao?: () => void;
  onExcluir: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Ações da publicação")}>
          <DotsThree size={18} weight="bold" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link href={`/app/publicacoes/agendar?editar=${publicacaoId}`}>{t("Editar publicação")}</Link>
        </DropdownMenuItem>
        {pendente && onAlterarHorario ? <DropdownMenuItem onSelect={onAlterarHorario}>{t("Alterar horário")}</DropdownMenuItem> : null}
        {pendente && onCancelarOcorrencia ? <DropdownMenuItem onSelect={onCancelarOcorrencia}>{t("Cancelar esta data")}</DropdownMenuItem> : null}
        {pendente && onCancelarPublicacao ? <DropdownMenuItem onSelect={onCancelarPublicacao}>{t("Cancelar todas as datas")}</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onExcluir} className="text-destructive focus:text-destructive">
          {t("Excluir publicação")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
