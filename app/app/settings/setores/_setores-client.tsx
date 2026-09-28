"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import type { SectorRow } from "@/hooks/setores/useSetores";
import { apiClient } from "@/lib/api/client";
import { ROTULO_DO_ESCOPO, SECTOR_SCOPES, slugDoSetor, type SectorScope } from "@/lib/setores/vocabulario";

interface Membro {
  id: string;
  name: string;
}

interface Initial {
  setores: SectorRow[];
  membros: Membro[];
  /** `null` = a instalação não sabe (sem service role); a tela não afirma nada. */
  disponiveisAgora: string[] | null;
  /** Teto do plano para setores ativos; `null` = sem limite. */
  teto: number | null;
  souAdmin: boolean;
}

/** Os campos editáveis de um setor, como a tela os guarda. */
interface Rascunho {
  name: string;
  description: string;
  scope: SectorScope;
}

function rascunhoDe(s: SectorRow): Rascunho {
  return { name: s.name, description: s.description, scope: s.scope };
}

/**
 * A tela inteira em estado local + `router.refresh()` depois de cada escrita,
 * como `_channels-form.tsx`: o servidor é a fonte, a tela só reflete. Cada
 * setor é um `fieldset` com o nome no `legend`, para o e2e achar por
 * `getByRole("group", { name })` e `getByLabel(nome do membro)`.
 */
export function SetoresClient({ initial }: { initial: Initial }) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [setores, setSetores] = useState<SectorRow[]>(initial.setores);
  /**
   * Depois de cada escrita: o servidor re-renderiza esta tela (`router.refresh`)
   * E o cache de `useSetores` (`["sectors"]`, staleTime 60 s) é invalidado —
   * senão o filtro do inbox e o diálogo de transferir seguiam oferecendo por
   * um minuto um setor recém-desativado (a rota responde 422) e não mostravam
   * o recém-criado.
   */
  function refletir() {
    void queryClient.invalidateQueries({ queryKey: ["sectors"] });
    router.refresh();
  }
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>(
    Object.fromEntries(initial.setores.map((s) => [s.id, rascunhoDe(s)])),
  );
  const [membrosPorSetor, setMembrosPorSetor] = useState<Record<string, string[]>>(
    Object.fromEntries(initial.setores.map((s) => [s.id, s.members])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [novo, setNovo] = useState<Rascunho>({ name: "", description: "", scope: "own" });
  const [criando, setCriando] = useState(false);
  const [paraExcluir, setParaExcluir] = useState<SectorRow | null>(null);

  const ativos = setores.filter((s) => s.is_active).length;
  const noTeto = initial.teto !== null && ativos >= initial.teto;

  async function criar() {
    if (!novo.name.trim()) return;
    setCriando(true);
    try {
      const { data } = await apiClient.post<{ data: SectorRow }>("/api/v1/sectors", {
        name: novo.name.trim(),
        description: novo.description.trim(),
        scope: novo.scope,
      });
      setSetores((lista) => [...lista, data]);
      setRascunhos((r) => ({ ...r, [data.id]: rascunhoDe(data) }));
      setMembrosPorSetor((m) => ({ ...m, [data.id]: [] }));
      setNovo({ name: "", description: "", scope: "own" });
      toast.success(t("Setor criado. Agora escolha quem atende nele."));
      refletir();
    } catch (e) {
      showApiError(e);
    } finally {
      setCriando(false);
    }
  }

  async function salvar(setor: SectorRow) {
    const rascunho = rascunhoDe(setor);
    const atual = rascunhos[setor.id] ?? rascunho;
    const patch: Partial<Rascunho> = {};
    if (atual.name.trim() !== setor.name) patch.name = atual.name.trim();
    if (atual.description.trim() !== setor.description) patch.description = atual.description.trim();
    if (atual.scope !== setor.scope) patch.scope = atual.scope;
    if (Object.keys(patch).length === 0) return;
    setBusy(setor.id);
    try {
      const { data } = await apiClient.patch<{ data: SectorRow }>(`/api/v1/sectors/${setor.id}`, patch);
      setSetores((lista) => lista.map((s) => (s.id === setor.id ? { ...s, ...data } : s)));
      setRascunhos((r) => ({ ...r, [setor.id]: rascunhoDe({ ...setor, ...data }) }));
      toast.success(t("Setor salvo."));
      refletir();
    } catch (e) {
      showApiError(e);
    } finally {
      setBusy(null);
    }
  }

  async function alternarAtivo(setor: SectorRow, ativo: boolean) {
    setBusy(setor.id);
    try {
      const { data } = await apiClient.patch<{ data: SectorRow }>(`/api/v1/sectors/${setor.id}`, { is_active: ativo });
      setSetores((lista) => lista.map((s) => (s.id === setor.id ? { ...s, ...data } : s)));
      toast.success(t(ativo ? "Setor ativado." : "Setor desativado. As conversas dele voltam à regra geral de visibilidade."));
      refletir();
    } catch (e) {
      showApiError(e);
    } finally {
      setBusy(null);
    }
  }

  async function salvarMembros(setor: SectorRow) {
    setBusy(setor.id);
    try {
      const user_ids = membrosPorSetor[setor.id] ?? [];
      await apiClient.put(`/api/v1/sectors/${setor.id}/members`, { user_ids });
      setSetores((lista) => lista.map((s) => (s.id === setor.id ? { ...s, members: user_ids } : s)));
      toast.success(t("Membros do setor salvos."));
      refletir();
    } catch (e) {
      showApiError(e);
    } finally {
      setBusy(null);
    }
  }

  async function excluir(setor: SectorRow) {
    setBusy(setor.id);
    try {
      await apiClient.delete(`/api/v1/sectors/${setor.id}`);
      setSetores((lista) => lista.filter((s) => s.id !== setor.id));
      toast.success(t("Setor excluído."));
      setParaExcluir(null);
      refletir();
    } catch (e) {
      showApiError(e);
    } finally {
      setBusy(null);
    }
  }

  function alternarMembro(setorId: string, userId: string, marcado: boolean) {
    setMembrosPorSetor((m) => {
      const atuais = new Set(m[setorId] ?? []);
      if (marcado) atuais.add(userId);
      else atuais.delete(userId);
      return { ...m, [setorId]: [...atuais] };
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground" data-testid="setores-contagem">
        {initial.teto === null
          ? `${ativos} ${t(ativos === 1 ? "setor ativo" : "setores ativos")}`
          : `${ativos} ${t("de")} ${initial.teto} ${t("setores do plano em uso")}`}
      </p>

      <Card className="space-y-4 p-4">
        <h2 className="font-medium">{t("Novo setor")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="novo-setor-nome">{t("Nome")}</Label>
            <Input
              id="novo-setor-nome"
              value={novo.name}
              onChange={(e) => setNovo({ ...novo, name: e.target.value })}
              placeholder={t("Ex.: Financeiro")}
              maxLength={60}
            />
            {novo.name.trim() ? (
              <p className="text-xs text-muted-foreground">
                {t("Identificador para a IA")}: <code>{slugDoSetor(novo.name) || "—"}</code>
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="novo-setor-escopo">{t("Escopo")}</Label>
            <select
              id="novo-setor-escopo"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={novo.scope}
              onChange={(e) => setNovo({ ...novo, scope: e.target.value as SectorScope })}
            >
              {SECTOR_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {t(ROTULO_DO_ESCOPO[s])}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="novo-setor-descricao">{t("Quando mandar para cá (a IA lê isto)")}</Label>
            <Textarea
              id="novo-setor-descricao"
              value={novo.description}
              onChange={(e) => setNovo({ ...novo, description: e.target.value })}
              placeholder={t("Ex.: boletos, segunda via, reembolso, cobrança")}
              maxLength={500}
              rows={2}
            />
          </div>
        </div>
        {noTeto ? (
          <p className="text-sm text-warning" data-testid="setores-no-teto">
            {t("O plano chegou ao limite de setores ativos. Desative um setor para criar outro.")}
          </p>
        ) : null}
        <Button onClick={() => void criar()} disabled={criando || noTeto || !novo.name.trim()}>
          {t(criando ? "Criando…" : "Criar setor")}
        </Button>
      </Card>

      {setores.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("Nenhum setor ainda. Sem setores, todo atendente vê a fila inteira e a IA passa a conversa a quem estiver disponível.")}
        </p>
      ) : null}

      {setores.map((setor) => {
        const rascunho = rascunhos[setor.id] ?? rascunhoDe(setor);
        const membros = membrosPorSetor[setor.id] ?? [];
        const membrosSalvos = setor.members;
        const membrosSujos = JSON.stringify([...membros].sort()) !== JSON.stringify([...membrosSalvos].sort());
        const camposSujos = JSON.stringify(rascunho) !== JSON.stringify(rascunhoDe(setor));
        const semMembro = membrosSalvos.length === 0;
        const semDisponivel =
          !semMembro && initial.disponiveisAgora !== null && !membrosSalvos.some((m) => initial.disponiveisAgora!.includes(m));
        const ocupado = busy === setor.id;
        return (
          <fieldset
            key={setor.id}
            className="space-y-4 rounded-lg border p-4"
            disabled={ocupado}
            data-testid={`setor-${setor.slug}`}
            data-ativo={setor.is_active}
          >
            <legend className="flex items-center gap-2 px-2 font-medium">
              {setor.name}
              {!setor.is_active ? <Badge variant="outline">{t("Inativo")}</Badge> : null}
              {setor.scope === "all" ? <Badge variant="info">{t("Vê todos os setores")}</Badge> : null}
            </legend>

            {setor.is_active && semMembro ? (
              <p className="text-sm text-warning" role="status">
                {t("Este setor não tem ninguém. Uma conversa encaminhada para cá fica esperando até alguém entrar no setor.")}
              </p>
            ) : null}
            {setor.is_active && semDisponivel ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t("Ninguém deste setor está disponível agora. Conversas novas esperam na fila do setor.")}
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`setor-${setor.id}-nome`}>{t("Nome")}</Label>
                <Input
                  id={`setor-${setor.id}-nome`}
                  value={rascunho.name}
                  maxLength={60}
                  onChange={(e) => setRascunhos({ ...rascunhos, [setor.id]: { ...rascunho, name: e.target.value } })}
                />
                <p className="text-xs text-muted-foreground">
                  {t("Identificador para a IA")}: <code>{setor.slug}</code>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`setor-${setor.id}-escopo`}>{t("Escopo")}</Label>
                <select
                  id={`setor-${setor.id}-escopo`}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={rascunho.scope}
                  onChange={(e) =>
                    setRascunhos({ ...rascunhos, [setor.id]: { ...rascunho, scope: e.target.value as SectorScope } })
                  }
                >
                  {SECTOR_SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {t(ROTULO_DO_ESCOPO[s])}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`setor-${setor.id}-descricao`}>{t("Quando mandar para cá (a IA lê isto)")}</Label>
                <Textarea
                  id={`setor-${setor.id}-descricao`}
                  value={rascunho.description}
                  maxLength={500}
                  rows={2}
                  onChange={(e) =>
                    setRascunhos({ ...rascunhos, [setor.id]: { ...rascunho, description: e.target.value } })
                  }
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => void salvar(setor)} disabled={!camposSujos}>
                {t(ocupado ? "Salvando…" : "Salvar setor")}
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={setor.is_active}
                  onCheckedChange={(v) => void alternarAtivo(setor, v)}
                  aria-label={`${t("Setor ativo")}: ${setor.name}`}
                />
                {t("Ativo")}
              </label>
              {initial.souAdmin ? (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setParaExcluir(setor)}>
                  {t("Excluir")}
                </Button>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("Quem atende neste setor")}</p>
              {initial.membros.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("Nenhum atendente na organização ainda.")}</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {initial.membros.map((membro) => (
                    <label key={membro.id} className="flex items-center gap-2 rounded-md p-2 hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={membros.includes(membro.id)}
                        onChange={(e) => alternarMembro(setor.id, membro.id, e.target.checked)}
                      />
                      <span>{membro.name}</span>
                      {initial.disponiveisAgora?.includes(membro.id) ? (
                        <Badge variant="success" className="ml-auto">
                          {t("disponível")}
                        </Badge>
                      ) : null}
                    </label>
                  ))}
                </div>
              )}
              <Button size="sm" variant="outline" onClick={() => void salvarMembros(setor)} disabled={!membrosSujos}>
                {t(ocupado ? "Salvando…" : "Salvar membros")}
              </Button>
            </div>
          </fieldset>
        );
      })}

      <AlertDialog open={paraExcluir !== null} onOpenChange={(v) => !v && setParaExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Excluir")} &ldquo;{paraExcluir?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "O setor some das telas e da lista que a IA lê. Conversas encerradas e agentes que apontavam para ele ficam sem setor. Com conversa aberta no setor a exclusão é recusada: transfira-as ou desative o setor. Não há como desfazer.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (paraExcluir) void excluir(paraExcluir);
              }}
            >
              {t("Excluir setor")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
