import { Field } from "@/components/form/field";
import { MoneyInput } from "@/components/form/money-input";
import type { ComponentProps } from "react";

export function MoneyField({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & ComponentProps<typeof MoneyInput>) {
  return (
    <Field label={label} hint={hint}>
      {(control) => <MoneyInput {...control} {...input} />}
    </Field>
  );
}
