/**
 * O COMENTÁRIO QUE NINGUÉM RESPONDEU VOLTA A PEDIR PASSAGEM (spec 22 §8).
 *
 * Comentário é público e esfria rápido: quem pergunta o preço num post e não
 * ouve nada em algumas horas compra em outro lugar — e todo mundo que passa pelo
 * post vê a pergunta sem resposta. A inbox mostra o atendimento aberto, mas
 * aberto não é cobrado: sem um aviso, ele espera até alguém rolar a lista.
 *
 * Um aviso por CONTA conectada, não por comentário: "12 comentários sem
 * resposta em @certoatacado, o mais antigo há 6 horas". Cinquenta avisos para
 * cinquenta comentários ensinariam a equipe a ignorar a Central. O aviso se
 * atualiza enquanto a fila existe e FECHA sozinho quando ela zera — quem
 * resolve é responder, não clicar em "resolvido".
 *
 * "Sem resposta" = atendimento de comentário aberto cuja última mensagem do
 * cliente é mais nova que a última nossa, há mais que o prazo da organização
 * (`settings.comentarios.prazo_sem_resposta_horas`, default 4 h).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { lerPoliticaDeComentarios } from "./politica";
import { CONVERSA_COMENTARIO } from "./vocabulario";

const KIND = "comment_unanswered";
/** Ver `comment_queue` em `lib/ai/inbox-destino.ts`: a fila de comentários da conta. */
const REF_KIND = "comment_queue";
const TERMINAIS = "(closed,resolved,archived)";
/** Teto por rodada. A sobra entra na seguinte. */
const LIMITE = 2000;

export interface ResultadoDoVigia {
  examinados: number;
  avisosAbertos: number;
  avisosAtualizados: number;
  avisosFechados: number;
}

function haQuanto(ms: number): string {
  const horas = ms / 3_600_000;
  if (horas >= 48) return `há ${Math.floor(horas / 24)} dias`;
  if (horas >= 1) return `há ${Math.floor(horas)} ${Math.floor(horas) === 1 ? "hora" : "horas"}`;
  return `há ${Math.max(1, Math.round(horas * 60))} minutos`;
}

export async function vigiarComentariosParados(admin: SupabaseClient, agora = Date.now()): Promise<ResultadoDoVigia> {
  const { data, error } = await admin
    .from("conversations")
    .select("id, organization_id, channel_session_id, last_inbound_at, last_outbound_at")
    .eq("kind", CONVERSA_COMENTARIO)
    .not("status", "in", TERMINAIS)
    .not("last_inbound_at", "is", null)
    .order("last_inbound_at", { ascending: true })
    .limit(LIMITE);
  if (error) throw new Error(`vigia_comentarios: ${error.message}`);

  const abertos = (data ?? []).filter(
    (c) => !c.last_outbound_at || Date.parse(c.last_outbound_at as string) < Date.parse(c.last_inbound_at as string),
  );

  // Prazo por organização.
  const orgs = [...new Set(abertos.map((c) => c.organization_id as string))];
  const prazoMs = new Map<string, number>();
  if (orgs.length > 0) {
    const { data: linhas } = await admin.from("organizations").select("id, settings").in("id", orgs);
    for (const o of linhas ?? []) {
      prazoMs.set(o.id as string, lerPoliticaDeComentarios(o.settings).prazo_sem_resposta_horas * 3_600_000);
    }
  }

  // Parados, agrupados por conta (sessão).
  const porSessao = new Map<string, { org: string; quantos: number; maisAntigo: number }>();
  for (const c of abertos) {
    const prazo = prazoMs.get(c.organization_id as string) ?? 4 * 3_600_000;
    const desde = Date.parse(c.last_inbound_at as string);
    if (agora - desde < prazo) continue;
    const chave = c.channel_session_id as string;
    const atual = porSessao.get(chave);
    porSessao.set(chave, {
      org: c.organization_id as string,
      quantos: (atual?.quantos ?? 0) + 1,
      maisAntigo: Math.min(atual?.maisAntigo ?? desde, desde),
    });
  }

  // Avisos abertos hoje, para atualizar ou fechar.
  const { data: avisos } = await admin
    .from("agent_inbox_items")
    .select("id, organization_id, ref_id, body")
    .eq("kind", KIND)
    .eq("ref_kind", REF_KIND)
    .eq("status", "open");
  const avisoDaSessao = new Map((avisos ?? []).map((a) => [a.ref_id as string, a]));

  const sessoes = [...porSessao.keys()];
  const nomes = new Map<string, string>();
  if (sessoes.length > 0) {
    const { data: linhas } = await admin.from("channel_sessions").select("id, display_name").in("id", sessoes);
    for (const s of linhas ?? []) nomes.set(s.id as string, (s.display_name as string | null) ?? "a conta conectada");
  }

  const r: ResultadoDoVigia = { examinados: abertos.length, avisosAbertos: 0, avisosAtualizados: 0, avisosFechados: 0 };

  for (const [sessao, g] of porSessao) {
    const conta = nomes.get(sessao) ?? "a conta conectada";
    const title = g.quantos === 1 ? `Comentário sem resposta em ${conta}` : `${g.quantos} comentários sem resposta em ${conta}`;
    const body =
      `${g.quantos === 1 ? "Um comentário espera" : `${g.quantos} comentários esperam`} resposta, ` +
      `o mais antigo ${haQuanto(agora - g.maisAntigo)}. Comentário sem resposta fica à vista de quem passa pelo post.`;
    const existente = avisoDaSessao.get(sessao);
    if (existente) {
      if (existente.body !== body) {
        await admin.from("agent_inbox_items").update({ title, body }).eq("id", existente.id as string);
        r.avisosAtualizados += 1;
      }
      continue;
    }
    const { error: erro } = await admin.from("agent_inbox_items").insert({
      organization_id: g.org,
      kind: KIND,
      // `warn`: há gente esperando em público, mas nada quebrou.
      severity: "warn",
      title,
      body,
      ref_kind: REF_KIND,
      ref_id: sessao,
    });
    if (erro) logger.warn("[comentarios] aviso não aberto", { sessao, detail: erro.message });
    else r.avisosAbertos += 1;
  }

  // A fila da conta zerou: o aviso perde o sentido.
  for (const [sessao, aviso] of avisoDaSessao) {
    if (porSessao.has(sessao)) continue;
    await admin.from("agent_inbox_items").update({ status: "resolved" }).eq("id", aviso.id as string);
    r.avisosFechados += 1;
  }

  return r;
}
