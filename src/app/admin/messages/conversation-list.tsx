import { Button } from "@/components/action/button";
import { Avatar } from "@/components/feedback/avatar";
import { EmptyState } from "@/components/feedback/empty-state";
import { SegmentedControl } from "@/components/form/segmented-control";
import { Icon } from "@/components/media/icon";
import { Text } from "@/components/text/text";
import type { inbox, InboxFilter } from "@/lib/dashboard";
import { conversationHref, KIND_LABEL, photoHref, shortWhen } from "./labels";
import styles from "./messages.module.css";
import { formatContact } from "@/format";

type Inbox = Awaited<ReturnType<typeof inbox>>;

const FILTER_EMPTY: Record<InboxFilter, string> = {
  all: "Nenhuma conversa",
  waiting: "Ninguém aguardando resposta",
  failed: "Nenhuma conversa com falha",
};

function preview(row: Inbox["conversations"][number]) {
  if (row.kind === "inbound") return row.body;
  const prefix = row.kind === "manual" ? "Você" : (KIND_LABEL[row.kind] ?? row.kind);

  return `${prefix}: ${row.body.replace("{login_link}", "(link)")}`;
}

export function ConversationList({ box, filter }: { box: Inbox; filter: InboxFilter }) {
  const options = [
    { value: "all", label: "Todas" },
    ...(box.counts.waiting ? [{ value: "waiting", label: "Aguardando", count: box.counts.waiting }] : []),
    ...(box.counts.failed ? [{ value: "failed", label: "Com falha", count: box.counts.failed }] : []),
  ];

  return (
    <div className={styles.list}>
      <div className={styles.listHeader}>
        <Text variant="heading" as="h1">
          Mensagens
        </Text>
        {options.length > 1 ? (
          <SegmentedControl
            label="Mostrar"
            value={filter}
            options={options}
            href={(value) => conversationHref(value === "waiting" || value === "failed" ? value : "all")}
          />
        ) : null}
      </div>
      {box.conversations.length ? (
        <ul className={styles.items}>
          {box.conversations.map((row) => {
            const current = box.thread?.channel === row.channel && box.thread.address === row.address;
            const waiting = row.kind === "inbound";

            return (
              <li key={`${row.channel}:${row.address}`}>
                <a
                  className={styles.item}
                  href={conversationHref(filter, row)}
                  aria-current={current ? "page" : undefined}
                  data-waiting={waiting || undefined}
                >
                  <Avatar name={row.name ?? ""} src={photoHref(row.address, row.photo)} />
                  <span className={styles.itemLine}>
                    <Text as="span" variant="body-sm" weight="semibold">
                      {row.name ?? formatContact(row.address)}
                    </Text>
                  </span>
                  <span className={styles.itemWhen}>
                    <Text as="span" variant="caption" tone={waiting ? "warning" : "muted"}>
                      <time dateTime={row.createdAt.toISOString()}>{shortWhen(row.createdAt)}</time>
                    </Text>
                  </span>
                  <span className={styles.itemLine}>
                    <Text as="span" variant="body-sm" tone={waiting ? "default" : "muted"}>
                      {preview(row)}
                    </Text>
                  </span>
                  <span className={styles.itemWhen}>
                    {row.failed ? (
                      <span className={styles.status} data-tone="danger">
                        <Icon name="circle-alert" size={16} label="Envio com falha" />
                      </span>
                    ) : waiting ? (
                      <span className={styles.dot}>
                        <span className="sr-only">Aguardando resposta</span>
                      </span>
                    ) : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          title={FILTER_EMPTY[filter]}
          action={<Button href={conversationHref("all")}>Ver todas as conversas</Button>}
        />
      )}
    </div>
  );
}
