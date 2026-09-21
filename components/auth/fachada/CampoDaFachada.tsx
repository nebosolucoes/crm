"use client";

import { forwardRef, type ComponentProps, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * O campo dos formulários da fachada: rótulo em cima, ícone dentro do campo à
 * esquerda, 56px de altura e cantos largos — a assinatura visual do login e
 * do cadastro. É o `<Input>` do design system com a roupa da fachada, não um
 * segundo input: foco, `aria-invalid`, `disabled` e o resto seguem os dele.
 *
 * `forwardRef` porque o `react-hook-form` registra o campo pela ref — sem
 * isso o `register()` não enxerga o valor.
 *
 * `acessorio` é o que fica à direita (o olho de mostrar senha); `erro` é a
 * mensagem de validação, já traduzida por quem chama.
 */
type Props = ComponentProps<"input"> & {
  readonly id: string;
  readonly rotulo: ReactNode;
  readonly icone: ReactNode;
  readonly acessorio?: ReactNode;
  readonly erro?: string | null;
};

export const CampoDaFachada = forwardRef<HTMLInputElement, Props>(function CampoDaFachada(
  { id, rotulo, icone, acessorio, erro, className, ...props },
  ref,
) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-[13px] font-semibold text-text">
        {rotulo}
      </Label>
      <div className="relative">
        <span
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-accent [&_svg]:size-5"
          aria-hidden
        >
          {icone}
        </span>
        <Input
          id={id}
          ref={ref}
          aria-invalid={erro ? true : undefined}
          className={cn(
            "h-14 rounded-xl border-accent-300 bg-neutral-50 px-5 pl-12 text-[15px] text-text placeholder:text-text-subtle",
            "focus-visible:border-accent focus-visible:ring-accent-soft",
            "dark:border-accent-700 dark:bg-surface-elevated",
            acessorio && "pr-12",
            className,
          )}
          {...props}
        />
        {acessorio ? (
          <span className="absolute right-4 top-1/2 -translate-y-1/2">{acessorio}</span>
        ) : null}
      </div>
      {erro ? <p className="text-xs text-error">{erro}</p> : null}
    </div>
  );
});
