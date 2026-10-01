"use client";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import type { PlataformaSocial } from "@/lib/channels/plataformas";
import { ChatCircle, ChatCircleDots } from "@/lib/ui/icons";

/**
 * O que uma conexão de Instagram ou Facebook entrega para a inbox (spec 22 §4).
 *
 * O MESMO componente na hora de conectar (popup "Adicionar conexão") e depois,
 * na linha da conexão — duas telas com a mesma pergunta não podem dizer coisas
 * diferentes. Desligar as duas não é opção: a última ligada fica travada.
 */
export interface Entrega {
  direct: boolean;
  comentarios: boolean;
}

export function EscolhaDaEntrega({
  plataforma,
  valor,
  onChange,
  desabilitado = false,
}: {
  plataforma: PlataformaSocial;
  valor: Entrega;
  onChange: (proximo: Entrega) => void;
  desabilitado?: boolean;
}) {
  const t = useT();
  const nomeDoDirect = plataforma === "instagram" ? t("Mensagens do Direct") : t("Mensagens do Messenger");
  const ultimaLigada = (chave: keyof Entrega) => valor[chave] && !valor[chave === "direct" ? "comentarios" : "direct"];

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="escolha-da-entrega">
      <Linha
        id={`entrega-direct-${plataforma}`}
        icone={<ChatCircle size={18} aria-hidden />}
        titulo={nomeDoDirect}
        descricao={t("Conversas privadas com quem escreve para a conta.")}
        marcado={valor.direct}
        travado={desabilitado || ultimaLigada("direct")}
        onChange={(c) => onChange({ ...valor, direct: c })}
      />
      <Linha
        id={`entrega-comentarios-${plataforma}`}
        icone={<ChatCircleDots size={18} aria-hidden />}
        titulo={t("Comentários nas publicações")}
        descricao={t("Cada comentário em post ou anúncio vira um atendimento, até ser respondido ou fechado.")}
        marcado={valor.comentarios}
        travado={desabilitado || ultimaLigada("comentarios")}
        onChange={(c) => onChange({ ...valor, comentarios: c })}
      />
    </div>
  );
}

function Linha({
  id,
  icone,
  titulo,
  descricao,
  marcado,
  travado,
  onChange,
}: {
  id: string;
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  marcado: boolean;
  travado: boolean;
  onChange: (marcado: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 p-3">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icone}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
      </span>
      <Switch id={id} checked={marcado} disabled={travado} onCheckedChange={onChange} className="mt-0.5" />
    </label>
  );
}
