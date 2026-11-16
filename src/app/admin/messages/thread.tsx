import { ErrorText } from "@/app/ui";
import { Button, buttonAttributes } from "@/components/action/button";
import { Avatar } from "@/components/feedback/avatar";
import { Icon, type IconName } from "@/components/media/icon";
import { Dialog } from "@/components/overlay/dialog";
import { Text } from "@/components/text/text";
import { resendMessage } from "@/lib/actions/messages";
import type { inbox, InboxFilter } from "@/lib/dashboard";
import { ActionButton } from "../ui";
import { Composer } from "./composer";
import { conversationHref, day, KIND_LABEL, photoHref, time } from "./labels";
import { Profile } from "./profile";
import styles from "./messages.module.css";
import { formatContact } from "@/format";

type Thread = NonNullable<Awaited<ReturnType<typeof inbox>>["thread"]>;
type Message = Thread["messages"][number];

const STATUS_ICON: Record<string, { icon: IconName; label: string }> = {
  queued: { icon: "clock", label: "Na fila" },
  sending: { icon: "clock", label: "Enviando" },
  sent: { icon: "check", label: "Enviada" },
  delivered: { icon: "check-check", label: "Entregue" },
  read: { icon: "check-check", label: "Lida" },
};

function Bubble({ row, email }: { row: Message; email: boolean }) {
  const inbound = row.kind === "inbound";
  const failed = row.status === "failed" || row.status === "skipped";
  const text = row.body.replace("{login_link}", "(link de acesso, criado na hora do envio)");
  const [subject = "", ...rest] = email && !inbound ? text.split("\n") : [];
  const status = STATUS_ICON[row.status];

  return (
    <li className={styles.message} data-side={inbound ? "in" : "out"}>
      <div className={styles.bubble}>
        {KIND_LABEL[row.kind] ? (
          <Text variant="caption" tone="muted" weight="semibold">
            {KIND_LABEL[row.kind]}
          </Text>
        ) : null}
        {subject ? (
          <Text variant="body-sm" weight="semibold">
            {subject}
          </Text>
        ) : null}
        <div className={styles.body}>
          <Text variant="body-sm">{subject ? rest.join("\n").trim() : text}</Text>
          <span className={styles.stamp}>
            <Text as="span" variant="caption" tone="muted">
              <time dateTime={row.createdAt.toISOString()}>{time(row.createdAt)}</time>
            </Text>
            {failed ? (
              <span className={styles.status} data-tone="danger">
                <Icon name="circle-alert" size={16} label={row.status === "failed" ? "Falhou" : "Não enviada"} />
              </span>
            ) : !inbound && status ? (
              <span className={styles.status} data-tone={row.status === "read" ? "primary" : undefined}>
                <Icon name={status.icon} size={16} label={status.label} />
              </span>
            ) : null}
          </span>
        </div>
      </div>
      {failed ? (
        <div className={styles.failure}>
          <div className={styles.failureText}>
            <Text variant="caption" tone="danger" weight="semibold">
              {row.status === "failed" ? "Falhou" : "Não enviada"}
            </Text>
            {row.error ? (
              <Text variant="caption" tone="muted">
                <ErrorText code={row.error} />
              </Text>
            ) : null}
          </div>
          <ActionButton
            action={resendMessage}
            fields={{ messageId: String(row.id) }}
            button={buttonAttributes({ size: "sm" })}
            label="Reenviar"
            pendingLabel="Reenviando"
            done="Na fila de envio."
          />
        </div>
      ) : null}
    </li>
  );
}

export function Thread({ thread, filter }: { thread: Thread; filter: InboxFilter }) {
  const email = thread.channel === "email";
  const title = thread.name ?? formatContact(thread.address);

  return (
    <section className={styles.thread} aria-label={`Conversa com ${title}`}>
      <header className={styles.threadHeader}>
        <span className={styles.back}>
          <Button href={conversationHref(filter)} variant="ghost" size="sm" icon="arrow-left" iconOnly>
            Voltar para as conversas
          </Button>
        </span>
        <Avatar name={thread.name ?? ""} src={photoHref(thread.address, thread.photo)} />
        <div className={styles.threadTitle}>
          <Text variant="body" weight="semibold">
            {title}
          </Text>
          <Text variant="caption" tone="muted">
            {thread.name ? `${email ? thread.address : formatContact(thread.address)} · ` : ""}
            {email ? "E-mail" : "WhatsApp"}
          </Text>
        </div>
        <span className={styles.profileButton}>
          <Dialog
            trigger={{ label: "Perfil", icon: "user-round", size: "sm" }}
            title={title}
            body={<Profile thread={thread} />}
          />
        </span>
      </header>
      <ol className={styles.messages} aria-label="Mensagens, da mais recente para a mais antiga">
        {thread.messages.flatMap((row, index) => {
          const older = thread.messages[index + 1];
          const label = day(row.createdAt);

          return [
            <Bubble key={row.id} row={row} email={email} />,
            ...(older && day(older.createdAt) === label
              ? []
              : [
                  <li key={`day-${row.id}`} className={styles.day}>
                    <Text as="span" variant="caption" tone="muted" weight="semibold">
                      {label}
                    </Text>
                  </li>,
                ]),
          ];
        })}
      </ol>
      {thread.canReply ? (
        <Composer
          address={thread.address}
          recipient={title}
          button={buttonAttributes({ variant: "solid", tone: "primary", iconOnly: true })}
          sendIcon={<Icon name="send-horizontal" />}
        />
      ) : (
        <div className={styles.composer}>
          <Text variant="body-sm" tone="muted">
            {email ? (
              "As respostas a e-mails chegam na caixa de entrada do endereço que envia os e-mails da loja."
            ) : (
              <ErrorText code="REPLY_WINDOW_CLOSED" />
            )}
          </Text>
        </div>
      )}
    </section>
  );
}
