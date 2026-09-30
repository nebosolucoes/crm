/**
 * Quem publica por este canal? A resposta vem da CAPACIDADE `publishing`
 * (`capabilitiesOf`), nunca do nome do provedor: `groups` → o publicador de
 * grupos em cima do adapter de mensagem; `social` → o publicador de redes
 * sociais; `none` → ninguém (o worker fecha a execução como permanente).
 *
 * É a única porta que o worker de Publicações conhece.
 */
import { capabilitiesOf } from "../capabilities";
import type { ChannelProvider } from "../types";
import type { PublishingAdapter } from "./contrato";
import { publicadorDeGrupos } from "./grupos";
import { publicadorSocial } from "./social";

export type { ConsultaDePublicacao, MidiaDoPedido, PedidoDePublicacao, PublishingAdapter, ResultadoDePublicacao } from "./contrato";

export function getPublisher(provider: ChannelProvider, plataforma?: string | null): PublishingAdapter | null {
  let caps;
  try {
    caps = capabilitiesOf(provider, plataforma);
  } catch {
    return null;
  }
  if (caps.publishing === "social") return publicadorSocial;
  if (caps.publishing === "groups") return publicadorDeGrupos(provider);
  return null;
}
