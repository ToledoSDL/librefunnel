"use client";

import { useState, useTransition } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Field } from "@/components/form/field";
import inputStyles from "@/components/form/input.module.css";
import type { Code } from "@/lib/actions";
import { checkCoupon } from "@/lib/actions";
import { Money } from "@/app/format";
import { ErrorText, useCoupon } from "@/app/ui";
import styles from "./page.module.css";

export function CouponField({
  slug,
  initial,
  refusedDefault,
}: {
  slug: string;
  initial: string;
  refusedDefault: Code | null;
}) {
  const { refused, discount, setDiscount } = useCoupon();
  const [open, setOpen] = useState(initial !== "");
  const [checked, setChecked] = useState(refusedDefault);
  const [pending, startTransition] = useTransition();
  const error = checked ?? refused;

  function apply(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) {
    const elements = event.currentTarget.closest("form")?.elements;
    const data = new FormData();
    data.set("slug", slug);
    for (const name of ["coupon", "email"]) {
      const input = elements?.namedItem(name);
      if (input instanceof HTMLInputElement) data.set(name, input.value);
    }
    startTransition(async () => {
      const reply = await checkCoupon({ code: null }, data);
      setChecked(reply.code);
      setDiscount(reply.discount ?? 0);
    });
  }

  if (!open) {
    return (
      <button type="button" className={styles.suggestion} onClick={() => setOpen(true)}>
        Tem um cupom de desconto?
      </button>
    );
  }

  return (
    <Field
      label="Cupom de desconto"
      error={error ? <ErrorText code={error} /> : undefined}
      hint={
        discount ? (
          <>
            Cupom aplicado: <Money cents={discount} /> de desconto.
          </>
        ) : undefined
      }
    >
      {(control) => (
        <div className={styles.coupon}>
          <input
            {...control}
            name="coupon"
            className={inputStyles.input}
            defaultValue={initial}
            maxLength={30}
            autoFocus={initial === ""}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={() => {
              setDiscount(0);
              setChecked(null);
            }}
            onKeyDown={(event) => {
              // Enter here applies the coupon instead of placing the order.
              if (event.key !== "Enter") return;
              event.preventDefault();
              apply(event);
            }}
          />
          <button type="button" className={styles.apply} disabled={pending} onClick={apply}>
            {pending ? "Aplicando" : "Aplicar"}
          </button>
        </div>
      )}
    </Field>
  );
}
