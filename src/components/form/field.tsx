import type { ReactNode } from "react";
import { useId } from "react";
import { Icon } from "../media/icon";
import styles from "./field.module.css";

type Control = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (control: Control) => ReactNode;
}) {
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children({ id, "aria-describedby": described || undefined, "aria-invalid": error ? true : undefined })}
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.error}>
          <Icon name="triangle-alert" size={16} />
          {error}
        </p>
      )}
    </div>
  );
}
