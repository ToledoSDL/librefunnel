import { Money } from "@/app/format";
import { buttonAttributes } from "@/components/action/button";
import { Field } from "@/components/form/field";
import { Input } from "@/components/form/input";
import { MoneyInput } from "@/components/form/money-input";
import { SegmentedControl } from "@/components/form/segmented-control";
import { Disclosure } from "@/components/layout/disclosure";
import { Row } from "@/components/layout/row";
import { Stack } from "@/components/layout/stack";
import { Dialog } from "@/components/overlay/dialog";
import { Text } from "@/components/text/text";
import { refundOrder, resendAccess } from "@/lib/actions";
import { integrations, orders } from "@/lib/dashboard";
import { isAdmin } from "@/lib/guard";
import type { OrderStatus } from "@/lib/orders";
import { redirect } from "next/navigation";
import type { ComponentProps } from "react";
import { ActionButton, ReleaseForm } from "./ui";

export type Tab = "overview" | "orders" | "products" | "messages" | "automations" | "connections" | "settings";

export type Days = 7 | 30 | 90;

export type Query = Record<string, string | string[] | undefined>;

export type Links = Awaited<ReturnType<typeof integrations>>;

export type OrderRow = Awaited<ReturnType<typeof orders>>["rows"][number];

export type Tone = "default" | "success" | "warning" | "danger";

export const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Resumo" },
  { key: "orders", label: "Pedidos" },
  { key: "products", label: "Produtos" },
  { key: "messages", label: "Mensagens" },
  { key: "automations", label: "Automações" },
  { key: "connections", label: "Conexões" },
  { key: "settings", label: "Configurações" },
];

export const OUTLINE = buttonAttributes({ size: "sm" });

export const PRIMARY = buttonAttributes({ variant: "solid", tone: "primary", size: "sm" });

export const DANGER = buttonAttributes({ variant: "soft", tone: "danger", size: "sm" });

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Aguardando Pix",
  paid: "Pago",
  expired: "Expirado",
  canceled: "Substituído",
  refunded: "Reembolsado",
};

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  pending: "warning",
  paid: "success",
  expired: "default",
  canceled: "default",
  refunded: "danger",
};

const PERIODS: Days[] = [7, 30, 90];

export const INTEGER = new Intl.NumberFormat("pt-BR");

export function pick(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export function href(tab: Tab, extra: Record<string, string> = {}) {
  const query = new URLSearchParams(extra).toString();

  return `/admin${tab === "overview" ? "" : `/${tab}`}${query ? `?${query}` : ""}`;
}

export function Periods({ tab, days, extra = {} }: { tab: Tab; days: Days; extra?: Record<string, string> }) {
  return (
    <SegmentedControl
      label="Período"
      value={String(days)}
      options={PERIODS.map((period) => ({ value: String(period), label: `${period} dias` }))}
      href={(value) => href(tab, { ...extra, days: value })}
    />
  );
}

export function Amount({ row }: { row: OrderRow }) {
  return (
    <Stack gap={1}>
      <Text as="span" variant="body-sm" weight="semibold">
        <Money cents={row.amount} />
      </Text>
      {row.received > 0 && row.received !== row.amount ? (
        <Text as="span" variant="caption" tone="muted">
          recebido <Money cents={row.received} />
        </Text>
      ) : null}
    </Stack>
  );
}

export function OrderActions({ row }: { row: OrderRow }) {
  if (row.status === "refunded") {
    return (
      <Text variant="body-sm" tone="muted">
        Sem ações
      </Text>
    );
  }

  if (row.status === "paid") {
    return (
      <Row gap={2} align="start">
        <ActionButton
          action={resendAccess}
          fields={{ orderId: row.id }}
          button={OUTLINE}
          label="Reenviar acesso"
          pendingLabel="Reenviando"
          done="Novo link de acesso na fila de envio para o e-mail do comprador."
        />
        <Dialog
          trigger={{ label: "Reembolsar", variant: "soft", tone: "danger", size: "sm" }}
          title="Reembolsar pedido"
          description="Encerra o acesso na hora e desconta da receita. A devolução do dinheiro você faz pelo app do banco: o painel não transfere."
        >
          <ActionButton
            action={refundOrder}
            fields={{ orderId: row.id }}
            button={DANGER}
            label="Confirmar reembolso"
            pendingLabel="Reembolsando"
            done="Pedido reembolsado e acesso encerrado."
          />
        </Dialog>
      </Row>
    );
  }

  return (
    <Disclosure label={row.received > 0 && row.received < row.amount ? "Liberar mesmo assim" : "Liberar"}>
      <ReleaseForm orderId={row.id} button={PRIMARY}>
        <Text variant="body-sm">
          Abra o extrato do banco (não o comprovante que o comprador mandou) e procure um Pix de{" "}
          <Money cents={row.amount} /> com o identificador{" "}
          <Text as="span" variant="body-sm" mono>
            {row.txid}
          </Text>
          .
        </Text>
        {row.received > 0 ? (
          <Text variant="body-sm" tone="muted">
            Já registrado: <Money cents={row.received} />.
          </Text>
        ) : null}
        <Field label="Valor que caiu na conta">
          {(control) => <MoneyInput {...control} name="amount" required defaultCents={row.amount} />}
        </Field>
      </ReleaseForm>
    </Disclosure>
  );
}

export function TextField({ label, hint, ...input }: { label: string; hint?: string } & ComponentProps<typeof Input>) {
  return (
    <Field label={label} hint={hint}>
      {(control) => <Input {...control} {...input} />}
    </Field>
  );
}

export function periodOf(query: Query): Days {
  const period = pick(query.days);

  return period === "7" ? 7 : period === "90" ? 90 : 30;
}

export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin");
}
