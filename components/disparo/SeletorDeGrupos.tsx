"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { CheckSquare, MagnifyingGlass, Square, UsersThree } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/**
 * O destino do disparo: uma lista de grupos com caixa de marcar, agrupada pela
 * conexão (conta do WhatsApp) de cada um, com busca e "marcar todos".
 *
 * Substitui o `<Select>` de um grupo só. Em modo `unico` (edição de um
 * agendamento, que no banco é UMA linha) marcar outro grupo TROCA a escolha em
 * vez de somar — a tela não pode prometer um lote que o PATCH não grava.
 */

export type GrupoSelecionavel = {
  id: string;
  name: string;
  channel_session_id: string;
  is_active: boolean;
  participantes?: number | null;
};

type Props = {
  grupos: GrupoSelecionavel[];
  /** Nome legível de cada conexão, por id. Sem entrada = mostra o id curto. */
  nomeDaConexao: (channelSessionId: string) => string;
  selecionados: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  unico?: boolean;
};

export function SeletorDeGrupos({
  grupos,
  nomeDaConexao,
  selecionados,
  onChange,
  disabled = false,
  unico = false,
}: Props) {
  const t = useT();
  const [busca, setBusca] = useState("");
  const marcados = useMemo(() => new Set(selecionados), [selecionados]);

  const visiveis = useMemo(() => {
    const filtro = busca.trim().toLocaleLowerCase();
    const lista = filtro
      ? grupos.filter((g) => g.name.toLocaleLowerCase().includes(filtro))
      : grupos;
    const porConexao = new Map<string, GrupoSelecionavel[]>();
    for (const g of lista) {
      const atual = porConexao.get(g.channel_session_id) ?? [];
      atual.push(g);
      porConexao.set(g.channel_session_id, atual);
    }
    return [...porConexao.entries()];
  }, [busca, grupos]);

  const idsVisiveis = useMemo(
    () => visiveis.flatMap(([, lista]) => lista.map((g) => g.id)),
    [visiveis],
  );
  const todosVisiveisMarcados =
    idsVisiveis.length > 0 && idsVisiveis.every((id) => marcados.has(id));

  function alternar(id: string) {
    if (disabled) return;
    if (unico) {
      onChange(marcados.has(id) ? [] : [id]);
      return;
    }
    if (marcados.has(id)) onChange(selecionados.filter((s) => s !== id));
    else onChange([...selecionados, id]);
  }

  function marcarTodosVisiveis() {
    if (disabled || unico) return;
    if (todosVisiveisMarcados) onChange(selecionados.filter((id) => !idsVisiveis.includes(id)));
    else onChange([...new Set([...selecionados, ...idsVisiveis])]);
  }

  if (grupos.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        {t("Nenhum grupo salvo ainda. Salve os grupos na aba Grupos para escolher o destino.")}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border" data-seletor-de-grupos>
      <div className="flex items-center gap-2 border-b bg-muted/30 p-2">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Buscar grupo…")}
            aria-label={t("Buscar grupo")}
            className="h-8 pl-8 text-sm"
            disabled={disabled}
          />
        </div>
        {!unico ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-xs"
            onClick={marcarTodosVisiveis}
            disabled={disabled || idsVisiveis.length === 0}
          >
            {todosVisiveisMarcados ? (
              <CheckSquare size={15} weight="fill" className="text-primary" aria-hidden />
            ) : (
              <Square size={15} aria-hidden />
            )}
            {todosVisiveisMarcados ? t("Desmarcar todos") : t("Marcar todos")}
          </Button>
        ) : null}
      </div>
      <div className="max-h-64 overflow-y-auto">
        {visiveis.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {t("Nenhum grupo corresponde à pesquisa.")}
          </p>
        ) : (
          visiveis.map(([conexaoId, lista]) => (
            <div key={conexaoId}>
              <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b bg-surface px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                <UsersThree size={13} aria-hidden />
                {nomeDaConexao(conexaoId)}
              </div>
              <ul className="divide-y" role={unico ? "radiogroup" : "group"}>
                {lista.map((g) => {
                  const marcado = marcados.has(g.id);
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        role={unico ? "radio" : "checkbox"}
                        aria-checked={marcado}
                        onClick={() => alternar(g.id)}
                        disabled={disabled}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
                          marcado && "bg-primary/5",
                        )}
                      >
                        {marcado ? (
                          <CheckSquare
                            size={18}
                            weight="fill"
                            className="shrink-0 text-primary"
                            aria-hidden
                          />
                        ) : (
                          <Square
                            size={18}
                            className="shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{g.name}</span>
                          {typeof g.participantes === "number" ? (
                            <span className="block text-[11px] text-muted-foreground">
                              {g.participantes} {t("participante(s)")}
                            </span>
                          ) : null}
                        </span>
                        {!g.is_active ? <Badge variant="secondary">{t("Inativo")}</Badge> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          {selecionados.length} {t("de")} {grupos.length} {t("grupo(s) selecionado(s)")}
        </span>
        {selecionados.length > 0 && !disabled ? (
          <button
            type="button"
            className="text-xs underline-offset-2 hover:underline"
            onClick={() => onChange([])}
          >
            {t("Limpar")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
