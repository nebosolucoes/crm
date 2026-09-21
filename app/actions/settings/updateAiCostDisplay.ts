"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import {
  exibicaoDoCusto,
  gravarExibicaoDoCusto,
} from "@/lib/ai/custo/exibicao-da-instalacao";
import {
  COTACAO_MIN,
  MARGEM_MAX_PCT,
  MOEDAS_DO_CUSTO,
  type ExibicaoDoCusto,
} from "@/lib/ai/custo/moeda";

export type UpdateAiCostDisplayResult = { ok: true } | { ok: false; error: string };

/**
 * Troca a moeda de exibição do custo de IA desta INSTALAÇÃO (cotação fixa e
 * margem). Espelha `updateSignupMode.ts`: gate `is_platform_admin` (o objeto é
 * a instalação, não uma organização — num revendedor, a margem é DELE, não do
 * cliente), valor anterior na trilha, `revalidatePath` na tela.
 *
 * O Zod aqui repete os CHECKs do banco (moeda no vocabulário, cotação > 0,
 * BRL exige cotação, margem 0..1000) para a recusa chegar à tela com nome, e
 * não como um 23514 traduzido em "não deu para salvar".
 */
const entradaSchema = z
  .object({
    moeda: z.enum(MOEDAS_DO_CUSTO),
    cotacao: z.number().finite().min(COTACAO_MIN).nullable(),
    margemPct: z.number().finite().min(0).max(MARGEM_MAX_PCT),
  })
  .refine((v) => v.moeda === "USD" || v.cotacao !== null, {
    message: "cotacao_obrigatoria_em_brl",
    path: ["cotacao"],
  });

export async function updateAiCostDisplay(
  input: z.infer<typeof entradaSchema>,
): Promise<UpdateAiCostDisplayResult> {
  const { user } = await requirePlatformAdmin();

  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const nova: ExibicaoDoCusto = {
    moeda: parsed.data.moeda,
    cotacao: parsed.data.moeda === "BRL" ? parsed.data.cotacao : null,
    margemPct: parsed.data.margemPct,
  };
  const anterior = await exibicaoDoCusto();

  if (!(await gravarExibicaoDoCusto(nova, user.id))) {
    return { ok: false, error: "write_failed" };
  }

  const hdrs = await headers();
  await audit({
    action: "platform.ai_cost_display_updated",
    actorUserId: user.id,
    resourceType: "platform_settings",
    metadata: { de: anterior, para: nova },
    requestId: hdrs.get("x-request-id"),
    ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: hdrs.get("user-agent"),
  });

  // As telas que mostram custo leem o Provider do layout; o layout relê a
  // configuração (memo invalidado na gravação) no próximo render.
  revalidatePath("/admin/custo-de-ia");
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
  return { ok: true };
}
