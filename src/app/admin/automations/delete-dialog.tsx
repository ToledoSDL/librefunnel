import { Dialog } from "@/components/overlay/dialog";
import type { deleteReply } from "@/lib/actions";
import { DANGER } from "../shared";
import { ActionButton } from "../ui";

export function DeleteDialog({ action, id, title }: { action: typeof deleteReply; id: number; title: string }) {
  return (
    <Dialog
      trigger={{ label: "Excluir", variant: "ghost", tone: "danger", size: "sm" }}
      title={title}
      description="Não dá para desfazer. Mensagens já enviadas continuam no histórico."
    >
      <ActionButton
        action={action}
        fields={{ id: String(id) }}
        button={DANGER}
        label="Excluir"
        pendingLabel="Excluindo"
      />
    </Dialog>
  );
}
