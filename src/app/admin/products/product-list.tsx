import { Money } from "@/app/format";
import { Button } from "@/components/action/button";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Icon } from "@/components/media/icon";
import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import type { Product } from "@/lib/catalog";
import { BrandLogo } from "@/components/media/brand-logo";
import { Text } from "@/components/text/text";
import { TextLink } from "@/components/text/text-link";
import type { PixProvider } from "@/lib/orders";
import { GHOST, href, PRIMARY, TextField } from "../shared";
import { ItemActions } from "./item-actions";
import { MoneyField } from "./money-field";
import { NewProductForm } from "./new-product-form";
import { PixFields } from "./pix-fields";
import styles from "./products.module.css";

export type Payment = { provider: PixProvider; name: string; account?: Product["pix"] };

function PaymentStep({ payment }: { payment: Payment }) {
  if (!payment.account) {
    return (
      <>
        <Text variant="body-sm" tone="muted">
          Onde o dinheiro das vendas cai. Vale para todos os produtos e muda em Conexões.
        </Text>
        <PixFields />
      </>
    );
  }

  return (
    <div className={styles.payment}>
      <BrandLogo brand={payment.provider === "static" ? "pix" : payment.provider} />
      <span className={styles.paymentText}>
        <Text as="span" weight="semibold">
          {payment.provider === "static" ? "Pix na sua chave" : payment.name}
        </Text>
        <Text as="span" variant="body-sm" tone="muted">
          {payment.provider === "static"
            ? `Cai em ${payment.account.key}`
            : `Libera o acesso sozinho. Reserva: ${payment.account.key}`}
        </Text>
      </span>
      <TextLink href={href("connections")}>Trocar</TextLink>
    </div>
  );
}

function NewProduct({ payment, primary }: { payment: Payment; primary?: boolean }) {
  return (
    <Dialog
      trigger={{
        label: "Novo produto",
        icon: "plus",
        variant: primary ? "solid" : "outline",
        tone: primary ? "primary" : "neutral",
      }}
      title="Novo produto"
      body={
        <NewProductForm
          primary={PRIMARY}
          ghost={GHOST}
          details={
            <>
              <TextField label="Nome" name="name" required maxLength={120} placeholder="Curso de Confeitaria" />
              <div className={styles.pair}>
                <MoneyField label="Preço" name="price" required placeholder="97,00" />
                <TextField
                  label="Endereço da página"
                  hint="Em branco, gera pelo nome."
                  name="slug"
                  maxLength={60}
                  placeholder="curso-de-confeitaria"
                />
              </div>
            </>
          }
          payment={<PaymentStep payment={payment} />}
        />
      }
    />
  );
}

export function ProductList({ items, payment }: { items: Product[]; payment: Payment }) {
  return (
    <>
      <PageHeader title="Produtos" actions={items.length ? <NewProduct payment={payment} primary /> : undefined} />
      {items.length ? (
        <ul className={styles.list}>
          {items.map((product, index) => (
            <li key={product.slug} className={styles.row} data-archived={product.archived}>
              <a className={styles.main} href={href("products", { product: product.slug })}>
                {product.cover ? (
                  <img className={styles.cover} src={product.cover} alt="" width={48} height={48} loading="lazy" />
                ) : (
                  <span className={styles.cover} aria-hidden>
                    <Icon name="package" />
                  </span>
                )}
                <span className={styles.text}>
                  <span className={styles.name}>
                    {product.name}
                    {product.archived ? <Badge>Arquivado</Badge> : null}
                  </span>
                  <span className={styles.slug}>/v/{product.slug}</span>
                </span>
                <span className={styles.price}>
                  <Money cents={product.price} />
                </span>
              </a>
              <div className={styles.actions}>
                <Button href={href("products", { product: product.slug })} size="sm">
                  Editar
                </Button>
                <ItemActions
                  kind="product"
                  id={product.slug}
                  first={index === 0}
                  last={index === items.length - 1}
                  archived={product.archived}
                  page={`/v/${product.slug}`}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Nenhum produto ainda"
          description="Crie o primeiro: ele aparece na loja assim que for salvo."
          action={<NewProduct payment={payment} primary />}
        />
      )}
    </>
  );
}
