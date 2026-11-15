import { Money } from "@/app/format";
import { Button } from "@/components/action/button";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Icon } from "@/components/media/icon";
import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import { createProduct } from "@/lib/actions";
import type { Product } from "@/lib/catalog";
import { href, PRIMARY, TextField } from "../shared";
import { SaveForm } from "../ui";
import { ItemActions } from "./item-actions";
import { MoneyField } from "./money-field";
import { PixFields } from "./pix-fields";
import styles from "./products.module.css";

function NewProduct({ pix, primary }: { pix?: Product["pix"]; primary?: boolean }) {
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
        <SaveForm action={createProduct} label="Criar produto" pendingLabel="Criando produto" button={PRIMARY}>
          <TextField label="Nome do produto" name="name" required maxLength={120} placeholder="Curso de Confeitaria" />
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
          <PixFields pix={pix} />
        </SaveForm>
      }
    />
  );
}

export function ProductList({ items }: { items: Product[] }) {
  return (
    <>
      <PageHeader title="Produtos" actions={items.length ? <NewProduct pix={items[0]?.pix} primary /> : undefined} />
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
          action={<NewProduct primary />}
        />
      )}
    </>
  );
}
