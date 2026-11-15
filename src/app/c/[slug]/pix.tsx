import type { ReactNode } from "react";
import { Button } from "@/components/action/button";
import { CopyField } from "@/components/action/copy-field";
import { Card } from "@/components/layout/card";
import { Row } from "@/components/layout/row";
import { Stack } from "@/components/layout/stack";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import { TextLink } from "@/components/text/text-link";
import { getProduct } from "@/lib/catalog";
import type { Product } from "@/lib/catalog";
import { hasPaidOrderCookie } from "@/lib/members";
import { pixQrSvg } from "@/lib/orders";
import type { PixOrder } from "@/lib/orders";
import { enterFromOrder, simulatePayment } from "@/lib/actions";
import { demoMode } from "@/lib/guard";
import { DateTime, Money } from "@/app/format";
import { ActionForm, FormMessage, RefreshWhilePending, SubmitLabel } from "@/app/ui";
import styles from "./page.module.css";
function StatusCard({ badge, title, children }: { badge: ReactNode; title: string; children: ReactNode }) {
  return (
    <main className={styles.narrow}>
      <Card>
        <Stack gap={2}>
          <Row>{badge}</Row>
          <Text variant="heading" as="h1">
            {title}
          </Text>
        </Stack>
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
    const qr = await pixQrSvg(order.pixCode);

    return (
      <main className={styles.narrow}>
        <RefreshWhilePending />
        <Stack gap={5}>
          <Card>
            <Stack gap={2}>
              <Row>
                <Badge tone="warning">Aguardando pagamento</Badge>
              </Row>
              <Text variant="heading" as="h1">
                Pix gerado! Falta só pagar
              </Text>
              <Text variant="metric">
                <Money cents={order.amount} />
              </Text>
              <Text variant="body-sm">
                Pague até <DateTime at={order.expiresAt} />. Depois disso o código vence.
              </Text>
            </Stack>
            <div className={styles.pix}>
              <div className={styles.pixCode}>
                <Stack gap={4}>
                  <CopyField label="Pix Copia e Cola" value={order.pixCode} multiline />
                  <ol className={styles.steps}>
                    <li>
                      <Text variant="body-sm">
                        Toque em <strong>Copiar</strong>.
                      </Text>
                    </li>
                    <li>
                      <Text variant="body-sm">
                        Abra o app do seu banco, entre em <strong>Pix</strong> e escolha{" "}
                        <strong>Pix Copia e Cola</strong>.
                      </Text>
                    </li>
                    <li>
                      <Text variant="body-sm">
                        Cole o código e confirme{" "}
                        <strong>
                          <Money cents={order.amount} />
                        </strong>
                        . Esta página muda sozinha quando o pagamento cair.
                      </Text>
                    </li>
                  </ol>
                </Stack>
              </div>
              <div className={styles.pixQr}>
                <Stack gap={2}>
                  <div
                    className={styles.qr}
                    role="img"
                    aria-label="QR Code do Pix"
                    dangerouslySetInnerHTML={{ __html: qr }}
                  />
                  <Text variant="body-sm" tone="muted">
                    Pagando pelo computador? Leia o QR com o app do banco.
                  </Text>
                </Stack>
              </div>
            </div>
          </Card>
          {demoMode() ? (
            <Card title="Demonstração">
              <Text variant="body-sm" tone="muted">
                Esta loja não recebe Pix de verdade. Simule o pagamento para ver o pedido liberado e a área de membros.
              </Text>
              <ActionForm action={simulatePayment} fields={{ orderId: order.id }}>
                <Stack gap={2}>
                  <Button type="submit" variant="outline" tone="neutral" block>
                    <SubmitLabel idle="Simular pagamento" pending="Confirmando pagamento" />
                  </Button>
                  <FormMessage />
                </Stack>
              </ActionForm>
            </Card>
          ) : null}
          <Card title="Resumo do pedido">
            <Stack gap={2}>
              <Row justify="between" align="baseline">
                <Text variant="body-sm" tone="muted">
                  Produto
                </Text>
                <Text variant="body-sm">{items}</Text>
              </Row>
              <Row justify="between" align="baseline">
                <Text variant="body-sm" tone="muted">
                  O acesso vai para
                </Text>
                <Text variant="body-sm">{order.maskedEmail}</Text>
              </Row>
            </Stack>
            <Text variant="body-sm" tone="muted">
              E-mail errado ou quer mudar o pedido? <TextLink href={retry}>Corrigir dados</TextLink>
            </Text>
          </Card>
        </Stack>
      </main>
    );
  }

  if (order.status === "paid") {
    const canEnter = await hasPaidOrderCookie();

    return (
      <StatusCard badge={<Badge tone="success">Pago</Badge>} title="Pagamento confirmado!">
        <Text tone="muted">
          Obrigado, {order.firstName}. Sua compra de {items} está liberada.
        </Text>
        {canEnter ? (
          <ActionForm action={enterFromOrder}>
            <Stack gap={2}>
              <Button type="submit" variant="solid" tone="primary" size="lg" block>
                <SubmitLabel idle="Entrar na área de membros" pending="Entrando" />
              </Button>
              <FormMessage />
            </Stack>
          </ActionForm>
        ) : null}
        {thanks ? (
          <Button
            href={thanks.url}
            newTab
            variant={canEnter ? "outline" : "solid"}
            tone={canEnter ? "neutral" : "primary"}
            size="lg"
            block
          >
            {thanks.label}
          </Button>
        ) : null}
        <Text variant="body-sm" tone="muted">
          {canEnter
            ? `O link de acesso também vai para ${order.maskedEmail}, para você entrar de outros aparelhos.`
            : `O link de acesso está a caminho de ${order.maskedEmail}. Não chegou em alguns minutos? Confira o spam ou peça outro.`}{" "}
          <TextLink href="/m">{canEnter ? "Entrar com e-mail" : "Pedir novo link"}</TextLink>
        </Text>
      </StatusCard>
    );
  }

  if (order.status === "refunded") {
    return (
      <StatusCard badge={<Badge tone="danger">Reembolsado</Badge>} title="Pedido reembolsado">
        <Text tone="muted">O valor foi devolvido e o acesso a {items} foi encerrado.</Text>
        <Row>
          <Button href={product.vsl ? `/v/${product.slug}` : `/c/${product.slug}`}>Ver a página do produto</Button>
        </Row>
      </StatusCard>
    );
  }

  return (
    <StatusCard
      badge={<Badge tone="warning">{order.status === "expired" ? "Expirado" : "Substituído"}</Badge>}
      title={order.status === "expired" ? "Este Pix expirou" : "Este Pix foi substituído"}
    >
      <RefreshWhilePending />
      <Text tone="muted">
        {order.status === "expired" ? (
          <>
            O código venceu em <DateTime at={order.expiresAt} /> e não pode mais ser pago. Gere um novo: leva menos de
            um minuto.
          </>
        ) : (
          "Você gerou um pedido mais novo para este produto, com outros dados. Use o Pix mais recente ou gere outro agora."
        )}
      </Text>
      <Button href={retry} variant="solid" tone="primary" size="lg" block>
        Gerar novo Pix
      </Button>
      <Text variant="body-sm" tone="muted">
        Já pagou este código? Esta página muda sozinha quando o pagamento cair.
      </Text>
    </StatusCard>
  );
}
