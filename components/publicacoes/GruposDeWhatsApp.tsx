"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { useContasPublicaveis } from "@/hooks/publicacoes/usePublicacoes";
import { apiClient } from "@/lib/api/client";
import { ArrowsClockwise, UsersThree } from "@/lib/ui/icons";

interface GrupoSalvo {
  id: string;
  channel_session_id: string;
  external_group_id: string;
  name: string;
  is_active: boolean;
  last_seen_at: string | null;
  metadata: { participant_count?: number | null; group_kind?: string } | null;
}

/**
 * Os grupos que podem receber publicações. "Buscar" lê a lista da conexão e
 * SALVA tudo de uma vez (grupo novo entra ativo; quem já estava mantém o que
 * você decidiu); desativar tira o grupo das escolhas sem apagar a história.
 */
export function GruposDeWhatsApp({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: contas } = useContasPublicaveis();
  const conexoes = useMemo(() => (contas ?? []).filter((c) => c.network === "whatsapp" && c.publica_grupos), [contas]);
  const [conexaoId, setConexaoId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const conexaoAtual = conexaoId ?? conexoes[0]?.id ?? null;

  const { data: grupos, isLoading } = useQuery({
    queryKey: ["publicacoes", "grupos", conexaoAtual],
    queryFn: async () => (await apiClient.get<{ data: GrupoSalvo[] }>(`/api/v1/agendamentos/grupos?channel_session_id=${conexaoAtual}`)).data,
    enabled: conexaoAtual !== null,
  });
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ["publicacoes", "grupos"] });
    void qc.invalidateQueries({ queryKey: ["publicacoes", "grupos-salvos"] });
  };
  const buscar = useMutation({
    mutationFn: async () => (await apiClient.post<{ data: { groups: unknown[]; saved: number } }>("/api/v1/agendamentos/grupos/sync", { channel_session_id: conexaoAtual }, { timeoutMs: 45_000 })).data,
    onSuccess: (r) => {
      invalidar();
      toast.success(r.saved > 0 ? `${r.saved} ${t("grupo(s) encontrado(s) e salvo(s).")}` : t("Nenhum grupo encontrado nesta conexão."));
    },
    onError: showApiError,
  });
  const alternar = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => apiClient.patch(`/api/v1/agendamentos/grupos/${id}`, { is_active }),
    onSuccess: invalidar,
    onError: showApiError,
  });

  const visiveis = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return (grupos ?? []).filter((g) => !q || g.name.toLowerCase().includes(q)).sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name));
  }, [grupos, filtro]);

  if (conexoes.length === 0 && contas) {
    return <EmptyState icon={UsersThree} headline={t("Nenhuma conexão de WhatsApp que envie para grupos")} subcopy={t("Conecte um número em Conexões para buscar os grupos dele.")} primary={{ label: t("Ir para Conexões"), href: "/app/connections" }} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={conexaoAtual ?? undefined} onValueChange={setConexaoId}>
          <SelectTrigger className="h-9 w-[240px] text-xs" aria-label={t("Conexão")}>
            <SelectValue placeholder={t("Escolha a conexão")} />
          </SelectTrigger>
          <SelectContent>
            {conexoes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.display_name ?? c.id.slice(0, 8)}
                {!c.disponivel ? ` (${t("desconectada")})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {podeEditar ? (
          <Button size="sm" onClick={() => buscar.mutate()} disabled={!conexaoAtual || buscar.isPending} data-testid="buscar-grupos">
            <ArrowsClockwise size={14} className={buscar.isPending ? "animate-spin" : undefined} aria-hidden />
            {buscar.isPending ? t("Buscando…") : t("Buscar grupos da conexão")}
          </Button>
        ) : null}
        <Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder={t("Filtrar por nome")} className="h-9 max-w-xs" aria-label={t("Filtrar grupos")} />
      </div>

      {isLoading && !grupos ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : visiveis.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("Nenhum grupo salvo. Clique em buscar para ler os grupos desta conexão.")}</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card" data-testid="grupos-lista">
          {visiveis.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{g.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {g.metadata?.participant_count ? `${g.metadata.participant_count} ${t("participantes")} · ` : ""}
                  {g.external_group_id}
                </p>
              </div>
              {!g.is_active ? <Badge variant="neutral">{t("Desativado")}</Badge> : null}
              {podeEditar ? <Switch checked={g.is_active} onCheckedChange={(v) => alternar.mutate({ id: g.id, is_active: v })} aria-label={`${g.is_active ? t("Desativar") : t("Ativar")} ${g.name}`} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
