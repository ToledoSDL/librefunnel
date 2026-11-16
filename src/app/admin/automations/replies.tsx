import { EmptyState } from "@/components/feedback/empty-state";
import { Card } from "@/components/layout/card";
import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import { deleteReply } from "@/lib/actions/messages";
import type { Reply } from "@/lib/messages";
import { AutomationRow } from "./automation-row";
import styles from "./automations.module.css";
import { DeleteDialog } from "./delete-dialog";
import { ReplyForm } from "./reply-form";
import type { TemplateFields } from "./template-input";

export function Replies({ answers, fields }: { answers: Reply[]; fields: TemplateFields }) {
  const add = (primary: boolean) => (
    <Dialog
      trigger={{
        label: "Adicionar resposta",
        size: "sm",
        icon: "plus",
        variant: primary ? "solid" : "outline",
        tone: primary ? "primary" : "neutral",
      }}
      title="Adicionar resposta"
      description="Maiúsculas, acentos e pontuação não importam."
      body={<ReplyForm fields={fields} />}
    />
  );

  return (
    <Card title="Respostas automáticas no WhatsApp" actions={answers.length ? add(false) : null}>
      {answers.length ? (
        <ul className={`${styles.list} ${styles.divided}`}>
          {answers.map((answer) => (
            <AutomationRow
              key={answer.id}
              title={
                <div className={styles.keywords}>
                  {answer.keywords.map((keyword) => (
                    <Badge key={keyword}>{keyword}</Badge>
                  ))}
                </div>
              }
              text={answer.text}
              actions={
                <>
                  <Dialog
                    trigger={{ label: "Editar", size: "sm" }}
                    title="Editar resposta automática"
                    description="Maiúsculas, acentos e pontuação não importam."
                    body={<ReplyForm reply={answer} fields={fields} />}
                  />
                  <DeleteDialog action={deleteReply} id={answer.id} title="Excluir esta resposta automática" />
                </>
              }
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Nenhuma resposta automática"
          description="Quem mandar uma palavra-chave no WhatsApp recebe a resposta na hora."
          action={add(true)}
        />
      )}
    </Card>
  );
}
