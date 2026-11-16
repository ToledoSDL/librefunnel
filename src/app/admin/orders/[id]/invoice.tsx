import { ErrorText } from "@/app/ui";
import { Stack } from "@/components/layout/stack";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import { TextLink } from "@/components/text/text-link";
import { retryInvoice } from "@/lib/actions/orders";
import type { InvoiceCode, InvoiceStatus } from "@/lib/invoices";
import { OUTLINE, type Tone } from "../../shared";
import { ActionButton } from "../../ui";

type State = { label: string; tone: Tone };

const LABEL: Record<InvoiceStatus, State> = {
  queued: { label: "Na fila", tone: "warning" },
  issued: { label: "Emitida", tone: "success" },
  failed: { label: "Não emitida", tone: "danger" },
  canceled: { label: "Cancelada", tone: "default" },
  cancel_failed: { label: "Cancelamento recusado", tone: "danger" },
};

export function Invoice({
  orderId,
  paid,
  invoice,
}: {
  orderId: string;
  paid: boolean;
  invoice: {
    status: InvoiceStatus;
    error: InvoiceCode | null;
    rejection: string | null;
    pending: boolean;
    link: string | null;
  } | null;
}) {
  if (!invoice) {
    if (!paid) return null;
    return (
      <Stack gap={3}>
        <Text tone="muted">Este pedido foi pago antes de a nota fiscal ser ligada.</Text>
        <ActionButton
          action={retryInvoice}
          fields={{ orderId }}
          button={OUTLINE}
          label="Emitir nota fiscal"
          pendingLabel="Colocando na fila"
          done="Nota na fila. Sai em até um minuto."
        />
      </Stack>
    );
  }

  const badge: State =
    invoice.status === "issued" && invoice.pending ? { label: "Cancelando", tone: "warning" } : LABEL[invoice.status];

  const retry = invoice.status === "failed" || invoice.status === "cancel_failed";

  return (
    <Stack gap={3}>
      <div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      {invoice.link ? (
        <TextLink href={invoice.link} external>
          Ver a nota no gov.br
        </TextLink>
      ) : null}
      {invoice.error ? (
        <Text variant="body-sm" tone={retry ? "danger" : "muted"}>
          <ErrorText code={invoice.error} />
          {invoice.rejection ? ` Código da recusa: ${invoice.rejection}.` : null}
        </Text>
      ) : null}
      {retry ? (
        <ActionButton
          action={retryInvoice}
          fields={{ orderId }}
          button={OUTLINE}
          label={invoice.status === "failed" ? "Emitir de novo" : "Cancelar de novo"}
          pendingLabel="Colocando na fila"
          done="Na fila. O resultado aparece aqui em até um minuto."
        />
      ) : null}
    </Stack>
  );
}
