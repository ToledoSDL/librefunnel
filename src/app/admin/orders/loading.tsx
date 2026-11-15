import { PageHeader } from "@/components/layout/page-header";
import { Stack } from "@/components/layout/stack";
import styles from "./orders.module.css";

const ROWS = Array.from({ length: 10 }, (_, index) => index);

export default function Loading() {
  return (
    <Stack gap={5}>
      <PageHeader title="Pedidos" />
      <div className={styles.skeleton} role="status" aria-label="Carregando pedidos">
        {ROWS.map((row) => (
          <div key={row} className={styles.skeletonRow}>
            <span className={styles.bar} />
            <span className={styles.bar} />
            <span className={styles.bar} />
            <span className={styles.bar} />
          </div>
        ))}
      </div>
    </Stack>
  );
}
