import styles from "./products.module.css";

export function RowSummary({ title, text }: { title: string; text: string }) {
  return (
    <>
      {title}
      <span className={styles.excerpt}>{text.replace(/\s+/g, " ")}</span>
    </>
  );
}
