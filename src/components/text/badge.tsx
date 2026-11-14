import type { ReactNode } from "react";
import styles from "./badge.module.css";

export function Badge({
  tone = "default",
  children,
}: {
  tone?: "default" | "primary" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}
