import type { ReactNode } from "react";
import { Icon } from "../media/icon";
import { Badge } from "../text/badge";
import { Text } from "../text/text";
import styles from "./checklist-step.module.css";

export type ChecklistStepItem = {
  id: string;
  title: string;
  level: "required" | "recommended" | "optional";
  done: boolean;
  status?: ReactNode;
  why: ReactNode;
  children: ReactNode;
};

const LEVEL = { recommended: "Recomendado", optional: "Opcional" };

// Steps sharing a details name form an exclusive accordion: opening one closes the open one, with no client code.
export function ChecklistStep({
  step,
  number,
  group,
  current,
}: {
  step: ChecklistStepItem;
  number?: number;
  group: string;
  current: boolean;
}) {
  return (
    <li className={styles.step} data-done={step.done} data-current={current}>
      <details name={group} open={current}>
        <summary className={styles.summary}>
          <span className={styles.mark}>{step.done ? <Icon name="check" size={16} /> : number}</span>
          <span className={styles.title}>
            {step.title}
            {step.level === "required" ? null : <Badge>{LEVEL[step.level]}</Badge>}
          </span>
          {step.done ? (
            <span className={styles.status}>
              <span className="sr-only">Concluído. </span>
              {step.status}
            </span>
          ) : null}
          <span className={styles.chevron}>
            <Icon name="chevron-down" size={16} />
          </span>
        </summary>
        <div className={styles.panel}>
          <Text variant="body-sm" tone="muted">
            {step.why}
          </Text>
          {step.children}
        </div>
      </details>
    </li>
  );
}
