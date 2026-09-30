/**
 * Vocabulário e contratos do módulo Publicações (migration 0283).
 *
 * ─── O que este arquivo é ───────────────────────────────────────────────────
 *
 * A única fonte TypeScript dos conjuntos que o banco guarda em CHECK:
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts` compara cada tupla
 * abaixo com a constraint correspondente num Postgres real. Mudar um valor
 * aqui sem a migration (ou o contrário) reprova o `test:db` — e é isso que
 * impede o 23514 silencioso num INSERT de caminho pouco exercitado.
 *
 * ─── O modelo em uma frase ──────────────────────────────────────────────────
 *
 *   publicação (conteúdo) ─< destinos (rede·formato·conta) ─< grupos (só WhatsApp)
 *                          ─< ocorrências (quando) ─< execuções (resultado por unidade)
 *
 * A verdade do que aconteceu está na EXECUÇÃO; a ocorrência é o rollup; a
 * publicação é só ciclo de vida. Ninguém pergunta "a publicação foi publicada?"
 * — pergunta "a ocorrência de 30/09 19:30 saiu em quais destinos?".
 *
 * ─── Redes e provedores ─────────────────────────────────────────────────────
 *
 * Aqui só existem REDES e FORMATOS. Quem entrega vive em `lib/channels/`,
 * atrás de um adapter — este módulo nunca nomeia um provedor (`lint:channels`).
 */
import { z } from "zod";

// ─── Vocabulário espelhado no banco ─────────────────────────────────────────

/** `publications.status` — só ciclo de vida; o desfecho mora na ocorrência. */
export const STATUS_DA_PUBLICACAO = ["draft", "scheduled", "completed", "cancelled"] as const;
export type StatusDaPublicacao = (typeof STATUS_DA_PUBLICACAO)[number];

/**
 * `publications.recurrence_kind`. Inclui o vocabulário do Disparo (0265) um a
 * um — `monthly` e `custom` — porque a 0283 copia as linhas antigas sem mudar
 * a cadência delas. `weekdays` é o que faltava ("segunda, quarta e sexta").
 */
export const RECORRENCIAS_DA_PUBLICACAO = ["none", "daily", "weekly", "monthly", "weekdays", "custom"] as const;
export type TipoDeRecorrencia = (typeof RECORRENCIAS_DA_PUBLICACAO)[number];

/** `publication_media.kind` — o mesmo conjunto do envio de mídia do Inbox. */
export const TIPOS_DE_MIDIA_DA_PUBLICACAO = ["image", "video", "audio", "document"] as const;
export type TipoDeMidiaDaPublicacao = (typeof TIPOS_DE_MIDIA_DA_PUBLICACAO)[number];

/** `publication_targets.network`. */
export const REDES_DA_PUBLICACAO = ["instagram", "facebook", "whatsapp"] as const;
export type RedeDaPublicacao = (typeof REDES_DA_PUBLICACAO)[number];

/** `publication_targets.format`. `group_message` só existe no WhatsApp. */
export const FORMATOS_DA_PUBLICACAO = ["feed", "story", "reel", "group_message"] as const;
export type FormatoDaPublicacao = (typeof FORMATOS_DA_PUBLICACAO)[number];

/** O CHECK `publication_targets_network_format_check`, em forma consultável. */
export const FORMATOS_POR_REDE: Record<RedeDaPublicacao, readonly FormatoDaPublicacao[]> = {
  instagram: ["feed", "story", "reel"],
  facebook: ["feed", "story", "reel"],
  whatsapp: ["group_message"],
};

/** `publication_occurrences.source` — data escolhida à mão ou gerada pela regra. */
export const ORIGENS_DA_OCORRENCIA = ["manual", "recurrence"] as const;
export type OrigemDaOcorrencia = (typeof ORIGENS_DA_OCORRENCIA)[number];

/** `publication_occurrences.status` — rollup das execuções. */
export const STATUS_DA_OCORRENCIA = [
  "pending",
  "processing",
  "done",
  "partial",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type StatusDaOcorrencia = (typeof STATUS_DA_OCORRENCIA)[number];

/** Os status que a Lista e o Calendário mostram; o resto é Histórico. */
export const STATUS_PENDENTES_DA_OCORRENCIA: readonly StatusDaOcorrencia[] = ["pending", "processing"];

/** `publication_executions.status`. */
export const STATUS_DA_EXECUCAO = ["pending", "sending", "sent", "failed", "skipped", "cancelled"] as const;
export type StatusDaExecucao = (typeof STATUS_DA_EXECUCAO)[number];

/** `publication_executions.error_category` — decide se o worker tenta de novo. */
export const CATEGORIAS_DE_ERRO_DA_EXECUCAO = ["transitorio", "permanente"] as const;
export type CategoriaDeErroDaExecucao = (typeof CATEGORIAS_DE_ERRO_DA_EXECUCAO)[number];

// ─── Limites do produto ─────────────────────────────────────────────────────

export const MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO = 30;
export const MAXIMO_DE_GRUPOS_POR_DESTINO = 100;
export const MAXIMO_DE_DATAS_POR_PUBLICACAO = 30;
/** Stories saem um post por arquivo; 25 posts/hora por conta é o teto do provedor. */
export const MAXIMO_DE_STORIES_POR_PUBLICACAO = 10;
export const MAXIMO_DE_DESTINOS_POR_PUBLICACAO = 12;

// ─── Contratos (zod) ────────────────────────────────────────────────────────

const instante = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

export const midiaDaPublicacaoSchema = z.object({
  /** Já existente (edição) — quando vem, os demais campos são ignorados. */
  id: uuid.optional(),
  kind: z.enum(TIPOS_DE_MIDIA_DA_PUBLICACAO),
  storage_path: z.string().trim().min(1).max(500),
  mime: z.string().trim().min(1).max(160),
  size_bytes: z.number().int().nonnegative(),
  filename: z.string().trim().min(1).max(255).nullable().optional(),
  /** Dicas lidas no navegador; a validação forte fica no provedor. */
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  cover_storage_path: z.string().trim().min(1).max(500).nullable().optional(),
});
export type MidiaDaPublicacao = z.infer<typeof midiaDaPublicacaoSchema>;

/** Opções por formato que o provedor aceita. Chaves neutras; o adapter traduz. */
export const opcoesDoDestinoSchema = z
  .object({
    /** Reels: aparecer também no feed (padrão do provedor: sim). */
    share_to_feed: z.boolean().optional(),
    /** Feed e Reels: primeiro comentário automático. */
    first_comment: z.string().trim().min(1).max(2200).optional(),
    /** Feed e Reels: desligar comentários. */
    comments_enabled: z.boolean().optional(),
    /** Reels: título separado da legenda (Facebook). */
    title: z.string().trim().min(1).max(160).optional(),
    /** Legenda específica deste destino, quando diferente da publicação. */
    caption_override: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();
export type OpcoesDoDestino = z.infer<typeof opcoesDoDestinoSchema>;

export const destinoDaPublicacaoSchema = z
  .object({
    id: uuid.optional(),
    network: z.enum(REDES_DA_PUBLICACAO),
    format: z.enum(FORMATOS_DA_PUBLICACAO),
    channel_session_id: uuid,
    /** Só WhatsApp: os grupos escolhidos, persistidos — nunca reconsultados na hora. */
    group_ids: z.array(uuid).max(MAXIMO_DE_GRUPOS_POR_DESTINO).optional(),
    settings: opcoesDoDestinoSchema.optional(),
  })
  .superRefine((d, ctx) => {
    if (!FORMATOS_POR_REDE[d.network].includes(d.format)) {
      ctx.addIssue({ code: "custom", path: ["format"], message: `A rede ${d.network} não tem o formato ${d.format}.` });
    }
    if (d.network === "whatsapp" && (!d.group_ids || d.group_ids.length === 0)) {
      ctx.addIssue({ code: "custom", path: ["group_ids"], message: "Escolha pelo menos um grupo do WhatsApp." });
    }
    if (d.network !== "whatsapp" && d.group_ids && d.group_ids.length > 0) {
      ctx.addIssue({ code: "custom", path: ["group_ids"], message: "Grupos só existem no WhatsApp." });
    }
  });
export type DestinoDaPublicacao = z.infer<typeof destinoDaPublicacaoSchema>;

export const configDeRecorrenciaSchema = z
  .object({
    /** daily/weekly/monthly: a cada N (padrão 1). custom: a cada N dias. */
    interval: z.number().int().positive().max(365).optional(),
    /** weekdays: 0 = domingo … 6 = sábado, no fuso da publicação. */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    /** Legado do Disparo (custom): mantidos para a cópia da 0283 continuar válida. */
    interval_days: z.number().int().positive().max(365).optional(),
    interval_minutes: z.number().int().positive().max(60 * 24 * 365).optional(),
  })
  .strict();
export type ConfigDeRecorrencia = z.infer<typeof configDeRecorrenciaSchema>;

export const recorrenciaDaPublicacaoSchema = z
  .object({
    kind: z.enum(RECORRENCIAS_DA_PUBLICACAO).default("none"),
    config: configDeRecorrenciaSchema.default({}),
    repeat_until: instante.nullable().optional(),
    max_occurrences: z.number().int().positive().max(1000).nullable().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.kind === "weekdays" && (!r.config.weekdays || r.config.weekdays.length === 0)) {
      ctx.addIssue({ code: "custom", path: ["config", "weekdays"], message: "Escolha os dias da semana." });
    }
    if (r.kind === "custom" && !r.config.interval && !r.config.interval_days && !r.config.interval_minutes) {
      ctx.addIssue({ code: "custom", path: ["config", "interval"], message: "Informe o intervalo." });
    }
  });
export type RecorrenciaDaPublicacao = z.infer<typeof recorrenciaDaPublicacaoSchema>;

/**
 * Criar. `scheduled_at` são os horários escolhidos à mão (sempre instantes com
 * offset — a tela converte a parede no fuso da publicação ANTES de mandar);
 * a recorrência, quando existe, gera as demais a partir do primeiro deles.
 */
export const criarPublicacaoSchema = z
  .object({
    title: z.string().trim().min(1).max(160).nullable().optional(),
    body: z.string().trim().min(1).max(4000).nullable().optional(),
    status: z.enum(["draft", "scheduled"]).default("scheduled"),
    /** Fuso IANA. Ausente = o da organização. */
    timezone: z.string().trim().min(1).max(80).optional(),
    media: z.array(midiaDaPublicacaoSchema).max(MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO).default([]),
    targets: z.array(destinoDaPublicacaoSchema).max(MAXIMO_DE_DESTINOS_POR_PUBLICACAO).default([]),
    scheduled_at: z.array(instante).max(MAXIMO_DE_DATAS_POR_PUBLICACAO).default([]),
    recurrence: recorrenciaDaPublicacaoSchema.default({ kind: "none", config: {} }),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.status === "scheduled") {
      if (p.targets.length === 0) {
        ctx.addIssue({ code: "custom", path: ["targets"], message: "Escolha pelo menos um destino." });
      }
      if (p.scheduled_at.length === 0) {
        ctx.addIssue({ code: "custom", path: ["scheduled_at"], message: "Escolha pelo menos uma data e hora." });
      }
      if (!p.body && p.media.length === 0) {
        ctx.addIssue({ code: "custom", path: ["body"], message: "Escreva uma legenda ou anexe um arquivo." });
      }
    }
    const chaves = new Set<string>();
    for (const [i, t] of p.targets.entries()) {
      const k = `${t.network}/${t.format}/${t.channel_session_id}`;
      if (chaves.has(k)) {
        ctx.addIssue({ code: "custom", path: ["targets", i], message: "Este destino está repetido." });
      }
      chaves.add(k);
    }
  });
export type CriarPublicacao = z.infer<typeof criarPublicacaoSchema>;

/**
 * Editar. Só o que veio muda. Trocar mídia, destinos ou recorrência regera as
 * ocorrências PENDENTES; as que já saíram ficam como estão (histórico).
 */
export const alterarPublicacaoSchema = z.object({
  title: z.string().trim().min(1).max(160).nullable().optional(),
  body: z.string().trim().min(1).max(4000).nullable().optional(),
  status: z.enum(["draft", "scheduled"]).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  media: z.array(midiaDaPublicacaoSchema).max(MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO).optional(),
  targets: z.array(destinoDaPublicacaoSchema).max(MAXIMO_DE_DESTINOS_POR_PUBLICACAO).optional(),
  scheduled_at: z.array(instante).max(MAXIMO_DE_DATAS_POR_PUBLICACAO).optional(),
  recurrence: recorrenciaDaPublicacaoSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AlterarPublicacao = z.infer<typeof alterarPublicacaoSchema>;

export const cancelarPublicacaoSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const reagendarOcorrenciaSchema = z.object({
  scheduled_at: instante,
});

/** Calendário e Lista: sempre instantes, nunca `dia=` (que corta em UTC). */
export const filtrosDeOcorrenciasSchema = z.object({
  de: instante,
  ate: instante,
  /** Ausente = só pendentes (Lista/Calendário). `todas` inclui o histórico no calendário. */
  incluir: z.enum(["pendentes", "todas"]).default("pendentes"),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const filtrosDoHistoricoSchema = z.object({
  status: z.enum(STATUS_DA_OCORRENCIA).optional(),
  network: z.enum(REDES_DA_PUBLICACAO).optional(),
  de: instante.optional(),
  ate: instante.optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Chaves de metadata (encapsuladas, como o Disparo fazia) ────────────────

/** Onde o worker anota, por arquivo, o que já saiu num destino de WhatsApp. */
export const CHAVE_DOS_ARQUIVOS_ENVIADOS = "sent_files";
/** Referência que vai ao provedor e volta no webhook. */
export const CHAVE_DA_REFERENCIA_NO_PROVEDOR = "crm_execution_id";
