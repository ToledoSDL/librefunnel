import { LUCIDE } from "./icon-set";
import styles from "./icon.module.css";

export type IconName = keyof typeof LUCIDE;

// A Lucide icon (https://icon-sets.iconify.design/lucide/) listed in docs/icons.ts.
export function Icon({ name, size = 20, label }: { name: IconName; size?: 16 | 20; label?: string }) {
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: LUCIDE[name] }}
    />
  );
}
