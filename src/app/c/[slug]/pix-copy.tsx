"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import styles from "./page.module.css";

// The one action of the page: a full-width button, since most buyers pay on the same phone.
export function PixCopy({ code, icons }: { code: string; icons: { copy: ReactNode; copied: ReactNode } }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className={styles.pixCopy}>
      <input
        className={styles.pixCode}
        value={code}
        readOnly
        aria-label="Pix Copia e Cola"
        onFocus={(event) => event.currentTarget.select()}
      />
      <button
        type="button"
        className={styles.buy}
        onClick={() => navigator.clipboard.writeText(code).then(() => setCopied(true))}
      >
        {copied ? icons.copied : icons.copy}
        <span aria-live="polite">{copied ? "Código copiado" : "Copiar código Pix"}</span>
      </button>
    </div>
  );
}
