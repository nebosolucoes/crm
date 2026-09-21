"use client";

import { LottieSvg } from "lottie-react";

import alvo from "./animacoes/alvo.json";
import construcao from "./animacoes/construcao.json";

/**
 * As duas animações do painel visual, escolhidas pela variante da fachada.
 *
 * Este arquivo é carregado por `next/dynamic` com `ssr: false` a partir de
 * `PainelVisual.tsx`: o `lottie-web` toca no `document` ao montar, e os dois
 * JSON (≈80 KB cada) só precisam chegar ao navegador de quem abriu a fachada
 * — ficam num chunk próprio, fora do bundle do app.
 */
export const ANIMACOES = {
  login: alvo,
  cadastro: construcao,
} as const;

export type VarianteDaAnimacao = keyof typeof ANIMACOES;

export default function AnimacaoLottie({ variante }: { variante: VarianteDaAnimacao }) {
  return (
    // `LottieSvg` e não `Lottie`: só o renderizador svg é usado, e ele carrega
    // uma cópia menor do motor.
    <LottieSvg
      src={ANIMACOES[variante]}
      loop
      autoplay
      className="h-full w-full"
      rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
    />
  );
}
