import { icons } from "@iconify-json/lucide";
import styles from "./icon.module.css";

export type IconName = string;

function body(name: string): string {
  const icon = icons.icons[name];

  if (icon) return icon.body;

  const parent = icons.aliases?.[name]?.parent;

  if (!parent) throw new Error(`Lucide has no icon named ${name}`);

  return body(parent);
}

// Any Lucide name from https://icon-sets.iconify.design/lucide/
export function Icon({ name, size = 20, label }: { name: IconName; size?: 16 | 20; label?: string }) {
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox={`0 0 ${icons.width} ${icons.height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: body(name) }}
    />
  );
}
