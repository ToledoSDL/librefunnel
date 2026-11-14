import type { ReactNode } from "react";
import type { Space } from "./stack";
import styles from "./row.module.css";

export function Row({
  gap = 3,
  justify = "start",
  align = "center",
  wrap = true,
  children,
}: {
  gap?: Space;
  justify?: "start" | "between" | "end";
  align?: "start" | "center" | "baseline" | "end";
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.row}
      data-justify={justify}
      data-align={align}
      data-wrap={wrap}
      style={{ gap: `var(--space-${gap})` }}
    >
      {children}
    </div>
  );
}
