import { Section } from "@/components/layout/section";
import type { Product } from "@/lib/catalog";
import styles from "../admin.module.css";
import { TextField } from "../shared";
import { MoneyField } from "./money-field";
import { ProductForm } from "./product-form";

export function GeneralSection({ product }: { product: Product }) {
  return (
    <ProductForm product={product} section="general">
      <Section title="Produto" description="O novo preço vale para os próximos pedidos.">
        <div className={styles.grid}>
          <TextField label="Nome" name="name" required maxLength={120} defaultValue={product.name} />
          <MoneyField label="Preço" name="price" required defaultCents={product.price} />
        </div>
        <TextField label="Frase de apresentação" name="tagline" maxLength={300} defaultValue={product.tagline} />
      </Section>
    </ProductForm>
  );
}
