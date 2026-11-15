import { Money } from "@/app/format";
import { Button } from "@/components/action/button";
import { Chart } from "@/components/data/chart";
import { Table } from "@/components/data/table";
import { Alert } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { SegmentedControl } from "@/components/form/segmented-control";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { Row } from "@/components/layout/row";
import { Stack } from "@/components/layout/stack";
import { Stat } from "@/components/text/stat";
import { Text } from "@/components/text/text";
import { productStates, settings } from "@/lib/catalog";
import { funnel, integrations, orders, revenueByDay, sources, summary } from "@/lib/dashboard";
import { brl } from "@/lib/messages";
import { redirect } from "next/navigation";
import styles from "./admin.module.css";
import { Setup } from "./setup/setup";
import {
  Amount,
  type Days,
  href,
  INTEGER,
  type Links,
  OrderActions,
  periodOf,
  Periods,
  pick,
  type Query,
  requireAdmin,
  TABS,
} from "./shared";

type Model = "last" | "first";

type FunnelStep = "visitors" | "played" | "offer" | "clicked" | "started" | "paid";

const FUNNEL_STEPS: { key: FunnelStep; label: string }[] = [
  { key: "visitors", label: "Visitaram" },
  { key: "played", label: "Deram play" },
  { key: "offer", label: "Viram a oferta" },
  { key: "clicked", label: "Clicaram" },
  { key: "started", label: "Geraram o Pix" },
  { key: "paid", label: "Pagaram" },
];

const PERCENT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

function shortDay(day: string) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function Broken({ links }: { links: Links }) {
  if (links.failedMessages > 0) {
    return (
      <Alert
        title={`${INTEGER.format(links.failedMessages)} ${links.failedMessages === 1 ? "mensagem falhou" : "mensagens falharam"}`}
        action={<Button href={href("messages")}>Ver e reenviar</Button>}
      >
        Pode ser comprador sem link de acesso. Veja o motivo de cada uma e reenvie.
      </Alert>
    );
  }

  if (
    !links.cloud.configured &&
    links.whatsapp.configured &&
    (links.whatsapp.state === "close" || links.whatsapp.state === "error")
  ) {
    return (
      <Alert
        tone="warning"
        title="WhatsApp desconectado: recuperação de carrinho e avisos de pagamento estão parados"
        action={<Button href={href("connections")}>Conectar de novo</Button>}
      >
        Leia o QR Code com o celular do número de vendas para voltar a enviar.
      </Alert>
    );
  }

  return null;
}

async function Overview({ days, model }: { days: Days; model: Model }) {
  const [stats, daily, steps, origins, links, items, store, waiting] = await Promise.all([
    summary(days),
    revenueByDay(days),
    funnel(days),
    sources(days, model),
    integrations(),
    productStates(),
    settings(),
    orders({ q: "", status: "pending", page: 1 }),
  ]);

  const names = new Map(items.map((item) => [item.slug, item.name]));
  const release = waiting.rows.slice(0, 5);

  return (
    <>
      <PageHeader
        title="Resumo"
        actions={<Periods tab="overview" days={days} extra={model === "first" ? { model: "first" } : {}} />}
      />
      <Broken links={links} />
      <Setup links={links} store={store} items={items} />
      <Card>
        <Stat
          lead
          label="Receita líquida"
          value={<Money cents={stats.revenue} />}
          note={stats.paidOrders ? "Já descontados os reembolsos" : `Nenhuma venda nos últimos ${days} dias`}
        />
        {stats.paidOrders ? (
          <Row gap={7} align="start">
            <Stat
              label="Vendas pagas"
              value={INTEGER.format(stats.paidOrders)}
              note={`${INTEGER.format(stats.buyers)} ${stats.buyers === 1 ? "comprador" : "compradores"}`}
            />
            <Stat
              label="Ticket médio"
              value={<Money cents={stats.averageTicket} />}
              note={stats.bumpRate ? `${PERCENT.format(stats.bumpRate)} levaram o order bump` : undefined}
            />
            {stats.recoveredOrders ? (
              <Stat
                label="Vendas recuperadas"
                value={INTEGER.format(stats.recoveredOrders)}
                note={
                  <>
                    <Money cents={stats.recoveredRevenue} /> depois de uma mensagem
                  </>
                }
              />
            ) : null}
          </Row>
        ) : null}
        <Chart
          kind="bars"
          title="Receita por dia"
          data={daily.map((point) => ({ label: shortDay(point.day), value: point.amount }))}
          format={brl}
          empty="A receita de cada dia aparece aqui quando o primeiro Pix for pago."
        />
      </Card>
      {release.length ? (
        <Card
          title={`${INTEGER.format(waiting.total)} ${waiting.total === 1 ? "pedido aguardando" : "pedidos aguardando"} Pix`}
          actions={<Button href={href("orders", { status: "pending" })}>Ver todos</Button>}
        >
          <Table
            caption="Pedidos aguardando Pix"
            columns={[
              { key: "buyer", label: "Comprador" },
              { key: "amount", label: "Valor", align: "end" },
              { key: "action", label: "Ação" },
            ]}
            rows={release.map((row) => ({
              id: row.id,
              cells: {
                buyer: <Text variant="body-sm">{row.name}</Text>,
                amount: <Amount row={row} />,
                action: <OrderActions row={row} />,
              },
            }))}
          />
        </Card>
      ) : null}
      <div className={styles.columns}>
        <Card title="Funil">
          {steps.length ? (
            steps.map((row) => (
              <Stack gap={3} key={row.product}>
                {steps.length > 1 ? (
                  <Text variant="body-sm" weight="semibold">
                    {names.get(row.product) ?? row.product}
                  </Text>
                ) : null}
                <Chart
                  kind="funnel"
                  title={`Funil de ${names.get(row.product) ?? row.product}`}
                  data={FUNNEL_STEPS.map((step) => ({ label: step.label, value: row[step.key] }))}
                  format={(value) => INTEGER.format(value)}
                  empty="Nenhuma visita no período."
                />
              </Stack>
            ))
          ) : (
            <EmptyState
              title={`Nenhuma visita nos últimos ${days} dias`}
              description="Os números aparecem quando alguém abrir a página de vendas de um produto."
              action={<Button href={href("products")}>Ver produtos</Button>}
            />
          )}
        </Card>
        <Card
          title="Vendas por origem"
          actions={
            <SegmentedControl
              label="Modelo de atribuição"
              value={model}
              options={[
                { value: "last", label: "Último toque" },
                { value: "first", label: "Primeiro toque" },
              ]}
              href={(value) =>
                href("overview", value === "first" ? { days: String(days), model: value } : { days: String(days) })
              }
            />
          }
        >
          {origins.length ? (
            <Table
              caption="Vendas por origem"
              columns={[
                { key: "source", label: "Origem" },
                { key: "campaign", label: "Campanha" },
                { key: "orders", label: "Vendas", align: "end" },
                { key: "revenue", label: "Receita", align: "end" },
              ]}
              rows={origins.map((row) => ({
                id: `${row.source}|${row.campaign}`,
                cells: {
                  source: row.source || "(direto)",
                  campaign: (
                    <Text variant="body-sm" tone="muted">
                      {row.campaign || "sem campanha"}
                    </Text>
                  ),
                  orders: INTEGER.format(row.orders),
                  revenue: <Money cents={row.revenue} />,
                },
              }))}
            />
          ) : (
            <EmptyState
              title="Nenhuma venda no período"
              description="Coloque utm_source e utm_campaign nos links dos anúncios para saber qual anúncio vendeu."
            />
          )}
          <Text variant="body-sm" tone="muted">
            {model === "last"
              ? "Último toque: a venda conta para o último anúncio clicado antes do pedido."
              : "Primeiro toque: a venda conta para o anúncio que trouxe a pessoa pela primeira vez."}
          </Text>
        </Card>
      </div>
    </>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();

  const query = await searchParams;
  const target = TABS.find((item) => item.key === pick(query.tab));

  if (target) {
    const rest = Object.fromEntries(
      Object.entries(query).flatMap(([key, value]) => (key === "tab" ? [] : [[key, pick(value)]])),
    );

    redirect(href(target.key, rest));
  }

  return (
    <>
      <Overview days={periodOf(query)} model={pick(query.model) === "first" ? "first" : "last"} />
    </>
  );
}
