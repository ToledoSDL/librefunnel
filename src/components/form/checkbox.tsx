"use client";

import { Checkbox as AriakitCheckbox } from "@ariakit/react";
import type { ReactNode } from "react";
import styles from "./checkbox.module.css";
import fieldStyles from "./field.module.css";
import type { InputProps } from "./input";

export function Toggle({
  label,
  description,
  role,
  ...props
}: Omit<InputProps, "type" | "value"> & {
  value?: string;
  label: ReactNode;
  description?: ReactNode;
  role?: "switch";
}) {
  return (
    <label className={styles.toggle}>
      <AriakitCheckbox {...props} role={role} className={role ? styles.switch : styles.checkbox} />
      <span className={styles.toggleText}>
        <span>{label}</span>
        {description && <span className={fieldStyles.hint}>{description}</span>}
      </span>
    </label>
  );
}
