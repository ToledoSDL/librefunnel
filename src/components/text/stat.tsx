import type { ReactNode } from "react";
import styles from "./stat.module.css";

export function Stat({
  label,
  value,
  note,
  lead,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  lead?: boolean;
}) {
  return (
    <dl className={styles.stat} data-lead={lead}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
      {note && <dd className={styles.statNote}>{note}</dd>}
    </dl>
  );
}
