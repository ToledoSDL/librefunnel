"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import segmentedControlStyles from "../form/segmented-control.module.css";

export type Theme = "system" | "light" | "dark";

export function ThemeMenu({ theme, icons }: { theme: Theme; icons: Record<Theme, ReactNode> }) {
  const [current, setCurrent] = useState(theme);
  const labels = { system: "Sistema", light: "Claro", dark: "Escuro" };

  function choose(next: Theme) {
    setCurrent(next);

    if (next === "system") {
      document.cookie = "lf_theme=; path=/; max-age=0; samesite=lax";
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.cookie = `lf_theme=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.dataset.theme = next;
    }
  }

  return (
    <div role="radiogroup" aria-label="Tema" className={segmentedControlStyles.segmented}>
      {(["system", "light", "dark"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={current === option}
          title={labels[option]}
          className={segmentedControlStyles.segment}
          onClick={() => choose(option)}
        >
          {icons[option]}
          <span className="sr-only">{labels[option]}</span>
        </button>
      ))}
    </div>
  );
}
