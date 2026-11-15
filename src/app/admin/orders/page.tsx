import { DateTime, Money } from "@/app/format";
import { Button } from "@/components/action/button";
import { MenuPopover } from "@/components/action/menu-popover";
import { buttonAttributes } from "@/components/action/button";
import { ButtonContent } from "@/components/action/button-content";
import { Pagination } from "@/components/data/pagination";
import { Table } from "@/components/data/table";
import { Tabs } from "@/components/data/tabs";
import { EmptyState } from "@/components/feedback/empty-state";
import { Input } from "@/components/form/input";
import { SegmentedControl } from "@/components/form/segmented-control";
import { PageHeader } from "@/components/layout/page-header";
import { Stack } from "@/components/layout/stack";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import { productNames } from "@/lib/catalog";
import { orders } from "@/lib/dashboard";
import type { OrderStatus } from "@/lib/orders";
import { type Days, href, INTEGER, pick, type Query, requireAdmin, STATUS_LABEL, STATUS_TONE } from "../shared";
import styles from "./orders.module.css";

const PAGE_SIZE = 50;

const STATUSES: OrderStatus[] = ["paid", "pending", "refunded", "expired", "canceled"];

const PERIODS = [
  { value: "", label: "Tudo" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
];

type Filters = { q: string; status: OrderStatus | ""; product: string; days: Days | null; page: number };

function daysOf(raw: string): Days | null {
  return raw === "7" ? 7 : raw === "30" ? 30 : raw === "90" ? 90 : null;
}

// Every link keeps the other filters and goes back to the first page.
function link(filters: Filters, change: Partial<Filters>) {
  const next = { ...filters, page: 1, ...change };
  const query: Record<string, string> = {};

  if (next.q) query.q = next.q;
  if (next.status) query.status = next.status;
  if (next.product) query.product = next.product;
  if (next.days) query.days = String(next.days);
  if (next.page > 1) query.page = String(next.page);
  return href("orders", query);
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();

  const query = await searchParams;
  const names = await productNames();
  const product = pick(query.product);

  const filters: Filters = {
    q: pick(query.q).trim(),
    status: STATUSES.find((item) => item === pick(query.status)) ?? "",
    product: names.has(product) ? product : "",
    days: daysOf(pick(query.days)),
    page: Math.max(1, Number.parseInt(pick(query.page), 10) || 1),
  };

  const result = await orders(filters);
  const all = [...result.counts.values()].reduce((sum, value) => sum + value, 0);
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const first = (filters.page - 1) * PAGE_SIZE + 1;
  const filtered = Boolean(filters.q || filters.status || filters.product || filters.days);

  const csv = `/admin/orders.csv?${new URLSearchParams({
    ...(filters.days ? { days: String(filters.days) } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  })}`;

  return (
    <Stack gap={5}>
      <PageHeader
        title="Pedidos"
        actions={
          <Button href={csv} icon="download" size="sm">
            Exportar
          </Button>
        }
      />

      <Tabs
        label="Situação"
        items={[
          { label: "Todos", href: link(filters, { status: "" }), current: !filters.status, count: all },
          ...STATUSES.filter((status) => result.counts.get(status) || filters.status === status).map((status) => ({
            label: STATUS_LABEL[status],
            href: link(filters, { status }),
            current: filters.status === status,
            count: result.counts.get(status) ?? 0,
          })),
        ]}
      />

      <div className={styles.toolbar}>
        <form method="get" action="/admin/orders" role="search" className={styles.search}>
          {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
          {filters.product ? <input type="hidden" name="product" value={filters.product} /> : null}
          {filters.days ? <input type="hidden" name="days" value={filters.days} /> : null}
          <Input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Buscar nome, e-mail, WhatsApp ou Pix"
            aria-label="Buscar pedidos"
          />
        </form>
        <div className={styles.filters}>
          <MenuPopover
            trigger={
              <ButtonContent icon="package">
                {filters.product ? (names.get(filters.product) ?? filters.product) : "Todos os produtos"}
              </ButtonContent>
            }
            triggerLook={buttonAttributes({ variant: "outline", size: "sm" })}
            items={[
              { label: "Todos os produtos", href: link(filters, { product: "" }) },
              ...[...names].map(([slug, name]) => ({ label: name, href: link(filters, { product: slug }) })),
            ]}
          />
          <SegmentedControl
            label="Período"
            value={filters.days ? String(filters.days) : ""}
            options={PERIODS}
            href={(value) => link(filters, { days: daysOf(value) })}
          />
        </div>
      </div>

      {result.rows.length ? (
        <>
          <Table
            caption="Pedidos"
            columns={[
              { key: "amount", label: "Valor" },
              { key: "product", label: "Produto", wide: true },
              { key: "buyer", label: "Comprador" },
              { key: "date", label: "Data", align: "end", wide: true },
            ]}
            rows={result.rows.map((row) => {
              const underpaid = row.status === "pending" && row.received > 0;

              return {
                id: row.id,
                href: `/admin/orders/${row.id}`,
                label: `Pedido de ${row.name}`,
                cells: {
                  amount: (
                    <span className={styles.amount}>
                      <Text as="span" variant="body-sm" weight="semibold">
                        <Money cents={row.amount} />
                      </Text>
                      {underpaid ? (
                        <Badge tone="danger">Pago a menos</Badge>
                      ) : row.status === "paid" ? null : (
                        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      )}
                    </span>
                  ),
                  product: (
                    <Text as="span" variant="body-sm">
                      {names.get(row.product) ?? row.product}
                      {row.bump ? (
                        <Text as="span" variant="body-sm" tone="muted">
                          {" "}
                          + {names.get(row.bump) ?? row.bump}
                        </Text>
                      ) : null}
                    </Text>
                  ),
                  buyer: (
                    <span className={styles.buyer}>
                      <Text as="span" variant="body-sm">
                        {row.name}
                      </Text>
                      <Text as="span" variant="body-sm" tone="muted">
                        {row.email}
                      </Text>
                    </span>
                  ),
                  date: (
                    <Text as="span" variant="body-sm" tone="muted">
                      <DateTime at={row.createdAt} />
                    </Text>
                  ),
                },
              };
            })}
          />
          <div className={styles.footer}>
            <Text variant="body-sm" tone="muted">
              {INTEGER.format(first)} a {INTEGER.format(first + result.rows.length - 1)} de{" "}
              {INTEGER.format(result.total)} {result.total === 1 ? "pedido" : "pedidos"}
            </Text>
            <Pagination page={filters.page} pages={pages} href={(target) => link(filters, { page: target })} />
          </div>
        </>
      ) : (
        <EmptyState
          title={filtered ? "Nenhum pedido com esses filtros" : "Nenhum pedido ainda"}
          description={filtered ? "Mude a busca ou os filtros." : "Os pedidos aparecem aqui quando alguém gera um Pix."}
          action={filtered ? <Button href={href("orders")}>Limpar filtros</Button> : undefined}
        />
      )}
    </Stack>
  );
}
