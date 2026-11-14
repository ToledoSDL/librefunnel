import type { ComponentProps } from "react";
import styles from "./input.module.css";

export type InputProps = Omit<ComponentProps<"input">, "className" | "style" | "size">;

export function Input(props: InputProps) {
  return <input {...props} className={styles.input} />;
}
