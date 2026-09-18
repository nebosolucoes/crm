/**
 * O contrato de wire das rotas de administração de planos
 * (`/api/v1/admin/plans*`, `/api/v1/admin/tenants/[id]/plan`, `…/overrides`).
 * Zod em todo input externo; o vocabulário vem de `recursos.ts` e
 * `limites.ts`, nunca é redigitado aqui.
 *
 * Client-safe: os formulários do admin importam os mesmos schemas.
 */
import { z } from "zod";

import { limitesSchema } from "../limites";
import { RECURSOS, RECURSOS_VENDAVEIS } from "../recursos";
import { MODOS_DE_OVERRIDE } from "../tipos";

export const slugDePlanoSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Só letras minúsculas, números e hífens.");

const camposDoPlano = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  /** Os recursos INCLUÍDOS. `channels` não entra: é lei, não escolha. */
  features: z.array(z.enum(RECURSOS_VENDAVEIS)).transform((v) => [...new Set(v)]),
  limits: limitesSchema.optional(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
};

export const planoCriarSchema = z.object({ slug: slugDePlanoSchema, ...camposDoPlano }).strict();
export type PlanoCriar = z.infer<typeof planoCriarSchema>;

export const planoEditarSchema = z
  .object({
    name: camposDoPlano.name.optional(),
    description: camposDoPlano.description,
    features: camposDoPlano.features.optional(),
    limits: camposDoPlano.limits,
    is_active: camposDoPlano.is_active,
    is_default: camposDoPlano.is_default,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });
export type PlanoEditar = z.infer<typeof planoEditarSchema>;

export const motivoSchema = z.string().trim().min(3).max(500);

export const atribuirPlanoSchema = z
  .object({ plan_id: z.string().uuid(), reason: motivoSchema })
  .strict();

export const overrideCriarSchema = z
  .object({
    feature: z.enum(RECURSOS),
    mode: z.enum(MODOS_DE_OVERRIDE),
    starts_at: z.string().datetime({ offset: true }).optional(),
    ends_at: z.string().datetime({ offset: true }).nullable().optional(),
    limits: limitesSchema.optional(),
    reason: motivoSchema,
  })
  .strict()
  // A camada 3 (CHECK do banco) recusa também; aqui a mensagem chega em
  // português antes de ir ao banco.
  .refine((v) => !(v.feature === "channels" && v.mode === "disable"), {
    message: "Canais nunca pode ser desligado.",
    path: ["mode"],
  })
  .refine(
    (v) => !v.ends_at || !v.starts_at || new Date(v.ends_at).getTime() > new Date(v.starts_at).getTime(),
    { message: "O fim tem de ser depois do início.", path: ["ends_at"] },
  );
export type OverrideCriar = z.infer<typeof overrideCriarSchema>;

export const revogarOverrideSchema = z.object({ reason: motivoSchema }).strict();
