/**
 * Análise → Setores (spec 20 §4, fase 5): o que está pendente e o que foi
 * respondido em cada setor — a pergunta de quem supervisiona por área.
 *
 * Quem vê: manager+ (matriz da spec 13 §4) e quem é membro de um setor com
 * `scope='all'` (supervisão). Os dois já veem todas as conversas pela RLS, e é
 * pela RLS que este painel lê: o client de SESSÃO, nunca o admin.
 *
 * Agregação pura em `lib/setores/painel.ts`; aqui só a consulta e a tabela.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { exigirRecurso } from "@/lib/entitlements/exigir";
import { traduzir } from "@/lib/i18n/dicionario";
import { agruparPainelPorSetor, ROTULO_SEM_SETOR } from "@/lib/setores/painel";
import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Setores" };

/** Mesmo conjunto do roteamento: a conversa ainda pede atendimento. */
const STATUS_ABERTOS = ["open", "pending", "claimed", "ai_handling"];
/** Conversas abertas contadas até aqui — declarado na tela. */
const TETO_DE_LINHAS = 5000;

/** As duas janelas do painel, calculadas fora do render (regra do compilador do React). */
function janelasDeTempo(): { ha24h: string; ha30d: string } {
  const agora = Date.now();
  return {
    ha24h: new Date(agora - 24 * 3_600_000).toISOString(),
    ha30d: new Date(agora - 30 * 86_400_000).toISOString(),
  };
}

export default async function PainelDeSetoresPage() {
  await exigirRecurso("analytics");
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const orgId = activeOrg.orgId;
  const supabase = await createClient();

  // Supervisão: membro de um setor que vê tudo também vê o painel.
  let podeVer = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  if (!podeVer) {
    const { data: supervisao } = await supabase
      .from("sector_members")
      .select("sector_id, sectors!inner(scope, is_active)")
      .eq("organization_id", orgId)
      .eq("user_id", user.id)
      .eq("sectors.scope", "all")
      .eq("sectors.is_active", true)
      .limit(1);
    podeVer = (supervisao?.length ?? 0) > 0;
  }
  if (!podeVer) redirect("/403");

  const { ha24h, ha30d } = janelasDeTempo();

  const [setoresRes, abertasRes, respondidasRes, transferenciasRes, handoffsRes] = await Promise.all([
    supabase.from("sectors").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("name"),
    supabase
      .from("conversations")
      .select("sector_id, assigned_to_user_id")
      .eq("organization_id", orgId)
      .in("status", STATUS_ABERTOS)
      .limit(TETO_DE_LINHAS),
    supabase
      .from("conversations")
      .select("sector_id")
      .eq("organization_id", orgId)
      .gte("last_outbound_at", ha24h)
      .limit(TETO_DE_LINHAS),
    supabase
      .from("conversation_assignment_events")
      .select("from_sector_id")
      .eq("organization_id", orgId)
      .eq("reason", "sector_transfer")
      .gte("created_at", ha30d)
      .limit(TETO_DE_LINHAS),
    supabase
      .from("conversations")
      .select("sector_id")
      .eq("organization_id", orgId)
      .gte("last_handoff_at", ha30d)
      .limit(TETO_DE_LINHAS),
  ]);
  for (const r of [setoresRes, abertasRes, respondidasRes, transferenciasRes, handoffsRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const linhas = agruparPainelPorSetor({
    setores: (setoresRes.data ?? []) as Array<{ id: string; name: string }>,
    abertas: (abertasRes.data ?? []) as Array<{ sector_id: string | null; assigned_to_user_id: string | null }>,
    respondidas: (respondidasRes.data ?? []) as Array<{ sector_id: string | null }>,
    transferencias: (transferenciasRes.data ?? []) as Array<{ from_sector_id: string | null }>,
    handoffs: (handoffsRes.data ?? []) as Array<{ sector_id: string | null }>,
  });
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);
  const temSetor = (setoresRes.data?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Setores: pendente e respondido")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(
            "O que cada setor tem na fila agora, o que já foi respondido nas últimas 24 horas, e quanto saiu de cada setor por transferência nos últimos 30 dias.",
          )}
        </p>
      </header>

      {!temSetor ? (
        <p className="text-sm text-muted-foreground">
          <Link href="/app/settings/setores" className="underline-offset-2 hover:underline">
            {t("Nenhum setor ativo. Crie setores em Configurações › Setores de atendimento.")}
          </Link>
        </p>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Setor")}</TableHead>
              <TableHead className="text-right">{t("Sem dono")}</TableHead>
              <TableHead className="text-right">{t("Com dono")}</TableHead>
              <TableHead className="text-right">{t("Respondidas (24 h)")}</TableHead>
              <TableHead className="text-right">{t("Transferidas para fora (30 d)")}</TableHead>
              <TableHead className="text-right">{t("Handoffs da IA recebidos (30 d)")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.sectorId ?? "sem-setor"} data-testid={`painel-setor-${l.sectorId ?? "sem-setor"}`}>
                <TableCell className="font-medium">{l.sectorId === null ? t(ROTULO_SEM_SETOR) : l.nome}</TableCell>
                <TableCell className="text-right">{l.semDono}</TableCell>
                <TableCell className="text-right">{l.comDono}</TableCell>
                <TableCell className="text-right">{l.respondidas}</TableCell>
                <TableCell className="text-right">{l.transferidasParaFora}</TableCell>
                <TableCell className="text-right">{l.handoffsRecebidos}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="max-w-2xl text-xs text-muted-foreground">
        {t('Conversas abertas contadas até 5.000; "sem dono" inclui a fila do setor e as que a IA ainda atende.')}{" "}
        {t("Muitas transferências para fora de um setor são sinal de que a IA está encaminhando para o setor errado: revise a descrição do setor.")}
      </p>
    </div>
  );
}
