"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  EXIBICAO_PADRAO,
  centsUsdDe,
  exibicaoDifereDoReal,
  formatarCusto,
  formatarCustoReal,
  rotuloDaMoeda,
  type ExibicaoDoCusto,
} from "./moeda";

/**
 * A moeda de exibição do custo de IA, entregue pronta a quem renderiza —
 * mesma arquitetura do `IdiomaProvider`: o layout (servidor) lê a configuração
 * da instalação UMA vez e a passa; nenhum componente pergunta ao banco.
 *
 * ─── Ausência é o padrão, nunca erro ───────────────────────────────────────
 *
 * Sem provider — teste, fragmento isolado, e-mail — o custo sai em dólar, como
 * sempre foi. Um componente de custo nunca quebra por falta de contexto.
 *
 * ─── `mostrarCustoReal` ────────────────────────────────────────────────────
 *
 * Quem administra a INSTALAÇÃO (área `/admin`) vê, ao lado do valor com margem
 * que o cliente lê, o custo real em dólar que o provedor cobrou. A organização
 * vê só o valor repassado: o cliente de quem revende não precisa saber a
 * margem — decidido pelo dono do produto em 2026-09-21.
 */
interface Contexto {
  cfg: ExibicaoDoCusto;
  mostrarCustoReal: boolean;
}

const Ctx = createContext<Contexto>({ cfg: EXIBICAO_PADRAO, mostrarCustoReal: false });

export function ExibicaoDoCustoProvider({
  cfg,
  mostrarCustoReal = false,
  children,
}: {
  cfg: ExibicaoDoCusto;
  mostrarCustoReal?: boolean;
  children: ReactNode;
}) {
  const valor = useMemo(() => ({ cfg, mostrarCustoReal }), [cfg, mostrarCustoReal]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export interface FormatadorDeCusto {
  cfg: ExibicaoDoCusto;
  /** "R$" ou "US$" — para rótulos de campo. */
  rotulo: "R$" | "US$";
  /** Centavos de USD → texto na moeda exibida, com margem. */
  formatar: (usdCents: number | null | undefined, opts?: { casas?: 2 | 4 }) => string;
  /**
   * O mesmo, com o custo real entre parênteses quando quem lê é admin da
   * instalação E a exibição difere do real. `"R$ 1,12 (custo US$ 0,21)"`.
   */
  formatarComReal: (usdCents: number | null | undefined, opts?: { casas?: 2 | 4 }) => string;
  /** Valor digitado na moeda exibida (em centavos) → centavos de USD para gravar. */
  paraUsdCents: (centsExibidos: number) => number;
  /** O texto explicativo abaixo dos campos de teto. */
  moedaEhReal: boolean;
}

export function useFormatadorDeCusto(): FormatadorDeCusto {
  const { cfg, mostrarCustoReal } = useContext(Ctx);
  return useMemo(() => {
    const difere = exibicaoDifereDoReal(cfg);
    return {
      cfg,
      rotulo: rotuloDaMoeda(cfg),
      formatar: (c, opts) => formatarCusto(c, cfg, opts),
      formatarComReal: (c, opts) =>
        mostrarCustoReal && difere
          ? `${formatarCusto(c, cfg, opts)} (custo ${formatarCustoReal(c, opts)})`
          : formatarCusto(c, cfg, opts),
      paraUsdCents: (centsExibidos) => centsUsdDe(centsExibidos, cfg),
      moedaEhReal: cfg.moeda === "BRL",
    };
  }, [cfg, mostrarCustoReal]);
}
