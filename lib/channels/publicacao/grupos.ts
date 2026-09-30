/**
 * Publicar em GRUPOS de mensagem: uma sequência de mensagens no grupo, um
 * arquivo por mensagem, a legenda no último — em cima do adapter de mensagem
 * do provedor (`getAdapter(provider).send`), sem conhecer qual é.
 *
 * Herda do Disparo (0265) o que estava certo ali: pausa de 1,2 s + jitter
 * entre arquivos, ordem preservada, e a regra de nunca reenviar depois de uma
 * falha no meio (`partial_send` é permanente: envio em dobro é pior que
 * não-envio). Ganha o que faltava: cada arquivo que sai é registrado na hora
 * (`onProgresso`), e a falha é CLASSIFICADA — timeout e 5xx do transporte são
 * transitórios (o worker tenta de novo), o resto é permanente.
 */
import { JITTER_ENTRE_ARQUIVOS_MS, PAUSA_ENTRE_ARQUIVOS_MS } from "@/lib/publicacoes/politica";

import { getAdapter } from "../index";
import type { ChannelProvider } from "../types";
import type { CategoriaDeFalha, PedidoDePublicacao, PublishingAdapter, ResultadoDePublicacao } from "./contrato";

function mensagemDeErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "erro_desconhecido");
}

/**
 * O transporte só fala por código (`waha_<status>`, `waha_timeout`); a classe
 * sai do próprio código. Tudo que não é claramente passageiro é permanente —
 * errar para o lado de tentar de novo repetiria um envio.
 */
export function classificarFalhaDeTransporte(mensagem: string): CategoriaDeFalha {
  const m = mensagem.toLowerCase();
  if (/timeout|timed out|_5\d\d\b|_429\b|_503\b|_502\b|econnreset|econnrefused|fetch failed|network|socket hang up/.test(m)) {
    return "transitorio";
  }
  return "permanente";
}

const esperarPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function publicadorDeGrupos(provider: ChannelProvider): PublishingAdapter {
  const adapter = getAdapter(provider);
  return {
    async publish(pedido: PedidoDePublicacao): Promise<ResultadoDePublicacao> {
      if (pedido.format !== "group_message" || !pedido.to) {
        return { estado: "failed", codigo: "format_not_supported", categoria: "permanente", mensagem: "Este canal só publica mensagem em grupo." };
      }
      if (!adapter.isConfigured()) {
        return { estado: "failed", codigo: adapter.codes.notConfigured, categoria: "permanente", mensagem: "Transporte de envio não configurado." };
      }
      const esperar = pedido.esperar ?? esperarPadrao;
      const legenda = pedido.caption ?? "";
      const externalIds: string[] = [];

      if (pedido.media.length === 0) {
        try {
          const { externalId } = await adapter.send({
            organizationId: pedido.organizationId,
            sessionRef: pedido.sessionRef,
            to: pedido.to,
            kind: "text",
            body: legenda,
          });
          if (!externalId) {
            return { estado: "failed", codigo: adapter.codes.sendFailed, categoria: "permanente", mensagem: "Transporte aceitou a chamada sem devolver id externo." };
          }
          return { estado: "sent", externalId, url: null, externalIds: [externalId] };
        } catch (err) {
          const mensagem = mensagemDeErro(err);
          return { estado: "failed", codigo: "send_failed", categoria: classificarFalhaDeTransporte(mensagem), mensagem };
        }
      }

      for (let i = 0; i < pedido.media.length; i += 1) {
        const media = pedido.media[i]!;
        const ultimo = i === pedido.media.length - 1;
        if (i > 0) await esperar(PAUSA_ENTRE_ARQUIVOS_MS + Math.floor(Math.random() * JITTER_ENTRE_ARQUIVOS_MS));
        try {
          const { externalId } = await adapter.send({
            organizationId: pedido.organizationId,
            sessionRef: pedido.sessionRef,
            to: pedido.to,
            kind: media.kind,
            body: ultimo ? legenda : "",
            media: {
              url: media.url,
              mime: media.mime,
              filename: media.filename ?? undefined,
              caption: ultimo && legenda ? legenda : null,
            },
          });
          if (!externalId) {
            throw new Error(`Arquivo ${i + 1} de ${pedido.media.length} (${media.filename ?? media.kind}): transporte aceitou a chamada sem devolver id externo.`);
          }
          externalIds.push(externalId);
          await pedido.onProgresso?.(externalIds.length, externalIds);
        } catch (err) {
          const detalhe = mensagemDeErro(err);
          const mensagem = `Arquivo ${i + 1} de ${pedido.media.length} (${media.filename ?? media.kind}) falhou depois de ${externalIds.length} enviado(s): ${detalhe}`;
          if (externalIds.length > 0) {
            // Parte saiu: NUNCA repetir sozinho. Quem decide é uma pessoa, no Histórico.
            return { estado: "failed", codigo: "partial_send", categoria: "permanente", mensagem, sentFiles: externalIds.length, externalId: externalIds[0] ?? null };
          }
          return { estado: "failed", codigo: "send_failed", categoria: classificarFalhaDeTransporte(detalhe), mensagem, sentFiles: 0 };
        }
      }
      return { estado: "sent", externalId: externalIds[0]!, url: null, externalIds };
    },
  };
}
