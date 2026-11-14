import styles from "./avatar.module.css";

export function Avatar({ name, src, size = "md" }: { name: string; src?: string; size?: "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .filter((part) => /\p{L}/u.test(part))
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <span className={styles.avatar} data-size={size} aria-hidden>
      {src ? <img src={src} alt="" loading="lazy" /> : initials}
    </span>
  );
}
