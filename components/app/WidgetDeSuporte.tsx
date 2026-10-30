"use client";

import { useEffect } from "react";

import type { WidgetDeSuporteNaTela } from "@/lib/suporte/widget";

/**
 * Carrega o widget de suporte da instalação (configurado em Admin › Widget de
 * suporte, migration 0289) e identifica quem está logado.
 *
 * O script é injetado UMA vez por aba (o layout de `/app` persiste entre
 * navegações), e a identidade vai pela fila `NeboSupport.push(...)` — o nome
 * global é o contrato do script, que lê a fila quando termina de carregar. O
 * `hash` já vem pronto do servidor; o segredo nunca chega aqui.
 */

type ComandoDaFila = [string, ...unknown[]];

declare global {
  interface Window {
    NeboSupport?: ComandoDaFila[] & { push: (cmd: ComandoDaFila) => unknown };
  }
}

const ID_DO_SCRIPT = "widget-de-suporte-da-instalacao";

export function WidgetDeSuporte({ widget }: { widget: WidgetDeSuporteNaTela }) {
  const { scriptUrl, publicKey, identidade } = widget;

  useEffect(() => {
    window.NeboSupport = window.NeboSupport || ([] as unknown as NonNullable<Window["NeboSupport"]>);
    window.NeboSupport.push([
      "identify",
      {
        id: identidade.id,
        ...(identidade.nome ? { nome: identidade.nome } : {}),
        email: identidade.email,
        ...(identidade.empresa ? { empresa: identidade.empresa } : {}),
        ...(identidade.hash ? { hash: identidade.hash } : {}),
      },
    ]);

    if (document.getElementById(ID_DO_SCRIPT)) return;
    const script = document.createElement("script");
    script.id = ID_DO_SCRIPT;
    script.src = scriptUrl;
    script.async = true;
    script.dataset.key = publicKey;
    document.body.appendChild(script);
  }, [scriptUrl, publicKey, identidade.id, identidade.nome, identidade.email, identidade.empresa, identidade.hash]);

  return null;
}
