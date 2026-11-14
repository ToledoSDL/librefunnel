"use client";

import type { ComponentProps } from "react";
import inputStyles from "@/components/form/input.module.css";

// Typos in the e-mail lose the buyer's access, so the checkout asks for it twice like Hotmart and Kiwify do.
export function ConfirmEmail(props: Omit<ComponentProps<"input">, "type" | "onInput">) {
  return (
    <input
      {...props}
      type="email"
      className={inputStyles.input}
      onInput={(event) => {
        const input = event.currentTarget;
        const email = input.form?.elements.namedItem("email");
        const typed = email instanceof HTMLInputElement ? email.value.trim().toLowerCase() : "";

        input.setCustomValidity(input.value.trim().toLowerCase() === typed ? "" : "Os e-mails não são iguais.");
      }}
    />
  );
}
