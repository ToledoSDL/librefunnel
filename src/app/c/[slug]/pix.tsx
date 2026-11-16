import type { ReactNode } from "react";
import { Button } from "@/components/action/button";
import { Card } from "@/components/layout/card";
import { Row } from "@/components/layout/row";
import { Stack } from "@/components/layout/stack";
import { Icon } from "@/components/media/icon";
import { Text } from "@/components/text/text";
import { TextLink } from "@/components/text/text-link";
import { getProduct } from "@/lib/catalog/products";
import type { Product } from "@/lib/catalog/products";
import { hasPaidOrderCookie } from "@/lib/members";
import { pixQrSvg } from "@/lib/orders/pix";
import type { PixOrder } from "@/lib/orders/checkout";
import { enterFromOrder } from "@/lib/actions/members";
import { simulatePayment } from "@/lib/actions/checkout";
import { demoMode } from "@/lib/guard";
import { DateTime, Money } from "@/app/format";
import { TrackClick } from "@/app/track";
import { ActionForm, FormMessage, RefreshWhilePending, SubmitLabel } from "@/app/ui";
import styles from "./page.module.css";
import { PixCopy } from "./pix-copy";

function StatusCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={styles.narrow}>
      <Card>
        <Text variant="heading" as="h1">
          {title}
        </Text>
        {children}
      </Card>
    </main>
  );
}

export async function PixPage({
  product,
  order,
  thanks,
}: {
  product: Product;
  order: PixOrder;
  thanks?: { url: string; label: string };
}) {
  const bump = order.bump ? await getProduct(order.bump) : undefined;
  const items = bump ? `${product.name} + ${bump.name}` : product.name;
  const retry = `/c/${product.slug}${order.bump ? "?bump=1" : ""}#buy`;

  if (order.status === "pending") {
    const qr = order.payUrl ? "" : await pixQrSvg(order.pixCode);

    return (
      <main className={styles.narrow}>
        <RefreshWhilePending />
        <Stack gap={4}>
          <Card>
            <Stack gap={1}>
              <Text variant="heading" as="h1">
                Pague <Money cents={order.amount} /> com Pix
              </Text>
              <Text variant="body-sm" tone="muted">
                Vence em <DateTime at={order.expiresAt} />. Esta página atualiza sozinha quando o pagamento cair.
              </Text>
            </Stack>
            {order.payUrl ? (
              <Stack gap={2}>
                <a href={order.payUrl} className={styles.buy}>
                  Pagar com Pix
                </a>
                <Text variant="body-sm" tone="muted">
                  Abre a página segura da NoxPay, que pede o seu CPF.
                </Text>
              </Stack>
            ) : (
              <div className={styles.pix}>
                <div
                  className={styles.pixQr}
                  role="img"
                  aria-label="QR Code do Pix"
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
                <Stack gap={3}>
                  <TrackClick event="pix_copy" product={product.slug}>
                    <PixCopy
                      code={order.pixCode}
                      icons={{ copy: <Icon name="copy" />, copied: <Icon name="check" /> }}
                    />
                  </TrackClick>
                  <Text variant="body-sm" tone="muted">
                    No app do banco: <strong>Pix</strong> › <strong>Pix Copia e Cola</strong>.
                  </Text>
                  <details className={styles.qrToggle}>
                    <summary>Mostrar QR Code</summary>
                    <div
                      className={styles.qr}
                      role="img"
                      aria-label="QR Code do Pix"
                      dangerouslySetInnerHTML={{ __html: qr }}
                    />
                  </details>
                </Stack>
              </div>
            )}
          </Card>
          {demoMode() ? (
            <ActionForm action={simulatePayment} fields={{ orderId: order.id }}>
              <Stack gap={2}>
                <Button type="submit" variant="outline" tone="neutral" block>
                  <SubmitLabel idle="Simular pagamento (demonstração)" pending="Confirmando pagamento" />
                </Button>
                <FormMessage />
              </Stack>
            </ActionForm>
          ) : null}
          <p className={styles.summary}>
            {items} · acesso enviado para {order.maskedEmail}. <TextLink href={retry}>Corrigir dados</TextLink>
          </p>
        </Stack>
      </main>
    );
  }

  if (order.status === "paid") {
    const canEnter = await hasPaidOrderCookie();

    return (
      <StatusCard title="Pagamento confirmado">
        <Text tone="muted">
          {order.firstName}, seu acesso a {items} está liberado.
        </Text>
        {canEnter ? (
          <ActionForm action={enterFromOrder}>
            <Stack gap={2}>
              <button type="submit" className={styles.buy}>
                <SubmitLabel idle="Entrar na área de membros" pending="Entrando" />
              </button>
              <FormMessage />
            </Stack>
          </ActionForm>
        ) : null}
        {thanks && canEnter ? (
          <Button href={thanks.url} newTab variant="outline" tone="neutral" size="lg" block>
            {thanks.label}
          </Button>
        ) : thanks ? (
          <a href={thanks.url} target="_blank" rel="noopener noreferrer" className={styles.buy}>
            {thanks.label}
          </a>
        ) : null}
        <Text variant="body-sm" tone="muted">
          {canEnter
            ? `O link de acesso também foi para ${order.maskedEmail}.`
            : `O link de acesso foi para ${order.maskedEmail}. Não chegou? Confira o spam ou`}{" "}
          <TextLink href="/m">{canEnter ? "Entrar com e-mail" : "peça outro"}</TextLink>
        </Text>
      </StatusCard>
    );
  }

  if (order.status === "refunded") {
    return (
      <StatusCard title="Pedido reembolsado">
        <Text tone="muted">O valor foi devolvido e o acesso a {items} foi encerrado.</Text>
        <Row>
          <Button href={product.vsl ? `/v/${product.slug}` : `/c/${product.slug}`}>Ver a página do produto</Button>
        </Row>
      </StatusCard>
    );
  }

  return (
    <StatusCard title={order.status === "expired" ? "Este Pix expirou" : "Este Pix foi substituído"}>
      <RefreshWhilePending />
      <Text tone="muted">
        {order.status === "expired"
          ? "Gere um novo código: leva poucos segundos."
          : "Há um pedido mais novo para este produto. Use o Pix mais recente ou gere outro."}
      </Text>
      <a href={retry} className={styles.buy}>
        Gerar novo Pix
      </a>
    </StatusCard>
  );
}
