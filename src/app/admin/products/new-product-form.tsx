"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ButtonAttributes } from "@/components/action/button";
import { SubmitButton } from "@/components/action/submit-button";
import { Text } from "@/components/text/text";
import type { Code } from "@/lib/actions";
import { createProduct } from "@/lib/actions";
import { ErrorText } from "@/app/ui";
import styles from "./products.module.css";

const FIRST_STEP: Code[] = ["INVALID_TITLE", "INVALID_SLUG", "INVALID_PRICE", "SLUG_TAKEN"];

// Two steps in one form: what is sold, then where the money lands. Enter on the first step moves on instead of
// submitting, so nobody skips the second.
export function NewProductForm({
  details,
  payment,
  primary,
  ghost,
}: {
  details: ReactNode;
  payment: ReactNode;
  primary: ButtonAttributes;
  ghost: ButtonAttributes;
}) {
  const [state, action] = useActionState(createProduct, { code: null });
  const [step, setStep] = useState(1);
  const first = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    if (state.code && FIRST_STEP.includes(state.code)) setStep(1);
  }, [state]);

  function next() {
    for (const input of first.current?.querySelectorAll("input") ?? []) if (!input.reportValidity()) return;
    setStep(2);
  }

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (step === 2) return;
        event.preventDefault();
        next();
      }}
    >
      <div className={styles.wizard}>
        <ol className={styles.wizardSteps}>
          <li aria-current={step === 1 ? "step" : undefined}>Produto</li>
          <li aria-current={step === 2 ? "step" : undefined}>Recebimento</li>
        </ol>
        <fieldset ref={first} className={styles.wizardPanel} hidden={step !== 1}>
          {details}
        </fieldset>
        <fieldset className={styles.wizardPanel} hidden={step !== 2}>
          {payment}
        </fieldset>
        {state.code ? (
          <Text variant="body-sm" tone="danger">
            <ErrorText code={state.code} />
          </Text>
        ) : null}
        <div className={styles.wizardActions}>
          {step === 1 ? (
            <button type="button" {...primary} onClick={next}>
              Continuar
            </button>
          ) : (
            <>
              <button type="button" {...ghost} onClick={() => setStep(1)}>
                Voltar
              </button>
              <SubmitButton {...primary}>Criar produto</SubmitButton>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
