"use client";

import "./fachada.css";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";

import type { VarianteDaAnimacao } from "./AnimacaoLottie";

/**
 * A casca das telas de acesso — o cartão de dois painéis que embrulha login,
 * cadastro e as telas irmãs (recuperação, redefinição, MFA).
 *
 * ── O que mora aqui, e por quê ──────────────────────────────────────────────
 *
 * 1. **A variante.** `/signup` põe o painel visual à DIREITA; todo o resto, à
 *    esquerda. Sai do `pathname`, e não de prop, porque este componente é
 *    montado UMA vez pelo layout do grupo `(public)` e sobrevive à navegação
 *    entre as páginas — é isso que permite animar a troca.
 *
 * 2. **A coreografia login ↔ cadastro.** O clique em "Criar conta" / "Entrar"
 *    não navega na hora: liga a classe de SAÍDA (`auth-exit-to-*`), espera a
 *    animação (0,98s, o mesmo número de `fachada.css`) e só então navega,
 *    levando `?de=login|cadastro` na URL. A página seguinte lê o `de`, liga a
 *    classe de ENTRADA (`auth-enter-from-*`) e, terminada a animação, apaga o
 *    parâmetro com `history.replaceState` — assim um F5 não repete a entrada e
 *    o `next=` do login continua onde estava.
 *
 *    A origem vai na URL, e não em `sessionStorage`, porque o servidor precisa
 *    dela: a classe de entrada tem de estar no HTML já renderizado, senão a
 *    primeira pintura mostra a tela inteira e a animação a esconde e mostra de
 *    novo — um piscar de um frame que aparece justamente em produção.
 *
 * 3. **Quando NÃO animar.** Abaixo de `lg` o CSS não tem coreografia (é só o
 *    formulário empilhado), e quem pediu movimento reduzido não a recebe —
 *    nos dois casos a navegação é imediata. Esperar 0,98s por uma animação que
 *    não vai acontecer seria um clique que "não fez nada".
 *
 * O logo chega por prop do layout (é ele quem resolve a marca no servidor), e
 * o nome da marca vai para o rodapé do painel visual.
 */

type Variante = VarianteDaAnimacao;

const DURACAO_DA_TRANSICAO_MS = 980;

const AnimacaoLottie = dynamic(() => import("./AnimacaoLottie"), { ssr: false });

const TransicaoDeAcessoContext = createContext<{ irPara: (destino: string) => void } | null>(
  null,
);

/**
 * `irPara(destino)`: navega com a coreografia quando ela cabe, e direto quando
 * não cabe. Fora da casca (testes, telas soltas) devolve um `router.push` puro.
 */
export function useTransicaoDeAcesso() {
  const contexto = useContext(TransicaoDeAcessoContext);
  const router = useRouter();
  return contexto ?? { irPara: (destino: string) => router.push(destino) };
}

function varianteDe(pathname: string | null): Variante {
  return pathname?.startsWith("/signup") ? "cadastro" : "login";
}

function comOrigem(destino: string, origem: Variante): string {
  const url = new URL(destino, "http://fachada.local");
  url.searchParams.set("de", origem);
  return `${url.pathname}${url.search}`;
}

export function CascaDeAcesso({
  logo,
  nomeDaMarca,
  children,
}: {
  logo: ReactNode;
  nomeDaMarca: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const variante = varianteDe(pathname);

  const [saindoPara, setSaindoPara] = useState<Variante | null>(null);
  const temporizador = useRef<number | null>(null);

  const de = searchParams.get("de");
  const entrouDe: Variante | null =
    de === "login" && variante === "cadastro"
      ? "login"
      : de === "cadastro" && variante === "login"
        ? "cadastro"
        : null;

  // A página trocou: a saída acabou, e o que vale agora é a entrada.
  useEffect(() => {
    setSaindoPara(null);
    if (temporizador.current) {
      window.clearTimeout(temporizador.current);
      temporizador.current = null;
    }
  }, [pathname]);

  // Terminada a entrada, o `?de=` sai da URL — sem navegar de novo.
  useEffect(() => {
    if (!entrouDe) return;
    const id = window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("de");
      window.history.replaceState(window.history.state, "", url.toString());
    }, DURACAO_DA_TRANSICAO_MS + 60);
    return () => window.clearTimeout(id);
  }, [entrouDe, pathname]);

  useEffect(
    () => () => {
      if (temporizador.current) window.clearTimeout(temporizador.current);
    },
    [],
  );

  const irPara = useCallback(
    (destino: string) => {
      if (temporizador.current) return; // já está saindo
      const alvo = varianteDe(destino);
      const url = comOrigem(destino, variante);
      const semCoreografia =
        alvo === variante ||
        !window.matchMedia("(min-width: 1024px)").matches ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (semCoreografia) {
        router.push(url);
        return;
      }
      router.prefetch(url);
      setSaindoPara(alvo);
      temporizador.current = window.setTimeout(() => {
        temporizador.current = null;
        router.push(url);
      }, DURACAO_DA_TRANSICAO_MS);
    },
    [router, variante],
  );

  const contexto = useMemo(() => ({ irPara }), [irPara]);

  return (
    <TransicaoDeAcessoContext.Provider value={contexto}>
      <main className="auth-fundo flex min-h-screen items-center justify-center p-4 text-text sm:p-6 lg:p-10">
        <section
          data-fachada={variante}
          className={cn(
            "auth-shell auth-sombra-cartao grid w-full max-w-[1280px] overflow-hidden rounded-[32px] border border-border bg-surface lg:grid-cols-2",
            variante === "login" ? "auth-shell-login" : "auth-shell-register",
            entrouDe === "cadastro" && !saindoPara && "auth-enter-from-register",
            entrouDe === "login" && !saindoPara && "auth-enter-from-login",
            saindoPara === "cadastro" && "auth-exit-to-register",
            saindoPara === "login" && "auth-exit-to-login",
          )}
        >
          <PainelVisual variante={variante} nomeDaMarca={nomeDaMarca} />

          <div
            className={cn(
              "auth-form-panel flex items-start bg-surface p-7 pt-12 sm:p-10 sm:pt-14 lg:p-14 lg:pt-16 xl:p-16 xl:pt-20",
              variante === "cadastro" && "lg:order-1",
            )}
          >
            <div className="auth-form-content mx-auto w-full max-w-[520px]">
              {logo ? <div className="mb-8 flex justify-center">{logo}</div> : null}
              {children}
            </div>
          </div>
        </section>
      </main>
    </TransicaoDeAcessoContext.Provider>
  );
}

/**
 * O painel da marca: gradiente da cor da casa, a animação e a frase de
 * posicionamento. Só existe de `lg` para cima — no celular a fachada é o
 * formulário e mais nada.
 */
function PainelVisual({ variante, nomeDaMarca }: { variante: Variante; nomeDaMarca: string }) {
  const t = useT();
  const cabecalho =
    variante === "cadastro"
      ? {
          chamada: t("CRM com agentes de IA"),
          titulo: t("Transforme conversas do WhatsApp em vendas."),
          legenda: t("Ilustração: site em construção"),
        }
      : {
          chamada: null,
          titulo: t("Atenda, qualifique e venda pelo WhatsApp em um só lugar."),
          legenda: t("Ilustração: alvo sendo avaliado"),
        };

  return (
    <aside
      className={cn(
        "auth-painel-visual relative hidden min-h-[720px] overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-12",
        variante === "cadastro" && "lg:order-2",
      )}
    >
      <div className="absolute -left-16 top-20 h-44 w-44 rounded-full border border-white/25" />
      <div className="absolute right-10 top-28 grid grid-cols-5 gap-2 opacity-30" aria-hidden>
        {Array.from({ length: 25 }).map((_, i) => (
          <span key={i} className="h-1.5 w-1.5 rounded-full bg-white" />
        ))}
      </div>
      <div className="absolute -bottom-20 right-[-72px] h-72 w-72 rounded-full border-[28px] border-white/10" />

      <div className="auth-visual-content relative z-10 flex min-h-[624px] flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div
            className="mx-auto h-[440px] w-full max-w-[540px]"
            role="img"
            aria-label={cabecalho.legenda}
          >
            <AnimacaoLottie variante={variante} />
          </div>
        </div>

        <div className="pb-8">
          {cabecalho.chamada ? (
            <p className="text-[13px] font-bold uppercase tracking-[0.16em] text-white/75">
              {cabecalho.chamada}
            </p>
          ) : null}
          <h1 className="mt-4 max-w-[500px] text-[40px] font-extrabold leading-[47px] text-white">
            {cabecalho.titulo}
          </h1>
        </div>

        <div className="text-[11px] font-medium text-white/60">{nomeDaMarca}</div>
      </div>
    </aside>
  );
}
