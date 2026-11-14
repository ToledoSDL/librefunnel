import type { ReactNode } from "react";
import styles from "./empty-state.module.css";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <strong className={styles.emptyTitle}>{title}</strong>
      {description && <p className={styles.emptyText}>{description}</p>}
      {action}
    </div>
  );
}
