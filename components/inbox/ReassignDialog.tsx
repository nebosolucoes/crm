"use client";
import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useTransferConversation } from "@/hooks/inbox/useTransferConversation";
import { useSetoresAtivos } from "@/hooks/setores/useSetores";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Props {
  conversationId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const ROLE_LABEL: Record<string, string> = {
  agent: "Atendente",
  manager: "Gestor",
  admin: "Admin",
};

/**
 * G3-01 — transferência imediata (decisão G1-06d): reatribui a conversa a
 * outro atendente da org, com motivo opcional. Cada transferência vira evento
 * auditável em conversation_assignment_events.
 */
export function ReassignDialog({ conversationId, open, onOpenChange }: Props) {
  const t = useT();
  const { user } = useAuth();
  const members = useAssignableMembers(open);
  const transfer = useTransferConversation();
  const [toUserId, setToUserId] = useState<string>("");
  const [toSectorId, setToSectorId] = useState<string>("");
  const [destino, setDestino] = useState<"pessoa" | "setor">("pessoa");
  const [reason, setReason] = useState("");
  const setores = useSetoresAtivos(open);
  const temSetores = (setores.data?.length ?? 0) > 0;

  const options = (members.data ?? []).filter((m) => m.user_id !== user.id);

  function close(v: boolean) {
    if (!v) {
      setToUserId("");
      setToSectorId("");
      setDestino("pessoa");
      setReason("");
    }
    onOpenChange(v);
  }
  const podeTransferir = destino === "setor" ? Boolean(toSectorId) : Boolean(toUserId);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Transferir conversa")}</DialogTitle>
          <DialogDescription>
            {t(
              destino === "setor"
                ? "A conversa vai para a fila do setor e o rodízio escolhe quem atende. Você continua vendo e respondendo até alguém do setor responder ao cliente."
                : "A transferência é imediata: o atendente escolhido vira o responsável agora e a mudança fica registrada no histórico. Você continua vendo a conversa até ele responder ao cliente.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {temSetores ? (
            <Tabs value={destino} onValueChange={(v) => setDestino(v as "pessoa" | "setor")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="pessoa">{t("Para uma pessoa")}</TabsTrigger>
                <TabsTrigger value="setor">{t("Para um setor")}</TabsTrigger>
              </TabsList>
              <TabsContent value="setor" className="space-y-1.5 pt-2">
                <Label htmlFor="reassign-sector">{t("Setor de destino")}</Label>
                <Select value={toSectorId} onValueChange={setToSectorId}>
                  <SelectTrigger id="reassign-sector" className="w-full">
                    <SelectValue placeholder={t("Escolha o setor")} />
                  </SelectTrigger>
                  <SelectContent>
                    {setores.data?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TabsContent>
            </Tabs>
          ) : null}
          <div className="space-y-1.5" hidden={destino === "setor"}>
            <Label htmlFor="reassign-target">{t("Transferir para")}</Label>
            <Select value={toUserId} onValueChange={setToUserId}>
              <SelectTrigger id="reassign-target" className="w-full">
                <SelectValue
                  placeholder={members.isLoading ? t("Carregando atendentes…") : t("Escolha o atendente")}
                />
              </SelectTrigger>
              <SelectContent>
                {options.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name ?? `${t("Atendente")} ${m.user_id.slice(0, 8)}`}
                    <span className="ml-1 text-muted-foreground">
                      · {t(ROLE_LABEL[m.role] ?? m.role)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!members.isLoading && options.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("Nenhum outro atendente disponível nesta organização.")}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reassign-reason">{t("Motivo (opcional)")}</Label>
            <Textarea
              id="reassign-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("Ex.: cliente pediu falar com o financeiro")}
              maxLength={500}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            {t("Cancelar")}
          </Button>
          <Button
            disabled={!podeTransferir || transfer.isPending}
            onClick={() =>
              transfer.mutate(
                {
                  conversation_id: conversationId,
                  ...(destino === "setor" ? { to_sector_id: toSectorId } : { to_user_id: toUserId }),
                  reason: reason.trim() || undefined,
                },
                { onSuccess: () => close(false) },
              )
            }
          >
            {transfer.isPending ? t("Transferindo…") : t("Transferir")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
