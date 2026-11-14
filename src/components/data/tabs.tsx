import styles from "./tabs.module.css";

export function Tabs({
  label,
  items,
}: {
  label: string;
  items: { label: string; href: string; current?: boolean; count?: number }[];
}) {
  return (
    <nav aria-label={label} className={styles.tabs}>
      {items.map((item) => (
        <a key={item.href} href={item.href} className={styles.tab} aria-current={item.current ? "page" : undefined}>
          {item.label}
          {item.count !== undefined && item.count > 0 && <span className={styles.tabCount}>{item.count}</span>}
        </a>
      ))}
    </nav>
  );
}
