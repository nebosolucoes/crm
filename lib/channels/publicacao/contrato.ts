/**
 * O contrato de PUBLICAÇÃO — o que o worker de Publicações pede a um canal e
 * o que recebe de volta. Fala em rede, formato, mídia e legenda; nunca em
 * provedor. Quem implementa vive ao lado (`grupos.ts`, `social.ts`), e o
 * registro é `getPublisher` em `lib/channels/index.ts`.
 *
 * Um pedido = UMA unidade de efeito externo (uma execução): um post numa
 * conta, ou uma sequência de mensagens num grupo. O resultado tem três
 * desfechos, e a diferença entre eles é o que o worker grava:
 *
 *   sent     — saiu; há id externo (e URL, quando a rede dá uma).
 *   accepted — o provedor aceitou e ainda processa (vídeo, reel); há id
 *              externo, o desfecho final chega por webhook ou consulta.
 *   failed   — não saiu. `categoria` decide o retry: `transitorio` tenta de
 *              novo com espera; `permanente` para e avisa. `sentFiles` conta
 *              o que JÁ tinha saído antes da falha (grupos): quem lê sabe que
 *              parte chegou, e ninguém reenvia sozinho.
 */
export type RedeDePublicacao = "instagram" | "facebook" | "whatsapp";
export type FormatoDePublicacao = "feed" | "story" | "reel" | "group_message";
export type CategoriaDeFalha = "transitorio" | "permanente";

export interface MidiaDoPedido {
  /** URL que o canal consegue baixar (assinada e curta, ou pública). */
  url: string;
  mime: string;
  kind: "image" | "video" | "audio" | "document";
  filename?: string | null;
  sizeBytes?: number | null;
  /** Capa (Reels), quando existe. */
  coverUrl?: string | null;
}

export interface PedidoDePublicacao {
  organizationId: string;
  /** Identificador da conta/sessão no provedor (`resolveSessionRef`). */
  sessionRef: string;
  network: RedeDePublicacao;
  format: FormatoDePublicacao;
  caption: string | null;
  media: MidiaDoPedido[];
  /** Opções neutras do destino (`OpcoesDoDestino` em `lib/publicacoes/schema.ts`). */
  settings: Record<string, unknown>;
  /** Chave que torna o retry seguro no provedor que a honra. */
  idempotencyKey: string;
  /** Nossa referência (id da execução): vai ao provedor e volta no webhook. */
  referencia: string;
  /** Grupos: o endereço do grupo. */
  to?: string | null;
  /**
   * Grupos: chamado depois de CADA arquivo que saiu, com os ids até aqui. É o
   * que deixa registrado "2 de 5 saíram" se o processo cair no meio.
   */
  onProgresso?: (enviados: number, externalIds: string[]) => Promise<void>;
  /** Injeção para teste: espera entre arquivos. */
  esperar?: (ms: number) => Promise<void>;
}

export type ResultadoDePublicacao =
  | { estado: "sent"; externalId: string; url: string | null; providerStatus?: string | null; raw?: unknown; externalIds?: string[] }
  | { estado: "accepted"; externalId: string; providerStatus: string | null; raw?: unknown }
  | {
      estado: "failed";
      codigo: string;
      categoria: CategoriaDeFalha;
      mensagem: string;
      retryAfterMs?: number | null;
      externalId?: string | null;
      sentFiles?: number;
      raw?: unknown;
    };

export interface ConsultaDePublicacao {
  estado: "sent" | "accepted" | "failed" | "unknown";
  externalId: string;
  url?: string | null;
  providerStatus?: string | null;
  codigo?: string;
  categoria?: CategoriaDeFalha;
  mensagem?: string;
  raw?: unknown;
}

export interface PublishingAdapter {
  publish(pedido: PedidoDePublicacao): Promise<ResultadoDePublicacao>;
  /** Reconciliação: o que o provedor diz hoje sobre um id que ficou `accepted`. */
  consultar?(input: { organizationId: string; sessionRef: string; externalId: string }): Promise<ConsultaDePublicacao>;
}
