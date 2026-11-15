import { Toggle } from "@/components/form/checkbox";
import { Field } from "@/components/form/field";
import { Select } from "@/components/form/select";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/text/text";
import { saveCoupon } from "@/lib/actions";
import type { Coupon } from "@/lib/coupons";
import styles from "../admin.module.css";
import { PRIMARY, TextField } from "../shared";
import { SaveForm } from "../ui";
import { formatDecimal, formatLocalInput } from "@/format";

export function CouponForm({ coupon, products }: { coupon?: Coupon; products: { slug: string; name: string }[] }) {
  const value = coupon ? (coupon.kind === "percent" ? String(coupon.value) : formatDecimal(coupon.value, ",")) : "";

  return (
    <SaveForm
      action={saveCoupon}
      label={coupon ? "Salvar cupom" : "Criar cupom"}
      pendingLabel={coupon ? "Salvando" : "Criando"}
      done={coupon ? "Cupom salvo." : "Cupom criado."}
      reset={!coupon}
      button={PRIMARY}
    >
      {coupon ? (
        <>
          <input type="hidden" name="code" value={coupon.code} />
          <input type="hidden" name="editing" value="1" />
        </>
      ) : (
        <TextField
          label="Código"
          hint="O comprador digita no checkout, ou o link leva pronto com ?coupon=CÓDIGO."
          name="code"
          required
          maxLength={30}
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="PROMO10"
        />
      )}
      <div className={styles.grid}>
        <Field label="Tipo de desconto">
          {(control) => (
            <Select
              {...control}
              name="kind"
              defaultValue={coupon?.kind ?? "percent"}
              options={[
                { value: "percent", label: "Porcentagem" },
                { value: "fixed", label: "Valor em reais" },
              ]}
            />
          )}
        </Field>
        <TextField
          label="Desconto"
          hint="10 para 10%, ou 20,00 para R$ 20,00."
          name="value"
          required
          inputMode="decimal"
          defaultValue={value}
        />
        <TextField
          label="Vence em"
          hint="Horário de Brasília. Em branco, não vence."
          name="expiresAt"
          type="datetime-local"
          defaultValue={coupon?.expiresAt ? formatLocalInput(coupon.expiresAt) : ""}
        />
        <TextField
          label="Limite de usos"
          hint="Conta só vendas pagas. Em branco, sem limite."
          name="maxUses"
          type="number"
          min={1}
          defaultValue={coupon?.maxUses ?? ""}
        />
      </div>
      <Toggle
        name="oncePerEmail"
        value="1"
        defaultChecked={coupon?.oncePerEmail ?? true}
        label="Uma vez por e-mail"
        description="Quem já comprou com o cupom não usa de novo, nem depois de um reembolso."
      />
      {products.length ? (
        <Stack gap={2}>
          <Text variant="body-sm" weight="semibold">
            Vale para
          </Text>
          <Text variant="body-sm" tone="muted">
            Sem nenhum marcado, vale para todos os produtos. O desconto é só no produto principal, não no order bump.
          </Text>
          {products.map((product) => (
            <Toggle
              key={product.slug}
              name="products"
              value={product.slug}
              defaultChecked={coupon?.products.includes(product.slug)}
              label={product.name}
            />
          ))}
        </Stack>
      ) : null}
    </SaveForm>
  );
}
