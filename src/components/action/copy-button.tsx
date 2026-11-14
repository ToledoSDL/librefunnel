"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import buttonStyles from "./button.module.css";

export function CopyButton({
  value,
  copyIcon,
  copiedIcon,
}: {
  value: string;
  copyIcon: ReactNode;
  copiedIcon: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), 2000);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={buttonStyles.button}
      data-variant={copied ? "soft" : "solid"}
      data-tone="primary"
      onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true))}
    >
      {copied ? copiedIcon : copyIcon}
      <span aria-live="polite">{copied ? "Copiado" : "Copiar"}</span>
    </button>
  );
}
