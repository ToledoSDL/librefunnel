import type { ReactNode } from "react";
import styles from "./text.module.css";

const TAGS = {
  display: "h1",
  heading: "h2",
  metric: "p",
  body: "p",
  "body-sm": "p",
  caption: "span",
} as const;

export type Tone = "default" | "muted" | "primary" | "success" | "warning" | "danger";

type Variant = "display" | "heading" | "metric" | "body" | "body-sm" | "caption";

export function Text({
  variant = "body",
  tone = "default",
  as,
  weight,
  mono,
  children,
}: {
  variant?: Variant;
  tone?: Tone;
  as?: "p" | "span" | "div" | "h1" | "h2" | "h3" | "strong" | "time";
  weight?: "regular" | "semibold" | "bold";
  mono?: boolean;
  children: ReactNode;
}) {
  const Tag = as ?? TAGS[variant];

  return (
    <Tag className={styles.text} data-variant={variant} data-tone={tone} data-weight={weight} data-mono={mono}>
      {children}
    </Tag>
  );
}
