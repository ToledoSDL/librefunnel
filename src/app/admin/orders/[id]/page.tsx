import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DateTime, Money } from "@/app/format";
import { Stack } from "@/components/layout/stack";
import { Icon } from "@/components/media/icon";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import { TextLink } from "@/components/text/text-link";
import { productNames } from "@/lib/catalog";
import { orderDetail } from "@/lib/dashboard";
import { Profile } from "../../messages/profile";
import { contactLabel } from "../../messages/labels";
import { href, OrderActions, Release, requireAdmin, STATUS_LABEL, STATUS_TONE } from "../../shared";
import styles from "../orders.module.css";
import { Invoice } from "./invoice";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();

  const { id } = await params;
  const [found, names] = await Promise.all([orderDetail(id), productNames()]);

  if (!found) notFound();

  const underpaid = found.status === "pending" && found.received > 0;
  const product = names.get(found.product) ?? found.product;
  const bump = found.bump ? (names.get(found.bump) ?? found.bump) : null;

  return (
    <Stack gap={6}>
      <a className={styles.back} href={href("orders")}>
        <Icon name="arrow-left" size={16} />
        Pedidos
      </a>

      <header className={styles.head}>
        <Stack gap={2}>
          <div className={styles.headline}>
            <Text variant="metric" as="h1">
              <Money cents={found.amount} />
            </Text>
            {underpaid ? (
              <Badge tone="danger">Pago a menos</Badge>
            ) : (
              <Badge tone={STATUS_TONE[found.status]}>{STATUS_LABEL[found.status]}</Badge>
            )}
          </div>
          <Text tone="muted">
            {product}
            {bump ? ` + ${bump}` : ""} · {found.name}
          </Text>
        </Stack>
        {found.status === "paid" ? <OrderActions row={found} /> : null}
      </header>

      <div className={styles.columns}>
        <Stack gap={7}>
          {found.status !== "paid" && found.status !== "refunded" ? (
            <Stack gap={4}>
              <Text variant="heading" as="h2">
                Liberar manualmente
              </Text>
              <Release row={found} />
            </Stack>
          ) : null}
          <Stack gap={4}>
            <Text variant="heading" as="h2">
              Pagamento
            </Text>
            <dl className={styles.facts}>
              <Fact label={product}>
                <Money cents={found.productAmount} />
              </Fact>
              {bump && found.bumpAmount ? (
                <Fact label={bump}>
                  <Money cents={found.bumpAmount} />
                </Fact>
              ) : null}
              <Fact label="Recebido">
                <Money cents={found.received} />
              </Fact>
              <Fact label="Criado em">
                <DateTime at={found.createdAt} />
              </Fact>
              {found.paidAt ? (
                <Fact label="Pago em">
                  <DateTime at={found.paidAt} />
                </Fact>
              ) : found.status === "pending" ? (
                <Fact label="Vence em">
                  <DateTime at={found.expiresAt} />
                </Fact>
              ) : null}
              <Fact label="Identificador do Pix">
                <Text as="span" variant="body-sm" mono>
                  {found.txid}
                </Text>
              </Fact>
              <Fact label="E-mail">
                <TextLink href={href("messages", { c: `email:${found.email}` })}>{found.email}</TextLink>
              </Fact>
              {found.document ? (
                <Fact label={found.document.length === 11 ? "CPF" : "CNPJ"}>
                  <Text as="span" variant="body-sm" mono>
                    {found.document}
                  </Text>
                </Fact>
              ) : null}
              {found.phone ? (
                <Fact label="WhatsApp">
                  <TextLink href={href("messages", { c: `whatsapp:${found.phone}` })}>
                    {contactLabel(found.phone)}
                  </TextLink>
                </Fact>
              ) : null}
            </dl>
          </Stack>
          {found.invoicesOn || found.invoice ? (
            <Stack gap={4}>
              <Text variant="heading" as="h2">
                Nota fiscal
              </Text>
              <Invoice orderId={found.id} paid={found.status === "paid"} invoice={found.invoice} />
            </Stack>
          ) : null}
        </Stack>
        <aside className={styles.side} aria-label="Comprador">
          <Profile thread={{ name: found.name, photo: null, address: found.email, profile: found.profile }} />
        </aside>
      </div>
    </Stack>
  );
}
