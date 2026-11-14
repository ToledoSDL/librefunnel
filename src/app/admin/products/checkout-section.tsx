import { Field } from "@/components/form/field";
import { Select } from "@/components/form/select";
import { Card } from "@/components/layout/card";
import { Text } from "@/components/text/text";
import type { Product } from "@/lib/catalog";
import styles from "../admin.module.css";
import { TextField } from "../shared";
import { MoneyField } from "./money-field";
import { ProductForm } from "./product-form";

function localInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CheckoutSection({ product, others }: { product: Product; others: Product[] }) {
  const bump = product.orderBump;

  return (
    <ProductForm product={product} section="checkout">
      <Card title="Oferta e garantia">
        <div className={styles.grid}>
          <TextField
            label="Fim da oferta"
            hint="Horário de Brasília. Em branco, vende sem prazo."
            name="offerEndsAt"
            type="datetime-local"
            defaultValue={product.offerEndsAt ? localInput(product.offerEndsAt) : ""}
          />
          <TextField
            label="Garantia (dias)"
            hint="De 7 a 365 dias."
            name="guaranteeDays"
            type="number"
            min={7}
            max={365}
            required
            defaultValue={product.guaranteeDays}
          />
        </div>
      </Card>
      <Card title="Order bump">
        <Text variant="body-sm" tone="muted">
          Outro produto oferecido com um clique no checkout, por um preço especial.
        </Text>
        <div className={styles.grid}>
          <Field label="Produto oferecido">
            {(control) => (
              <Select
                {...control}
                name="bumpProduct"
                defaultValue={bump?.product ?? ""}
                options={[
                  { value: "", label: "Sem order bump" },
                  ...others.map((other) => ({ value: other.slug, label: other.name })),
                ]}
              />
            )}
          </Field>
          <MoneyField
            label="Preço no bump"
            hint="Em branco usa o preço normal do produto."
            name="bumpPrice"
            defaultCents={bump?.price || undefined}
          />
        </div>
        <TextField
          label="Chamada do bump"
          name="bumpHeadline"
          maxLength={300}
          placeholder="Sim, quero adicionar por apenas R$ 19,90"
          defaultValue={bump?.headline}
        />
      </Card>
    </ProductForm>
  );
}
