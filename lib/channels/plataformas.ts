/**
 * COM QUE REDE um canal fala — o segundo eixo de `channel_sessions`.
 *
 * `provider` diz QUEM transporta (o servidor de QR, a API oficial, o
 * intermediário); `platform` diz com que rede a pessoa do outro lado conversa.
 * Até a spec 21 os dois eixos coincidiam — todo canal era WhatsApp — e por isso
 * o CRM inteiro podia perguntar só pelo provider.
 *
 * O vocabulário mora aqui e em nenhum outro lugar: o banco espelha estas
 * tuplas nos CHECKs de `channel_sessions.platform`, `conversations.channel` e
 * `contact_platform_identities.platform` (migration 0280), e
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts` reprova quando as
 * duas listas divergem.
 */

export const PLATAFORMAS = ["whatsapp", "instagram", "messenger"] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];

/**
 * As redes em que a pessoa NÃO é um telefone: ela é um id escopado à conta
 * conectada, guardado em `contact_platform_identities`.
 */
export const PLATAFORMAS_SOCIAIS = ["instagram", "messenger"] as const;
export type PlataformaSocial = (typeof PLATAFORMAS_SOCIAIS)[number];

export const PLATAFORMA_WHATSAPP: Plataforma = "whatsapp";
export const PLATAFORMA_INSTAGRAM: PlataformaSocial = "instagram";
export const PLATAFORMA_MESSENGER: PlataformaSocial = "messenger";

/** Como a rede se chama para quem opera. */
export const ROTULO_DA_PLATAFORMA: Record<Plataforma, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

/**
 * Lê a coluna do banco sem confiar nela. Linha antiga (antes da 0280), leitura
 * que não selecionou a coluna ou valor de uma imagem mais nova caem em
 * `whatsapp` — que é o que toda sessão era antes deste eixo existir.
 */
export function plataformaDe(valor: unknown): Plataforma {
  return (PLATAFORMAS as readonly unknown[]).includes(valor) ? (valor as Plataforma) : PLATAFORMA_WHATSAPP;
}

export function ehPlataformaSocial(valor: unknown): valor is PlataformaSocial {
  return (PLATAFORMAS_SOCIAIS as readonly unknown[]).includes(valor);
}
