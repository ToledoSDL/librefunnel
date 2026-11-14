import type { ReactNode } from "react";
import styles from "./stack.module.css";

export type Space = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export function Stack({ gap = 4, children }: { gap?: Space; children: ReactNode }) {
  return (
    <div className={styles.stack} style={{ gap: `var(--space-${gap})` }}>
      {children}
    </div>
  );
}
