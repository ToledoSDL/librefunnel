import type { ReactNode } from "react";
import fieldStyles from "./field.module.css";
import styles from "./setting-row.module.css";

export function SettingRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.setting}>
      <div className={styles.settingText}>
        <span className={styles.settingTitle}>{title}</span>
        {description && <span className={fieldStyles.hint}>{description}</span>}
      </div>
      <div className={styles.settingControl}>{children}</div>
    </div>
  );
}
