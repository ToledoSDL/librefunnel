import type { ComponentProps } from "react";
import { Toggle } from "./checkbox";

export function Switch(props: Omit<ComponentProps<typeof Toggle>, "role">) {
  return <Toggle {...props} role="switch" />;
}
