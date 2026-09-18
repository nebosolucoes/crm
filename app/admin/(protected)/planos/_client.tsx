"use client";
import Link from "next/link";
import { useState } from "react";

import { PLANO_VAZIO, PlanoForm } from "@/components/admin/planos/PlanoForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { useCriarPlano, usePlanos } from "@/hooks/admin/usePlanos";
import type { PlanoCriar } from "@/lib/entitlements/admin/schemas";
import { CHAVES_DE_LIMITE, LIMITES } from "@/lib/entitlements/limites";
import { ROTULO_DO_RECURSO } from "@/lib/entitlements/recursos";

export function PlanosClient() {
  const t = useT();
  const { data, isLoading, isError } = usePlanos();
  const criar = useCriarPlano();
  const [criando, setCriando] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Planos")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("O que cada plano inclui. Canais está em todos, sempre. Para mudar o plano de um cliente, abra o tenant › aba Plano.")}
          </p>
        </div>
        {!criando && (
          <Button onClick={() => setCriando(true)} data-testid="novo-plano">
            {t("Novo plano")}
          </Button>
        )}
      </div>

      {criando && (
        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold">{t("Novo plano")}</h2>
          <PlanoForm
            modo="criar"
            inicial={PLANO_VAZIO}
            salvando={criar.isPending}
            onCancelar={() => setCriando(false)}
            onSalvar={(corpo) => criar.mutate(corpo as PlanoCriar, { onSuccess: () => setCriando(false) })}
          />
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center rounded-lg border py-12 text-sm text-muted-foreground">
          {t("Erro ao carregar os planos. Tente recarregar.")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm" data-testid="tabela-de-planos">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">{t("Plano")}</th>
                <th className="px-4 py-2">{t("Recursos")}</th>
                <th className="px-4 py-2">{t("Limites")}</th>
                <th className="px-4 py-2">{t("Organizações")}</th>
                <th className="px-4 py-2">{t("Situação")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data ?? []).map((p) => (
                <tr key={p.id} data-testid={`plano-${p.slug}`}>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.slug}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary">{t("Canais")}</Badge>
                      {p.features.map((f) => (
                        <Badge key={f} variant="outline">{t(ROTULO_DO_RECURSO[f])}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                    {CHAVES_DE_LIMITE.filter((c) => typeof p.limits[c] === "number").length === 0
                      ? t("sem limites")
                      : CHAVES_DE_LIMITE.filter((c) => typeof p.limits[c] === "number")
                          .map((c) => `${t(LIMITES[c].rotulo)}: ${p.limits[c]}`)
                          .join(" · ")}
                  </td>
                  <td className="px-4 py-3 align-top">{p.organizations_count}</td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap gap-1">
                      {p.is_default && <Badge>{t("padrão")}</Badge>}
                      {p.is_active ? <Badge variant="outline">{t("ativo")}</Badge> : <Badge variant="outline">{t("fora de circulação")}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/planos/${p.id}`}>{t("Editar")}</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
