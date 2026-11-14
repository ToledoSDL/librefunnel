import type { ReactNode } from "react";
import { Icon } from "../media/icon";
import styles from "./alert.module.css";

export function Alert({
  tone = "danger",
  title,
  children,
  action,
}: {
  tone?: "warning" | "danger";
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className={styles.alert} data-tone={tone}>
      <Icon name="triangle-alert" />
      <div className={styles.alertText}>
        <strong>{title}</strong>
        {children && <span>{children}</span>}
      </div>
      {action}
    </div>
  );
}
