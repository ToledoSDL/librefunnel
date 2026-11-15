"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import inputStyles from "@/components/form/input.module.css";
import styles from "./page.module.css";

const DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
];

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1)
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length] ?? 0;
}

// gmial.com or hotmal.com would send the access link nowhere, so a near miss of a common domain is offered fixed.
function corrected(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  const domain = email.slice(at + 1).toLowerCase();
  if (at < 1 || domain.length < 4 || DOMAINS.includes(domain)) return undefined;
  const closest = DOMAINS.map((known) => ({ known, cost: distance(domain, known) })).sort((a, b) => a.cost - b.cost)[0];
  return closest && closest.cost <= 2 ? `${email.slice(0, at)}@${closest.known}` : undefined;
}

export function EmailInput(props: Omit<ComponentProps<"input">, "type" | "onBlur">) {
  const [suggestion, setSuggestion] = useState<string>();

  return (
    <>
      <input
        {...props}
        type="email"
        className={inputStyles.input}
        onBlur={(event) => setSuggestion(corrected(event.currentTarget.value.trim()))}
      />
      {suggestion ? (
        <button
          type="button"
          className={styles.suggestion}
          onClick={(event) => {
            const elements = event.currentTarget.form?.elements;
            for (const name of ["email", "emailConfirm"]) {
              const input = elements?.namedItem(name);
              if (!(input instanceof HTMLInputElement) || (name === "emailConfirm" && !input.value)) continue;
              input.value = suggestion;
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
            setSuggestion(undefined);
          }}
        >
          Você quis dizer <strong>{suggestion}</strong>?
        </button>
      ) : null}
    </>
  );
}
