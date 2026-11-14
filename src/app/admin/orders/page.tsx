import { DateTime } from "@/app/ui";
import { Button } from "@/components/action/button";
import { Pagination } from "@/components/data/pagination";
import { Table } from "@/components/data/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Field } from "@/components/form/field";
import { Input } from "@/components/form/input";
import { Select } from "@/components/form/select";
import { PageHeader } from "@/components/layout/page-header";
import { Row } from "@/components/layout/row";
import { Stack } from "@/components/layout/stack";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import { productNames } from "@/lib/catalog";
import { orders } from "@/lib/dashboard";
import type { OrderStatus } from "@/lib/orders";
import {
  Amount,
  type Days,
  href,
  INTEGER,
  OrderActions,
  periodOf,
  Periods,
  pick,
  type Query,
  requireAdmin,
  STATUS_LABEL,
  STATUS_TONE,
} from "../shared";

const PAGE_SIZE = 50;

const STATUSES: OrderStatus[] = ["pending", "paid", "expired", "canceled", "refunded"];

async function OrdersTab({ q, status, page, days }: { q: string; status: OrderStatus | ""; page: number; days: Days }) {
  const [result, names] = await Promise.all([orders({ q, status, page }), productNames()]);
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const keep = { q, status, days: String(days) };
  const csv = `/admin/orders.csv?${new URLSearchParams(status ? { days: String(days), status } : { days: String(days) })}`;

  return (
    <>
      <PageHeader
        title="Pedidos"
        description={`${INTEGER.format(result.total)} ${result.total === 1 ? "pedido" : "pedidos"}`}
        actions={
          <>
            <Periods tab="orders" days={days} extra={{ q, status }} />
            <Button href={csv} icon="download">
              CSV de {days} dias
            </Button>
          </>
        }
      />
      <form method="get" action="/admin" role="search">
        <input type="hidden" name="tab" value="orders" />
        <input type="hidden" name="days" value={days} />
        <Row gap={3} align="end">
          <Field label="Buscar">
            {(control) => (
              <Input
                {...control}
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Nome, e-mail ou identificador do Pix"
              />
            )}
          </Field>
          <Field label="Situação">
            {(control) => (
              <Select
                {...control}
                name="status"
                defaultValue={status}
                options={[
                  { value: "", label: "Todas" },
                  ...STATUSES.map((item) => ({ value: item, label: STATUS_LABEL[item] })),
                ]}
              />
            )}
          </Field>
          <Button type="submit">Filtrar</Button>
        </Row>
      </form>
      {result.rows.length ? (
        <Table
          caption="Pedidos"
          columns={[
            { key: "date", label: "Data" },
            { key: "buyer", label: "Comprador" },
            { key: "product", label: "Produto" },
            { key: "amount", label: "Valor", align: "end" },
            { key: "status", label: "Situação" },
            { key: "actions", label: "Ações" },
          ]}
          rows={result.rows.map((row) => ({
            id: row.id,
            cells: {
              date: (
                <Text variant="caption" tone="muted">
                  <DateTime at={row.createdAt} />
                </Text>
              ),
              buyer: (
                <Stack gap={1}>
                  <Text as="span" variant="body-sm" weight="semibold">
                    {row.name}
                  </Text>
                  <Text as="span" variant="caption" tone="muted">
                    {row.email}
                  </Text>
                </Stack>
              ),
              product: (
                <Stack gap={1}>
                  <Text as="span" variant="body-sm">
                    {names.get(row.product) ?? row.product}
                  </Text>
                  {row.bump ? (
                    <Text as="span" variant="caption" tone="muted">
                      + {names.get(row.bump) ?? row.bump}
                    </Text>
                  ) : null}
                </Stack>
              ),
              amount: <Amount row={row} />,
              status: (
                <Stack gap={1}>
                  {row.status === "pending" && row.received > 0 ? (
                    <span>
                      <Badge tone="danger">Pago a menos</Badge>
                    </span>
                  ) : row.status === "paid" ? null : (
                    <span>
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    </span>
                  )}
                  <Text as="span" variant="caption" tone="muted" mono>
                    {row.txid}
                  </Text>
                </Stack>
              ),
              actions: <OrderActions row={row} />,
            },
          }))}
        />
      ) : (
        <EmptyState
          title={q || status ? "Nenhum pedido com esses filtros" : "Nenhum pedido ainda"}
          description={
            q || status
              ? "Confira a grafia ou limpe a busca."
              : "Eles aparecem aqui assim que alguém gerar um Pix na página de um produto."
          }
          action={q || status ? <Button href={href("orders", { days: String(days) })}>Limpar busca</Button> : undefined}
        />
      )}
      <Pagination page={page} pages={pages} href={(target) => href("orders", { ...keep, page: String(target) })} />
    </>
  );
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();

  const query = await searchParams;
  const status = STATUSES.find((item) => item === pick(query.status)) ?? "";
  const page = Math.max(1, Number.parseInt(pick(query.page), 10) || 1);

  return (
    <>
      <OrdersTab q={pick(query.q).trim()} status={status} page={page} days={periodOf(query)} />
    </>
  );
}
