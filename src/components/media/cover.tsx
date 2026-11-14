import { Progress } from "../feedback/progress";
import styles from "./cover.module.css";

export function Cover({
  title,
  src,
  caption,
  progress,
  href,
}: {
  title: string;
  src?: string;
  caption?: string;
  progress?: number;
  href?: string;
}) {
  const content = (
    <>
      {src ? <img src={src} alt="" className={styles.image} /> : <span className={styles.fallback} />}
      <span className={styles.label}>
        <strong>{title}</strong>
        {caption && <span className={styles.caption}>{caption}</span>}
        {progress !== undefined && <Progress value={progress} label={`Progresso em ${title}`} />}
      </span>
    </>
  );

  return href ? (
    <a href={href} className={styles.cover}>
      {content}
    </a>
  ) : (
    <div className={styles.cover}>{content}</div>
  );
}
