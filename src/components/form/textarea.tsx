import type { ComponentProps } from "react";
import inputStyles from "./input.module.css";

export function Textarea(props: Omit<ComponentProps<"textarea">, "className" | "style">) {
  return <textarea rows={4} {...props} className={inputStyles.input} />;
}
