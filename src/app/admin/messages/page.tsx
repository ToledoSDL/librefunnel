import { RefreshWhilePending } from "@/app/ui";
import { Button } from "@/components/action/button";
import { EmptyState } from "@/components/feedback/empty-state";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { inbox } from "@/lib/dashboard";
import type { Conversation, InboxFilter } from "@/lib/dashboard";
import { href, pick, type Query, requireAdmin } from "../shared";
import { ConversationList } from "./conversation-list";
import styles from "./messages.module.css";
import { Profile } from "./profile";
import { Thread } from "./thread";

function conversationOf(raw: string): Conversation | null {
  const split = raw.indexOf(":");
  const channel = raw.slice(0, split);
  const address = raw.slice(split + 1);

  return (channel === "email" || channel === "whatsapp") && address.length > 0 && address.length <= 254
    ? { channel, address }
    : null;
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();

  const query = await searchParams;
  const show = pick(query.show);
  const filter: InboxFilter = show === "waiting" || show === "failed" ? show : "all";
  const selected = conversationOf(pick(query.c));
  const box = await inbox(filter, selected);

  return (
    <>
      <RefreshWhilePending />
      {box.counts.all === 0 ? (
        <>
          <PageHeader title="Mensagens" />
          <Card>
            <EmptyState
              title="Nenhuma conversa ainda"
              description='Cada comprador vira uma conversa aqui: avisos de pagamento, recuperação e o que ele responder no WhatsApp, inclusive o famoso "já paguei".'
              action={<Button href={href("connections")}>Ver conexões</Button>}
            />
          </Card>
        </>
      ) : (
        <div className={styles.inbox} data-fill data-open={selected !== null && box.thread !== null}>
          <ConversationList box={box} filter={filter} />
          {box.thread ? (
            <>
              <Thread thread={box.thread} filter={filter} />
              <aside className={styles.side} aria-label="Sobre esta pessoa">
                <Profile thread={box.thread} />
              </aside>
            </>
          ) : (
            <div className={styles.thread}>
              <EmptyState title="Escolha uma conversa na lista" />
            </div>
          )}
        </div>
      )}
    </>
  );
}
