import type { ReactNode } from "react";
import { DateTime, Money } from "@/app/format";
import { Avatar } from "@/components/feedback/avatar";
import { Icon } from "@/components/media/icon";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import type { inbox } from "@/lib/dashboard";
import { href, STATUS_LABEL, STATUS_TONE } from "../shared";
import { contactLabel, device, duration, photoHref } from "./labels";
import styles from "./messages.module.css";

type Thread = NonNullable<Awaited<ReturnType<typeof inbox>>["thread"]>;
type Journey = Thread["profile"]["journeys"][number];

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <Text as="span" variant="caption" tone="muted">
        {label}
      </Text>
      <Text as="span" variant="body-sm">
        {children}
      </Text>
    </div>
  );
}

function Step({ done, label, at }: { done: boolean; label: ReactNode; at?: Date | null }) {
  return (
    <li className={styles.step} data-done={done || undefined}>
      <Icon name={done ? "circle-check" : "circle"} size={16} label={done ? "Feito" : "Ainda não"} />
      <Text as="span" variant="body-sm" tone={done ? "default" : "muted"}>
        {label}
      </Text>
      {at ? (
        <Text as="span" variant="caption" tone="muted">
          <DateTime at={at} />
        </Text>
      ) : null}
    </li>
  );
}

function JourneySteps({ journey }: { journey: Journey }) {
  const start = journey.firstSeenAt;
  const minutes = start && journey.paidAt ? Math.round((journey.paidAt.getTime() - start.getTime()) / 60_000) : null;

  return (
    <div className={styles.section}>
      <Text variant="body-sm" weight="semibold">
        {journey.product}
      </Text>
      <ol className={styles.steps}>
        <Step done={start !== null} label="Abriu a página de vendas" at={start} />
        <Step done={journey.playedAt !== null} label="Deu play no vídeo" at={journey.playedAt} />
        <Step
          done={journey.watched > 0}
          label={
            journey.watched
              ? `Assistiu ${duration(journey.watched)}${journey.reached ? `, chegou a ${journey.reached}%` : ""}`
              : "Assistiu o vídeo"
          }
        />
        <Step done={journey.offerAt !== null} label="Viu a oferta" at={journey.offerAt} />
        <Step done={journey.clickedAt !== null} label="Clicou em comprar" at={journey.clickedAt} />
        <Step done={journey.orderedAt !== null} label="Gerou o Pix" at={journey.orderedAt} />
        <Step done={journey.paidAt !== null} label="Pagou" at={journey.paidAt} />
      </ol>
      {minutes !== null && minutes >= 0 ? (
        <Text variant="caption" tone="muted">
          Comprou {duration(minutes * 60)} depois de abrir a página.
        </Text>
      ) : null}
    </div>
  );
}

export function Profile({ thread }: { thread: Thread }) {
  const { profile } = thread;
  const title = thread.name ?? contactLabel(thread.address);
  const paid = profile.orders.filter((row) => row.status === "paid");
  const spent = paid.reduce((sum, row) => sum + row.amount, 0);
  const pending = profile.orders.some((row) => row.status === "pending");
  const agent = profile.userAgent ? device(profile.userAgent) : "";

  return (
    <div className={styles.profile}>
      <div className={styles.profileHead}>
        <Avatar name={thread.name ?? ""} src={photoHref(thread.address, thread.photo)} size="lg" />
        <Text variant="body" weight="semibold">
          {title}
        </Text>
        <div className={styles.profileContacts}>
          {profile.phone ? (
            <Text variant="caption" tone="muted">
              {contactLabel(profile.phone)}
            </Text>
          ) : null}
          {profile.email ? (
            <Text variant="caption" tone="muted">
              {profile.email}
            </Text>
          ) : null}
        </div>
        {paid.length ? (
          <Badge tone="success">Cliente</Badge>
        ) : pending ? (
          <Badge tone="warning">Pix aguardando pagamento</Badge>
        ) : (
          <Badge>Ainda não comprou</Badge>
        )}
      </div>

      {profile.orders.length ? (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <Text variant="body-sm" weight="semibold">
              Compras
            </Text>
            {spent ? (
              <Text as="span" variant="caption" tone="muted">
                <Money cents={spent} /> pagos
              </Text>
            ) : null}
          </div>
          <ul className={styles.orders}>
            {profile.orders.map((row) => (
              <li key={row.id}>
                <a className={styles.order} href={href("orders", { q: row.id })}>
                  <Text as="span" variant="body-sm">
                    {row.title}
                  </Text>
                  <Text as="span" variant="body-sm" weight="semibold">
                    <Money cents={row.amount} />
                  </Text>
                  <span>
                    <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                  </span>
                  <Text as="span" variant="caption" tone="muted">
                    <DateTime at={row.paidAt ?? row.createdAt} />
                  </Text>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {profile.journeys.map((journey) => (
        <JourneySteps key={journey.product} journey={journey} />
      ))}

      {profile.origin ? (
        <div className={styles.section}>
          <Text variant="body-sm" weight="semibold">
            Como chegou
          </Text>
          <Fact label="Origem">{profile.origin.source}</Fact>
          {profile.origin.campaign ? <Fact label="Campanha">{profile.origin.campaign}</Fact> : null}
          {profile.origin.content ? <Fact label="Anúncio">{profile.origin.content}</Fact> : null}
          <Fact label="Página de entrada">{profile.origin.landing}</Fact>
          <Fact label="Primeira visita">
            <DateTime at={profile.origin.firstSeenAt} />
          </Fact>
          {profile.lastSeenAt && profile.lastSeenAt > profile.origin.firstSeenAt ? (
            <Fact label="Última visita">
              <DateTime at={profile.lastSeenAt} />
            </Fact>
          ) : null}
        </div>
      ) : null}

      {paid.length ? (
        <div className={styles.section}>
          <Text variant="body-sm" weight="semibold">
            Área de membros
          </Text>
          <Fact label="Último acesso">
            {profile.lastLoginAt ? <DateTime at={profile.lastLoginAt} /> : "Ainda não entrou"}
          </Fact>
          {profile.lessons.map((row) => (
            <Fact key={row.product} label={row.product}>
              {row.done} de {row.total} aulas concluídas
            </Fact>
          ))}
        </div>
      ) : null}

      {agent || profile.optedOutAt ? (
        <div className={styles.section}>
          {agent ? <Fact label="Aparelho na compra">{agent}</Fact> : null}
          {profile.optedOutAt ? (
            <Fact label="Mensagens automáticas">
              Pediu para não receber em <DateTime at={profile.optedOutAt} />
            </Fact>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
