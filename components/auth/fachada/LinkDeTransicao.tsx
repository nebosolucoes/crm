"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

import { useTransicaoDeAcesso } from "./CascaDeAcesso";

/**
 * Um `<Link>` que atravessa a coreografia da fachada (ver `CascaDeAcesso`).
 *
 * Continua sendo um link de verdade: `href` no HTML, abre em nova aba com
 * Ctrl/Cmd/botão do meio, funciona sem JavaScript. Só o clique simples com o
 * botão esquerdo é interceptado — e é ele que anima.
 */
export function LinkDeTransicao({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const { irPara } = useTransicaoDeAcesso();

  function aoClicar(evento: MouseEvent<HTMLAnchorElement>) {
    if (
      evento.defaultPrevented ||
      evento.button !== 0 ||
      evento.metaKey ||
      evento.ctrlKey ||
      evento.shiftKey ||
      evento.altKey
    ) {
      return;
    }
    evento.preventDefault();
    irPara(href);
  }

  return (
    <Link href={href} className={className} onClick={aoClicar}>
      {children}
    </Link>
  );
}
