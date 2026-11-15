import type { ReactNode } from "react";
import { Icon } from "../media/icon";
import styles from "./disclosure.module.css";

export function Disclosure({ label, open, children }: { label: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className={styles.disclosure} open={open}>
      <summary className={styles.summary}>
        <span className={styles.chevron} aria-hidden>
          <Icon name="chevron-right" size={16} />
        </span>
        <span className={styles.label}>{label}</span>
      </summary>
      <div className={styles.disclosurePanel}>{children}</div>
    </details>
  );
}
