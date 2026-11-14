import { Card } from "@/components/layout/card";
import type { Product } from "@/lib/catalog";
import styles from "../admin.module.css";
import { TextField } from "../shared";
import { MoneyField } from "./money-field";
import { PixFields } from "./pix-fields";
import { ProductForm } from "./product-form";

export function GeneralSection({ product }: { product: Product }) {
  return (
    <ProductForm product={product} section="general">
      <Card title="Produto">
        <div className={styles.grid}>
          <TextField label="Nome do produto" name="name" required maxLength={120} defaultValue={product.name} />
          <MoneyField
            label="Preço"
            hint="Muda só para pedidos novos."
            name="price"
            required
            defaultCents={product.price}
          />
        </div>
        <TextField
          label="Frase de apresentação"
          hint="Aparece embaixo do nome na página de vendas e na loja."
          name="tagline"
          maxLength={300}
          defaultValue={product.tagline}
        />
      </Card>
      <Card title="Pix">
        <PixFields pix={product.pix} />
      </Card>
    </ProductForm>
  );
}
