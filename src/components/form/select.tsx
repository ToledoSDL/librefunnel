"use client";

import {
  Select as AriakitSelect,
  SelectArrow,
  SelectItem,
  SelectItemCheck,
  SelectPopover,
  SelectProvider,
  SelectValue,
} from "@ariakit/react";
import inputStyles from "./input.module.css";
import styles from "./select.module.css";

type Option = { value: string; label: string };

// Ariakit renders a hidden native select with `name`, so the value still posts with the form.
export function Select({
  options,
  name,
  defaultValue,
  required,
  id,
  "aria-label": label,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: {
  options: Option[];
  name?: string;
  defaultValue?: string;
  required?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  return (
    <SelectProvider defaultValue={defaultValue ?? options[0]?.value ?? ""}>
      <AriakitSelect
        id={id}
        name={name}
        required={required}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className={`${inputStyles.input} ${styles.trigger}`}
      >
        <span className={styles.value}>
          <SelectValue>{(value) => options.find((option) => option.value === value)?.label ?? ""}</SelectValue>
        </span>
        <SelectArrow className={styles.arrow} />
      </AriakitSelect>
      <SelectPopover gutter={4} sameWidth className={styles.popover}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className={styles.item}>
            <span>{option.label}</span>
            <SelectItemCheck className={styles.check} />
          </SelectItem>
        ))}
      </SelectPopover>
    </SelectProvider>
  );
}
