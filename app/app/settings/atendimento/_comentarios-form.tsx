"use client";
/**
 * Comentários de Instagram e Facebook (spec 22 §5.2 e §8): o que acontece
 * quando alguém responde pelo CRM, e quanto tempo um comentário pode esperar
 * antes de virar aviso na Central. Os dois knobs vivem em
 * `organizations.settings.comentarios` (`lib/channels/comentarios/politica.ts`).
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { PoliticaDeComentarios } from "@/lib/channels/comentarios/politica";

export function ComentariosForm({ initial }: { initial: PoliticaDeComentarios }) {
  const t = useT();
  const [valor, setValor] = useState(initial);
  const [salvando, startTransition] = useTransition();
  const mudou =
    valor.fechar_ao_responder !== initial.fechar_ao_responder ||
    valor.prazo_sem_resposta_horas !== initial.prazo_sem_resposta_horas;

  const salvar = () =>
    startTransition(async () => {
      try {
        await apiClient.patch("/api/v1/settings/comentarios", valor);
        toast.success(t("Configuração de comentários salva."));
      } catch (e) {
        toast.error(e instanceof Error ? t(e.message) : t("Não foi possível salvar."));
      }
    });

  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="config-comentarios">
      <div>
        <h2 className="text-base font-semibold">{t("Comentários de Instagram e Facebook")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Cada comentário em post ou anúncio vira um atendimento. Estas duas regras garantem que nenhum fique sem resposta.")}
        </p>
      </div>

      <label htmlFor="comentarios-fechar" className="flex cursor-pointer items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-medium">{t("Fechar ao responder")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("Respondeu pelo CRM, o atendimento do comentário fecha sozinho. Desligado, alguém fecha à mão.")}
          </span>
        </span>
        <Switch
          id="comentarios-fechar"
          checked={valor.fechar_ao_responder}
          onCheckedChange={(c) => setValor({ ...valor, fechar_ao_responder: c })}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="comentarios-prazo">{t("Avisar comentário sem resposta depois de (horas)")}</Label>
        <Input
          id="comentarios-prazo"
          type="number"
          min={1}
          max={168}
          className="w-32"
          value={valor.prazo_sem_resposta_horas}
          onChange={(e) => setValor({ ...valor, prazo_sem_resposta_horas: Number(e.target.value) || 1 })}
        />
        <p className="text-xs text-muted-foreground">
          {t("O aviso aparece na Central, um por conta, e some sozinho quando todos forem respondidos.")}
        </p>
      </div>

      <div>
        <Button onClick={salvar} disabled={!mudou || salvando}>
          {salvando ? t("Salvando...") : t("Salvar")}
        </Button>
      </div>
    </Card>
  );
}
