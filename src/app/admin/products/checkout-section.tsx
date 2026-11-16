import { Field } from "@/components/form/field";
import { Select } from "@/components/form/select";
import { Section } from "@/components/layout/section";
import type { Product } from "@/lib/catalog/products";
import styles from "../admin.module.css";
import { TextField } from "../shared";
import { MoneyField } from "./money-field";
import { ProductForm } from "./product-form";
import { formatLocalInput } from "@/format";

export function CheckoutSection({ product, others }: { product: Product; others: Product[] }) {
  const bump = product.orderBump;

  return (
    <ProductForm product={product} section="checkout">
      <Section title="Oferta" description="Sem data de fim, vende sem prazo.">
        <div className={styles.grid}>
          <TextField
            label="Fim da oferta"
            hint="Horário de Brasília."
            name="offerEndsAt"
            type="datetime-local"
            defaultValue={product.offerEndsAt ? formatLocalInput(product.offerEndsAt) : ""}
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
      </Section>
      <Section title="Order bump" description="Outro produto oferecido com um clique no checkout.">
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
            hint="Em branco, o preço normal."
            name="bumpPrice"
            defaultCents={bump?.price || undefined}
          />
        </div>
        <TextField
          label="Chamada"
          name="bumpHeadline"
          maxLength={300}
          placeholder="Sim, quero adicionar por apenas R$ 19,90"
          defaultValue={bump?.headline}
        />
      </Section>
    </ProductForm>
  );
}
