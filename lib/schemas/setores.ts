import { z } from "zod";

import { SECTOR_SCOPES, SECTOR_SLUG_RE } from "@/lib/setores/vocabulario";

/**
 * Entrada das rotas de SETORES (`/api/v1/sectors`, spec 20 §2 e §3.4).
 *
 * `slug` é opcional na criação: a rota deriva do nome (`slugDoSetor`) quando
 * não vem. O mesmo regex do CHECK `sectors_slug_check` vale aqui para o erro
 * ser 422 com campo nomeado, e não 23514 do banco.
 */
const nome = z.string().trim().min(1).max(60);
const slug = z.string().trim().regex(SECTOR_SLUG_RE, "Use letras minúsculas, números e hífens (até 40).");
const descricao = z.string().trim().max(500);
const escopo = z.enum(SECTOR_SCOPES);

export const createSectorSchema = z
  .object({
    name: nome,
    slug: slug.optional(),
    description: descricao.default(""),
    scope: escopo.default("own"),
  })
  .strict();
export type CreateSectorInput = z.infer<typeof createSectorSchema>;

export const updateSectorSchema = z
  .object({
    name: nome,
    slug,
    description: descricao,
    scope: escopo,
    is_active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: "Informe ao menos um campo." });
export type UpdateSectorInput = z.infer<typeof updateSectorSchema>;

/** A lista INTEIRA de membros — a rota substitui o conjunto, não acrescenta. */
export const setSectorMembersSchema = z
  .object({
    user_ids: z.array(z.string().uuid()).max(1000),
  })
  .strict();
export type SetSectorMembersInput = z.infer<typeof setSectorMembersSchema>;
