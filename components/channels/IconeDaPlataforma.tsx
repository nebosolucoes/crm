import { plataformaDe, ROTULO_DA_PLATAFORMA, type Plataforma } from "@/lib/channels/plataformas";
import { cn } from "@/lib/utils";

/**
 * O selo da rede por onde a conversa entrou — WhatsApp, Instagram, Messenger.
 *
 * Desenho próprio e simplificado, não o logotipo oficial: o `lucide-react`
 * desta versão já não traz marcas, e copiar o SVG da marca de terceiros para
 * dentro do produto revendido é passivo que não precisa existir. A cor é o que
 * o operador reconhece de relance; o `title` diz o nome para quem não
 * reconhece.
 *
 * Aceita o valor cru do banco: `plataformaDe` cai em WhatsApp para o que não
 * conhece, que é o que toda conversa era antes da spec 21.
 */
const COR: Record<Plataforma, string> = {
  whatsapp: "#25D366",
  instagram: "#E1306C",
  messenger: "#0084FF",
};

/**
 * Comentário (spec 22) é a mesma rede por outra PORTA: o desenho troca para um
 * balão de comentário na cor da rede, para o atendente distinguir de relance o
 * que é Direct do que é público. No Facebook a porta é a página, não o
 * Messenger — por isso o nome muda.
 */
const NOME_DO_COMENTARIO: Record<Plataforma, string> = {
  whatsapp: "Comentário",
  instagram: "Comentário no Instagram",
  messenger: "Comentário no Facebook",
};

export function IconeDaPlataforma({
  plataforma,
  className,
  titulo = true,
  origem = "direct",
}: {
  plataforma: unknown;
  className?: string;
  /** `false` quando o nome já está escrito ao lado — evita leitura dupla. */
  titulo?: boolean;
  /** `comentario` desenha o balão de comentário (spec 22). */
  origem?: "direct" | "comentario";
}) {
  const p = plataformaDe(plataforma);
  const comentario = origem === "comentario" && p !== "whatsapp";
  const nome = comentario ? NOME_DO_COMENTARIO[p] : ROTULO_DA_PLATAFORMA[p];
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4 shrink-0", className)}
      role="img"
      aria-label={nome}
      data-plataforma={p}
      data-origem={comentario ? "comentario" : "direct"}
    >
      {titulo ? <title>{nome}</title> : null}
      {comentario ? (
        <g>
          <path
            d="M4 3.5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9.2L6 21.2v-3.7H4a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z"
            fill={COR[p]}
          />
          <circle cx="7.5" cy="10.5" r="1.3" fill="#fff" />
          <circle cx="12" cy="10.5" r="1.3" fill="#fff" />
          <circle cx="16.5" cy="10.5" r="1.3" fill="#fff" />
        </g>
      ) : p === "instagram" ? (
        <g fill="none" stroke={COR.instagram} strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.8" fill={COR.instagram} stroke="none" />
        </g>
      ) : p === "messenger" ? (
        <g>
          <path
            d="M12 2.5C6.6 2.5 2.5 6.4 2.5 11.4c0 2.7 1.2 5 3.2 6.7v3.4l3-1.7c1 .3 2.1.5 3.3.5 5.4 0 9.5-3.9 9.5-8.9S17.4 2.5 12 2.5Z"
            fill={COR.messenger}
          />
          <path d="m6.8 13.8 3-4.7 2.6 2.2 3.7-2.2-3 4.7-2.6-2.2-3.7 2.2Z" fill="#fff" />
        </g>
      ) : (
        <g>
          <path
            d="M12 2.5a9.4 9.4 0 0 0-8.1 14.2L2.6 21.4l4.8-1.3A9.4 9.4 0 1 0 12 2.5Z"
            fill={COR.whatsapp}
          />
          <path
            d="M9 7.6c-.2-.5-.4-.5-.6-.5h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1 2.7.2.2 1.8 2.8 4.4 3.8 2.1.8 2.6.7 3 .6.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3-1.7-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.3 6.3 0 0 1-3.2-2.8c-.2-.4.2-.4.7-1.2.1-.2 0-.3 0-.4l-.8-1.9Z"
            fill="#fff"
          />
        </g>
      )}
    </svg>
  );
}
