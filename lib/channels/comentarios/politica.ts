/**
 * A política de comentários da organização — `organizations.settings.comentarios`
 * (spec 22 §5.2 e §8). Schema central: a tela de Configurações › Atendimento,
 * a rota que grava, o envio e o cron leem por aqui.
 *
 * Defaults = decisões do dono (30/09/2026): responder pelo CRM fecha o
 * atendimento sozinho; comentário sem resposta há 4 h vira aviso na Central.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { PRAZO_PADRAO_DE_COMENTARIO_SEM_RESPOSTA_HORAS } from "./vocabulario";

export const politicaDeComentariosSchema = z.object({
  fechar_ao_responder: z.boolean().default(true),
  prazo_sem_resposta_horas: z.number().int().min(1).max(168).default(PRAZO_PADRAO_DE_COMENTARIO_SEM_RESPOSTA_HORAS),
});

export type PoliticaDeComentarios = z.infer<typeof politicaDeComentariosSchema>;

export const POLITICA_PADRAO: PoliticaDeComentarios = politicaDeComentariosSchema.parse({});

/** Valor torto no jsonb vira o padrão — a tela que conserta não pode quebrar por ele. */
export function lerPoliticaDeComentarios(settings: unknown): PoliticaDeComentarios {
  const bruto = settings && typeof settings === "object" ? (settings as Record<string, unknown>).comentarios : undefined;
  const lido = politicaDeComentariosSchema.safeParse(bruto ?? {});
  return lido.success ? lido.data : POLITICA_PADRAO;
}

export async function politicaDaOrganizacao(admin: SupabaseClient, organizationId: string): Promise<PoliticaDeComentarios> {
  const { data } = await admin.from("organizations").select("settings").eq("id", organizationId).maybeSingle();
  return lerPoliticaDeComentarios(data?.settings);
}
