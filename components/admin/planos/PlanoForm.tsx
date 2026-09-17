"use client";
/**
 * O formulário de UM plano — criar e editar usam o mesmo, porque os campos são
 * os mesmos e a validação é o MESMO schema das rotas
 * (`lib/entitlements/admin/schemas.ts`). Canais aparece marcado e travado: não
 * é escolha, é lei (o schema nem o aceita).
 *
 * Limite em branco = sem limite. Nenhum limite é aplicado ainda (`enforced:
 * false` em `LIMITES`), e a tela diz isso ao lado de cada campo — um número que
 * o processo ignora não pode parecer uma parada que vai acontecer.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { planoCriarSchema, planoEditarSchema, type PlanoCriar, type PlanoEditar } from "@/lib/entitlements/admin/schemas";
import { CHAVES_DE_LIMITE, LIMITES, type ChaveDeLimite, type Limites } from "@/lib/entitlements/limites";
import { DESCRICAO_DO_RECURSO, RECURSOS, RECURSOS_VENDAVEIS, ROTULO_DO_RECURSO, sempreLigado, type RecursoVendavel } from "@/lib/entitlements/recursos";

export interface ValoresDoPlano {
  slug: string;
  name: string;
  description: string;
  features: RecursoVendavel[];
  limits: Limites;
  is_active: boolean;
  is_default: boolean;
}

export const PLANO_VAZIO: ValoresDoPlano = {
  slug: "",
  name: "",
  description: "",
  features: [],
  limits: {},
  is_active: true,
  is_default: false,
};

interface Props {
  modo: "criar" | "editar";
  inicial: ValoresDoPlano;
  salvando: boolean;
  onSalvar: (corpo: PlanoCriar | PlanoEditar) => void;
  onCancelar?: () => void;
}

export function PlanoForm({ modo, inicial, salvando, onSalvar, onCancelar }: Props) {
  const t = useT();
  const [v, setV] = useState<ValoresDoPlano>(inicial);
  const [erro, setErro] = useState<string | null>(null);

  function alternarRecurso(r: RecursoVendavel) {
    setV((s) => ({ ...s, features: s.features.includes(r) ? s.features.filter((x) => x !== r) : [...s.features, r] }));
  }

  function definirLimite(chave: ChaveDeLimite, texto: string) {
    setV((s) => {
      const limits = { ...s.limits };
      if (texto.trim() === "") delete limits[chave];
      else limits[chave] = Number(texto);
      return { ...s, limits };
    });
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const corpo = {
      ...(modo === "criar" ? { slug: v.slug } : {}),
      name: v.name,
      description: v.description.trim() === "" ? null : v.description,
      features: v.features,
      limits: v.limits,
      is_active: v.is_active,
      is_default: v.is_default,
    };
    const parsed = modo === "criar" ? planoCriarSchema.safeParse(corpo) : planoEditarSchema.safeParse(corpo);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setErro(`${issue?.path.join(".") ?? ""}: ${issue?.message ?? t("valor inválido")}`);
      return;
    }
    onSalvar(parsed.data);
  }

  return (
    <form onSubmit={enviar} className="space-y-6" data-testid="plano-form">
      <div className="grid gap-4 sm:grid-cols-2">
        {modo === "criar" && (
          <div className="space-y-1.5">
            <Label htmlFor="slug">{t("Identificador (slug)")}</Label>
            <Input id="slug" value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} placeholder="starter" autoComplete="off" />
            <p className="text-xs text-muted-foreground">{t("Só letras minúsculas, números e hífens. Não muda depois.")}</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="name">{t("Nome")}</Label>
          <Input id="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Starter" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">{t("Descrição")}</Label>
        <Textarea id="description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} rows={2} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("Recursos incluídos")}</legend>
        <ul className="divide-y rounded-md border">
          {RECURSOS.map((r) => {
            const lei = sempreLigado(r);
            const marcado = lei || v.features.includes(r as RecursoVendavel);
            return (
              <li key={r} className="flex items-start gap-3 p-3">
                <input
                  id={`feature-${r}`}
                  type="checkbox"
                  className="mt-1"
                  checked={marcado}
                  disabled={lei}
                  onChange={() => !lei && alternarRecurso(r as RecursoVendavel)}
                  data-testid={`feature-${r}`}
                />
                <label htmlFor={`feature-${r}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="font-medium">{t(ROTULO_DO_RECURSO[r])}</span>
                  {lei && <span className="ml-2 text-xs text-muted-foreground">{t("sempre incluído — não pode ser desligado")}</span>}
                  <p className="text-xs text-muted-foreground">{t(DESCRICAO_DO_RECURSO[r])}</p>
                </label>
              </li>
            );
          })}
        </ul>
        {RECURSOS_VENDAVEIS.every((r) => !v.features.includes(r)) && (
          <p className="text-xs text-muted-foreground">{t("Nenhum recurso vendável marcado: quem estiver neste plano terá só Canais.")}</p>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("Limites")}</legend>
        <p className="text-xs text-muted-foreground">
          {t("Em branco = sem limite. Nesta versão os limites são informativos: aparecem para você e para o cliente, mas ainda não barram nada.")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CHAVES_DE_LIMITE.map((chave) => (
            <div key={chave} className="space-y-1">
              <Label htmlFor={`limite-${chave}`}>
                {t(LIMITES[chave].rotulo)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">({t(ROTULO_DO_RECURSO[LIMITES[chave].recurso])})</span>
              </Label>
              <Input
                id={`limite-${chave}`}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={typeof v.limits[chave] === "number" ? String(v.limits[chave]) : ""}
                onChange={(e) => definirLimite(chave, e.target.value)}
                placeholder={t("sem limite")}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={v.is_active} onCheckedChange={(c) => setV({ ...v, is_active: c })} />
          {t("Ativo (pode ser atribuído a organizações)")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={v.is_default} onCheckedChange={(c) => setV({ ...v, is_default: c })} />
          {t("Padrão (toda organização nova nasce nele)")}
        </label>
      </div>

      {erro && <p className="text-sm text-error-fg" role="alert">{erro}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={salvando}>
          {salvando ? t("Salvando…") : modo === "criar" ? t("Criar plano") : t("Salvar")}
        </Button>
        {onCancelar && (
          <Button type="button" variant="outline" onClick={onCancelar}>
            {t("Cancelar")}
          </Button>
        )}
      </div>
    </form>
  );
}
