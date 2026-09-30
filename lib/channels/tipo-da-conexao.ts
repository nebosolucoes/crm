/**
 * Que TIPO de conexão é esta linha — do jeito que o operador reconhece.
 *
 * A tela de Conexões virou uma lista única (decisão do dono, 30/09): QR,
 * API oficial, parceiro, Instagram e Messenger lado a lado. Cada cartão precisa
 * dizer o que é e oferecer as ações que existem para ele — e a tela não pode
 * perguntar QUAL provider é (invariante 1 de `docs/doctrine/restricao-de-canal.md`).
 * A pergunta mora aqui, e a tela recebe a resposta pronta.
 */
import { CHANNEL_PROVIDER_META, CHANNEL_PROVIDER_ZERNIO } from "./capabilities";
import { PARTNER_CHANNEL_LABEL } from "./rotulos";
import { ehPlataformaSocial, plataformaDe, type Plataforma, ROTULO_DA_PLATAFORMA } from "./plataformas";

export type ViaDaConexao = "qr" | "oficial" | "parceiro" | "social";

export interface TipoDaConexao {
  rede: Plataforma;
  via: ViaDaConexao;
  /** "WhatsApp · QR code", "Instagram", … */
  rotulo: string;
  /** De onde vêm os modelos aprovados — `null` quando o canal não tem. */
  modelos: "oficial" | "parceiro" | null;
}

export function tipoDaConexao(c: { provider?: string | null; platform?: string | null }): TipoDaConexao {
  const rede = plataformaDe(c.platform);
  if (ehPlataformaSocial(rede)) {
    return { rede, via: "social", rotulo: ROTULO_DA_PLATAFORMA[rede], modelos: null };
  }
  if (c.provider === CHANNEL_PROVIDER_META) {
    return { rede, via: "oficial", rotulo: "WhatsApp · API oficial", modelos: "oficial" };
  }
  if (c.provider === CHANNEL_PROVIDER_ZERNIO) {
    return { rede, via: "parceiro", rotulo: `WhatsApp · ${PARTNER_CHANNEL_LABEL}`, modelos: "parceiro" };
  }
  // O servidor de QR e o que não se sabe (linha antiga sem provider): o default da coluna.
  return { rede, via: "qr", rotulo: "WhatsApp · QR code", modelos: null };
}
