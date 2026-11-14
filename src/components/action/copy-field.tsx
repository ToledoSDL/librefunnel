import { useId } from "react";
import { CopyButton } from "./copy-button";
import { Icon } from "../media/icon";
import styles from "./copy-field.module.css";

export function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const id = useId();

  return (
    <div className={styles.copyField}>
      <label htmlFor={id} className={styles.copyLabel}>
        {label}
      </label>
      <div className={styles.copyRow} data-multiline={multiline}>
        {multiline ? (
          <textarea id={id} className={styles.copyValue} value={value} readOnly rows={3} />
        ) : (
          <input id={id} className={styles.copyValue} value={value} readOnly />
        )}
        <CopyButton value={value} copyIcon={<Icon name="copy" />} copiedIcon={<Icon name="check" />} />
      </div>
    </div>
  );
}
