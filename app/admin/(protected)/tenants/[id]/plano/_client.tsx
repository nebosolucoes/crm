"use client";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import {
  useAtribuirPlano,
  useCriarExtra,
  useCriarOverride,
  useExtrasDoTenant,
  useRevogarExtra,
  usePlanoDoTenant,
  useRevogarOverride,
  type OverrideDaOrganizacao,
} from "@/hooks/admin/usePlanos";
import { overrideCriarSchema, type OverrideCriar } from "@/lib/entitlements/admin/schemas";
import {
  CHAVES_COM_EXTRA,
  CHAVES_DE_LIMITE,
  LIMITES,
  type ChaveComExtra,
  type ChaveDeLimite,
  type Limites,
} from "@/lib/entitlements/limites";
import { RECURSOS, ROTULO_DO_RECURSO, sempreLigado, type Recurso } from "@/lib/entitlements/recursos";
import { MODOS_DE_OVERRIDE, temRecurso, type ModoDeOverride } from "@/lib/entitlements/tipos";

function formatador(tag: string) {
  return (iso: string | null): string =>
    iso ? new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—";
}

export function PlanoDoTenantClient({ tenantId }: { tenantId: string }) {
  const t = useT();
  const data = formatador(useTagDeIdioma());
  const { data: visao, isLoading, isError } = usePlanoDoTenant(tenantId);
  const atribuir = useAtribuirPlano(tenantId);
  const criar = useCriarOverride(tenantId);
  const revogar = useRevogarOverride(tenantId);

  const [planoEscolhido, setPlanoEscolhido] = useState<string>("");
  const [motivoPlano, setMotivoPlano] = useState("");

  const [novo, setNovo] = useState<{ feature: Recurso; mode: ModoDeOverride; ends_at: string; reason: string; limits: Limites }>({
    feature: "ai_agents",
    mode: "enable",
    ends_at: "",
    reason: "",
    limits: {},
  });
  const [erroNovo, setErroNovo] = useState<string | null>(null);
  const [revogando, setRevogando] = useState<{ id: string; reason: string } | null>(null);

  const planoAtual = useMemo(
    () => visao?.planos.find((p) => p.id === visao.plan_id) ?? null,
    [visao],
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !visao) {
    return (
      <div className="flex items-center justify-center rounded-lg border py-12 text-sm text-muted-foreground">
        {t("Não foi possível carregar o plano deste tenant.")}
      </div>
    );
  }

  const { efetivo, overrides, planos } = visao;
  const ativosPorRecurso = new Map<Recurso, OverrideDaOrganizacao[]>();
  for (const o of overrides) {
    if (!o.ativo) continue;
    ativosPorRecurso.set(o.feature, [...(ativosPorRecurso.get(o.feature) ?? []), o]);
  }
  const doPlano = new Set<string>([...(planoAtual?.features ?? []), "channels"]);

  function enviarPlano(e: React.FormEvent) {
    e.preventDefault();
    if (!planoEscolhido) return;
    atribuir.mutate({ plan_id: planoEscolhido, reason: motivoPlano }, { onSuccess: () => setMotivoPlano("") });
  }

  function enviarOverride(e: React.FormEvent) {
    e.preventDefault();
    setErroNovo(null);
    const corpo: Record<string, unknown> = { feature: novo.feature, mode: novo.mode, reason: novo.reason, limits: novo.limits };
    if (novo.ends_at) corpo.ends_at = new Date(novo.ends_at).toISOString();
    const parsed = overrideCriarSchema.safeParse(corpo);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setErroNovo(`${issue?.path.join(".") ?? ""}: ${issue?.message ?? t("valor inválido")}`);
      return;
    }
    criar.mutate(parsed.data as OverrideCriar, {
      onSuccess: () => setNovo({ feature: "ai_agents", mode: "enable", ends_at: "", reason: "", limits: {} }),
    });
  }

  function definirLimite(chave: ChaveDeLimite, texto: string) {
    setNovo((s) => {
      const limits = { ...s.limits };
      if (texto.trim() === "") delete limits[chave];
      else limits[chave] = Number(texto);
      return { ...s, limits };
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Plano atribuído ── */}
      <Card className="p-6" data-testid="plano-do-tenant">
        <h2 className="text-lg font-semibold">{t("Plano")}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xl font-semibold" data-testid="plano-atual">{efetivo.plan?.name ?? t("Nenhum plano")}</span>
          {efetivo.origem === "padrao" && <Badge variant="secondary">{t("padrão da instalação")}</Badge>}
          {efetivo.origem === "nenhum" && <Badge variant="outline" className="text-error-fg">{t("sem plano — só Canais")}</Badge>}
          {efetivo.origem === "sem_schema" && <Badge variant="outline" className="text-error-fg">{t("banco sem a migration de planos")}</Badge>}
          {efetivo.plan && !efetivo.plan.is_active && <Badge variant="outline">{t("fora de circulação")}</Badge>}
          {visao.plan_assigned_at && (
            <span className="text-xs text-muted-foreground">{t("desde")} {data(visao.plan_assigned_at)}</span>
          )}
        </div>

        <form onSubmit={enviarPlano} className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="plano">{t("Trocar para")}</Label>
            <select
              id="plano"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={planoEscolhido}
              onChange={(e) => setPlanoEscolhido(e.target.value)}
              data-testid="seletor-de-plano"
            >
              <option value="">{t("Escolha um plano")}</option>
              {planos
                .filter((p) => p.is_active)
                .map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === visao.plan_id}>
                    {p.name}{p.id === visao.plan_id ? ` (${t("atual")})` : ""}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="motivo-plano">{t("Motivo")}</Label>
            <Input id="motivo-plano" value={motivoPlano} onChange={(e) => setMotivoPlano(e.target.value)} placeholder={t("Contrato assinado em …")} data-testid="motivo-do-plano" />
          </div>
          <Button type="submit" disabled={!planoEscolhido || motivoPlano.trim().length < 3 || atribuir.isPending} data-testid="atribuir-plano">
            {atribuir.isPending ? t("Salvando…") : t("Atribuir")}
          </Button>
        </form>
      </Card>

      {/* ── Efetivo ── */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold">{t("O que a organização pode usar agora")}</h2>
        <p className="text-sm text-muted-foreground">{t("Plano, liberações especiais e o resultado — é o resultado que a API e os workers obedecem.")}</p>
        <div className="mt-3 overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="tabela-efetivo">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t("Recurso")}</th>
                <th className="px-3 py-2">{t("Plano")}</th>
                <th className="px-3 py-2">{t("Liberação especial")}</th>
                <th className="px-3 py-2">{t("Efetivo")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {RECURSOS.map((r) => {
                const ativos = ativosPorRecurso.get(r) ?? [];
                const ligado = temRecurso(efetivo, r);
                return (
                  <tr key={r} data-recurso={r} data-efetivo={ligado ? "sim" : "nao"}>
                    <td className="px-3 py-2 font-medium">
                      {t(ROTULO_DO_RECURSO[r])}
                      {sempreLigado(r) && <span className="ml-2 text-xs text-muted-foreground">{t("sempre")}</span>}
                    </td>
                    <td className="px-3 py-2">{doPlano.has(r) ? t("incluído") : "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {ativos.length === 0
                        ? "—"
                        : ativos.map((o) => (
                            <div key={o.id}>
                              {o.mode === "enable" ? t("liberado") : t("bloqueado")}
                              {o.ends_at ? ` ${t("até")} ${data(o.ends_at)}` : ` ${t("sem prazo")}`}
                            </div>
                          ))}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={ligado ? "default" : "outline"}>{ligado ? t("sim") : t("não")}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Limites e consumo ── */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold">{t("Limites e consumo")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Teto efetivo (plano ⊕ liberações) contra o que a organização usa hoje. Só as chaves marcadas como \"barra\" recusam a criação.")}
        </p>
        <div className="mt-3 overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="tabela-de-consumo">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t("Limite")}</th>
                <th className="px-3 py-2">{t("Teto")}</th>
                <th className="px-3 py-2">{t("Uso")}</th>
                <th className="px-3 py-2">{t("Situação")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visao.consumo.map((m) => (
                <tr key={m.chave} data-limite={m.chave} data-excedido={m.excedido ? "sim" : "nao"}>
                  <td className="px-3 py-2 font-medium">
                    {t(LIMITES[m.chave].rotulo)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {m.enforced ? t("barra") : t("informativo")}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {m.teto === undefined ? t("sem limite") : m.teto}
                    {m.extra > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({t("inclui")} +{m.extra} {t("extra")})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{m.uso}</td>
                  <td className="px-3 py-2">
                    {m.teto === undefined ? "—" : m.excedido ? <Badge variant="outline" className="text-error-fg">{t("no teto")}</Badge> : <Badge variant="outline">{t("dentro")}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ExtrasCard tenantId={tenantId} />

      {/* ── Nova liberação ── */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold">{t("Liberar ou bloquear um recurso")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Fora do plano, com prazo. Quando o prazo passa, o plano volta a valer sozinho. Bloqueio vence liberação.")}
        </p>
        <form onSubmit={enviarOverride} className="mt-4 space-y-4" data-testid="novo-override">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="ov-feature">{t("Recurso")}</Label>
              <select id="ov-feature" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={novo.feature} onChange={(e) => setNovo({ ...novo, feature: e.target.value as Recurso })}>
                {RECURSOS.map((r) => (
                  <option key={r} value={r}>{t(ROTULO_DO_RECURSO[r])}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-mode">{t("Ação")}</Label>
              <select id="ov-mode" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={novo.mode} onChange={(e) => setNovo({ ...novo, mode: e.target.value as ModoDeOverride })}>
                {MODOS_DE_OVERRIDE.map((m) => (
                  <option key={m} value={m} disabled={m === "disable" && novo.feature === "channels"}>
                    {m === "enable" ? t("Liberar") : t("Bloquear")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-ends">{t("Até (opcional)")}</Label>
              <Input id="ov-ends" type="datetime-local" value={novo.ends_at} onChange={(e) => setNovo({ ...novo, ends_at: e.target.value })} data-testid="override-ate" />
            </div>
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">{t("Limites personalizados (opcional, informativos)")}</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {CHAVES_DE_LIMITE.filter((c) => LIMITES[c].recurso === novo.feature).map((chave) => (
                <div key={chave} className="space-y-1">
                  <Label htmlFor={`ov-limite-${chave}`}>{t(LIMITES[chave].rotulo)}</Label>
                  <Input id={`ov-limite-${chave}`} type="number" min={0} step={1} value={typeof novo.limits[chave] === "number" ? String(novo.limits[chave]) : ""} onChange={(e) => definirLimite(chave, e.target.value)} placeholder={t("sem limite")} />
                </div>
              ))}
            </div>
          </details>
          <div className="space-y-1">
            <Label htmlFor="ov-reason">{t("Motivo")}</Label>
            <Textarea id="ov-reason" rows={2} value={novo.reason} onChange={(e) => setNovo({ ...novo, reason: e.target.value })} placeholder={t("Teste de 30 dias combinado com …")} data-testid="override-motivo" />
          </div>
          {erroNovo && <p className="text-sm text-error-fg" role="alert">{erroNovo}</p>}
          <Button type="submit" disabled={criar.isPending} data-testid="criar-override">
            {criar.isPending ? t("Salvando…") : t("Registrar")}
          </Button>
        </form>
      </Card>

      {/* ── Histórico ── */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold">{t("Liberações especiais")}</h2>
        {overrides.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("Nenhuma até agora.")}</p>
        ) : (
          <ul className="mt-3 divide-y" data-testid="lista-de-overrides">
            {overrides.map((o) => (
              <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 py-3" data-override={o.id} data-ativo={o.ativo ? "sim" : "nao"}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t(ROTULO_DO_RECURSO[o.feature])}</span>
                    <Badge variant={o.mode === "enable" ? "default" : "outline"}>{o.mode === "enable" ? t("liberado") : t("bloqueado")}</Badge>
                    {o.ativo ? <Badge variant="secondary">{t("valendo")}</Badge> : o.revoked_at ? <Badge variant="outline">{t("encerrado")}</Badge> : <Badge variant="outline">{t("vencido ou futuro")}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {data(o.starts_at)} → {o.ends_at ? data(o.ends_at) : t("sem prazo")} · {o.reason}
                    {o.revoked_at && ` · ${t("encerrado em")} ${data(o.revoked_at)}: ${o.revoke_reason ?? ""}`}
                  </p>
                </div>
                {!o.revoked_at && (
                  revogando?.id === o.id ? (
                    <form
                      className="flex items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        revogar.mutate({ id: o.id, reason: revogando.reason }, { onSuccess: () => setRevogando(null) });
                      }}
                    >
                      <Input value={revogando.reason} onChange={(e) => setRevogando({ id: o.id, reason: e.target.value })} placeholder={t("Motivo")} className="h-8" />
                      <Button type="submit" size="sm" disabled={revogando.reason.trim().length < 3 || revogar.isPending}>{t("Encerrar")}</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRevogando(null)}>{t("Cancelar")}</Button>
                    </form>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setRevogando({ id: o.id, reason: "" })} data-testid={`revogar-${o.id}`}>
                      {t("Encerrar")}
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * Conexões extras (0281, spec 21 §10): "+N" que SOMA ao teto do plano — ao
 * contrário da liberação especial acima, que substitui o número. Continua
 * valendo quando a empresa troca de plano.
 */
function ExtrasCard({ tenantId }: { tenantId: string }) {
  const t = useT();
  const data = formatador(useTagDeIdioma());
  const { data: extras } = useExtrasDoTenant(tenantId);
  const criar = useCriarExtra(tenantId);
  const revogar = useRevogarExtra(tenantId);
  const [chave, setChave] = useState<ChaveComExtra>("max_instagram");
  const [quantidade, setQuantidade] = useState("1");
  const [motivo, setMotivo] = useState("");

  const n = Number(quantidade);
  const valido = Number.isInteger(n) && n >= 1 && n <= 1000 && motivo.trim().length >= 3;

  return (
    <Card className="p-6" data-testid="conexoes-extras">
      <h2 className="text-lg font-semibold">{t("Conexões extras")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("Somam ao limite do plano e continuam valendo se a empresa trocar de plano. Plano sem limite naquela rede segue sem limite.")}
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_2fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valido) return;
          criar.mutate(
            { limit_key: chave, quantidade: n, reason: motivo.trim() },
            { onSuccess: () => { setMotivo(""); setQuantidade("1"); } },
          );
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="extra-chave">{t("Conexão")}</Label>
          <select
            id="extra-chave"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={chave}
            onChange={(e) => setChave(e.target.value as ChaveComExtra)}
          >
            {CHAVES_COM_EXTRA.map((c) => (
              <option key={c} value={c}>{t(LIMITES[c].rotulo)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="extra-qtd">{t("Quantidade")}</Label>
          <Input id="extra-qtd" type="number" min={1} max={1000} step={1} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="extra-motivo">{t("Motivo")}</Label>
          <Input id="extra-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={t("Pedido de 2 Instagram a mais em …")} />
        </div>
        <Button type="submit" disabled={!valido || criar.isPending} data-testid="adicionar-extra">
          {criar.isPending ? t("Salvando…") : t("Adicionar")}
        </Button>
      </form>
      {(extras ?? []).length > 0 && (
        <ul className="mt-4 divide-y">
          {(extras ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-extra={e.id}>
              <div className="min-w-0 text-sm">
                <span className="font-medium">+{e.quantidade} {t(LIMITES[e.limit_key].rotulo)}</span>
                {e.revoked_at ? (
                  <Badge variant="outline" className="ml-2">{t("encerrado")}</Badge>
                ) : (
                  <Badge variant="secondary" className="ml-2">{t("valendo")}</Badge>
                )}
                <p className="text-xs text-muted-foreground">{data(e.created_at)} · {e.reason}</p>
              </div>
              {!e.revoked_at && (
                <Button variant="outline" size="sm" disabled={revogar.isPending} onClick={() => revogar.mutate(e.id)}>
                  {t("Encerrar")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
