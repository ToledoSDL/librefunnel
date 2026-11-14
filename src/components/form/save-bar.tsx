"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import buttonStyles from "../action/button.module.css";
import { SubmitButton } from "../action/submit-button";
import styles from "./save-bar.module.css";

export function SaveBar({ busy }: { busy?: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const status = useFormStatus();
  const pending = busy ?? status.pending;
  const wasPending = useRef(false);

  useEffect(() => {
    const owner = bar.current?.closest("form");

    if (!owner) return;

    const mark = () => setDirty(true);
    const clear = () => setDirty(false);

    owner.addEventListener("input", mark);
    owner.addEventListener("reset", clear);

    return () => {
      owner.removeEventListener("input", mark);
      owner.removeEventListener("reset", clear);
    };
  }, []);

  useEffect(() => {
    if (wasPending.current && !pending) setDirty(false);
    wasPending.current = pending;
  }, [pending]);

  return (
    <div ref={bar} className={styles.saveBar} hidden={!dirty} role="region" aria-label="Alterações não salvas">
      <span className={styles.label}>Alterações não salvas</span>
      <div className={styles.actions}>
        <button type="reset" className={buttonStyles.button} data-variant="ghost" data-tone="neutral" data-size="sm">
          Descartar
        </button>
        <SubmitButton
          busy={busy}
          className={buttonStyles.button}
          data-variant="solid"
          data-tone="primary"
          data-size="sm"
        >
          Salvar alterações
        </SubmitButton>
      </div>
    </div>
  );
}
