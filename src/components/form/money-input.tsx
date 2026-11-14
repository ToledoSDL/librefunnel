import type { InputProps } from "./input";
import inputStyles from "./input.module.css";
import styles from "./money-input.module.css";

export function MoneyInput({
  defaultCents,
  ...props
}: Omit<InputProps, "type" | "defaultValue"> & { defaultCents?: number }) {
  return (
    <div className={styles.affix}>
      <span className={styles.prefix} aria-hidden>
        R$
      </span>
      <input
        {...props}
        className={`${inputStyles.input} ${styles.amount}`}
        inputMode="decimal"
        autoComplete="off"
        defaultValue={
          defaultCents === undefined
            ? undefined
            : (defaultCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })
        }
      />
    </div>
  );
}
