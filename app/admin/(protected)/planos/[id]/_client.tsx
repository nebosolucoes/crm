"use client";
import Link from "next/link";

import { PlanoForm, type ValoresDoPlano } from "@/components/admin/planos/PlanoForm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { useEditarPlano, usePlano } from "@/hooks/admin/usePlanos";
import type { PlanoEditar } from "@/lib/entitlements/admin/schemas";

export function PlanoEditarClient({ id }: { id: string }) {
  const t = useT();
  const { data, isLoading, isError } = usePlano(id);
  const editar = useEditarPlano(id);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) {
    return (
      <div className="flex items-center justify-center rounded-lg border py-12 text-sm text-muted-foreground">
        {t("Plano não encontrado.")}
      </div>
    );
  }

  const inicial: ValoresDoPlano = {
    slug: data.slug,
    name: data.name,
    description: data.description ?? "",
    features: data.features,
    limits: data.limits,
    is_active: data.is_active,
    is_default: data.is_default,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.slug} · {data.organizations_count} {t("organização(ões) neste plano")}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/planos">{t("Voltar aos planos")}</Link>
        </Button>
      </div>
      <Card className="p-6">
        <PlanoForm
          key={data.updated_at}
          modo="editar"
          inicial={inicial}
          salvando={editar.isPending}
          onSalvar={(corpo) => editar.mutate(corpo as PlanoEditar)}
        />
      </Card>
      {!data.is_active && data.organizations_count > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("Este plano está fora de circulação, mas as organizações que já estão nele continuam com os recursos dele.")}
        </p>
      )}
    </div>
  );
}
