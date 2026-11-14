import type { ReactNode } from "react";
import pageHeaderStyles from "./page-header.module.css";
import styles from "./card.module.css";

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.card}>
      {(title || actions) && (
        <header className={styles.cardHeader}>
          {title && <h2 className={styles.cardTitle}>{title}</h2>}
          {actions && <div className={pageHeaderStyles.actions}>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
