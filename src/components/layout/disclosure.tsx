import type { ReactNode } from "react";
import styles from "./disclosure.module.css";

export function Disclosure({ label, open, children }: { label: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className={styles.disclosure} open={open}>
      <summary className={styles.summary}>{label}</summary>
      <div className={styles.disclosurePanel}>{children}</div>
    </details>
  );
}
