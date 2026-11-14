import styles from "./segmented-control.module.css";

type Segment = { value: string; label: string; count?: number };

export function SegmentedControl({
  label,
  options,
  value,
  href,
  name,
}: {
  label: string;
  options: Segment[];
  value: string;
} & ({ href: (value: string) => string; name?: never } | { name: string; href?: never })) {
  const content = (option: Segment) => (
    <>
      {option.label}
      {option.count !== undefined && <span className={styles.count}>{option.count}</span>}
    </>
  );

  if (href) {
    return (
      <nav aria-label={label} className={styles.segmented}>
        {options.map((option) => (
          <a
            key={option.value}
            href={href(option.value)}
            className={styles.segment}
            aria-current={option.value === value ? "page" : undefined}
          >
            {content(option)}
          </a>
        ))}
      </nav>
    );
  }

  return (
    <fieldset className={styles.segmented}>
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className={styles.segment}>
          <input type="radio" name={name} value={option.value} defaultChecked={option.value === value} />
          {content(option)}
        </label>
      ))}
    </fieldset>
  );
}
