"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/hooks/i18n/useT";

import { CHANNEL_ICON_COMBINATIONS, CHANNEL_ICON_STATES, ChannelIcon, type ChannelIconState } from "@/components/publicacoes/ChannelIcon";

const TAMANHOS = [24, 36, 48, 64] as const;

export function IconesClient() {
  const t = useT();
  const rotuloDoEstado: Record<ChannelIconState, string> = { active: t("Ativo"), inactive: t("Inativo"), disabled: t("Desativado") };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full flex-col gap-6 p-6" data-testid="pagina-de-icones">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Ícones de canal")}</h1>
          <p className="text-sm text-muted-foreground">{t("As 8 combinações de rede e formato nos 3 estados. Feed é círculo cheio; Stories e Status têm o anel cortado; Reels leva a claquete e o selo da rede.")}</p>
        </header>

        <section className="rounded-xl border bg-card p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-3 font-medium">{t("Formato")}</th>
                {CHANNEL_ICON_STATES.map((estado) => (
                  <th key={estado} className="pb-3 text-center font-medium">
                    {rotuloDoEstado[estado]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CHANNEL_ICON_COMBINATIONS.map((c) => (
                <tr key={`${c.channel}-${c.format}`} className="border-t" data-testid={`icone-${c.channel}-${c.format}`}>
                  <td className="py-3 font-medium">{c.name}</td>
                  {CHANNEL_ICON_STATES.map((estado) => (
                    <td key={estado} className="py-3 text-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <ChannelIcon channel={c.channel} format={c.format} state={estado} size={40} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{c.name}</TooltipContent>
                      </Tooltip>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("Tamanhos")}</h2>
          <div className="flex flex-wrap items-end gap-6">
            {TAMANHOS.map((tamanho) => (
              <div key={tamanho} className="flex flex-col items-center gap-2">
                <div className="flex items-end gap-2">
                  {CHANNEL_ICON_COMBINATIONS.map((c) => (
                    <ChannelIcon key={`${c.channel}-${c.format}`} channel={c.channel} format={c.format} size={tamanho} />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">{tamanho} px</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}
