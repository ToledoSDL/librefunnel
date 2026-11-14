import type { ReactNode } from "react";
import { Text } from "@/components/text/text";
import styles from "./automations.module.css";

export function AutomationRow({
  lead,
  title,
  text,
  actions,
}: {
  lead?: ReactNode;
  title: ReactNode;
  text: string;
  actions: ReactNode;
}) {
  return (
    <li className={styles.row}>
      {lead ? <div className={styles.lead}>{lead}</div> : null}
      <div className={styles.info}>
        {title}
        <div className={styles.preview}>
          <Text as="span" variant="body-sm" tone="muted">
            {text.replace(/\s+/g, " ")}
          </Text>
        </div>
      </div>
      <div className={styles.actions}>{actions}</div>
    </li>
  );
}
