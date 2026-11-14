"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import styles from "./submit-button.module.css";

export function SubmitButton({
  children,
  busy,
  ...attributes
}: Omit<ComponentProps<"button">, "type"> & { busy?: boolean }) {
  const status = useFormStatus();
  const pending = busy ?? status.pending;

  return (
    <button {...attributes} type="submit" disabled={pending} aria-busy={pending || undefined}>
      {pending && <span className={styles.spinner} aria-hidden />}
      {children}
    </button>
  );
}
