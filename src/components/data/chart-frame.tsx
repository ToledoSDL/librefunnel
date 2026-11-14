"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import styles from "./chart-frame.module.css";

export function ChartFrame({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; left: number; top: number }>();

  function point(target: EventTarget) {
    const bar = target instanceof Element ? target.closest("[data-tip]") : null;
    const box = frame.current?.getBoundingClientRect();

    if (!bar || !box) return setTip(undefined);

    const rect = bar.getBoundingClientRect();

    setTip({
      text: bar.getAttribute("data-tip") ?? "",
      left: rect.left + rect.width / 2 - box.left,
      top: rect.top - box.top,
    });
  }

  return (
    <div
      ref={frame}
      className={styles.chartFrame}
      onPointerOver={(event) => point(event.target)}
      onPointerLeave={() => setTip(undefined)}
      onFocus={(event) => point(event.target)}
      onBlur={() => setTip(undefined)}
    >
      {children}
      {tip && (
        <span className={styles.chartTip} style={{ left: tip.left, top: tip.top }} aria-hidden>
          {tip.text}
        </span>
      )}
    </div>
  );
}
