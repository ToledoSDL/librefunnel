"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ErrorText } from "@/app/ui";
import type { ButtonAttributes } from "@/components/action/button";
import { SubmitButton } from "@/components/action/submit-button";
import { Text } from "@/components/text/text";
import { sendReply } from "@/lib/actions/messages";
import styles from "./messages.module.css";

export function Composer({
  address,
  recipient,
  button,
  sendIcon,
}: {
  address: string;
  recipient: string;
  button: ButtonAttributes;
  sendIcon: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(sendReply, { code: null });
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form
      ref={form}
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();

        const fields = new FormData(event.currentTarget);

        startTransition(() => dispatch(fields));
      }}
    >
      <input type="hidden" name="address" value={address} />
      <div className={styles.composerRow}>
        <textarea
          className={styles.composerInput}
          name="text"
          rows={1}
          required
          maxLength={2000}
          placeholder="Escreva uma resposta"
          aria-label={`Mensagem para ${recipient}`}
          readOnly={pending}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
        <SubmitButton {...button} busy={pending}>
          {pending ? null : sendIcon}
          <span className="sr-only">{pending ? "Enviando" : "Enviar"}</span>
        </SubmitButton>
      </div>
      <div aria-live="polite">
        {state.code ? (
          <Text variant="caption" tone="danger">
            <ErrorText code={state.code} />
          </Text>
        ) : state.ok ? (
          <Text variant="caption" tone="muted">
            Na fila de envio.
          </Text>
        ) : null}
      </div>
    </form>
  );
}
