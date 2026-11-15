"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

const UNITS = [
  ["dias", 86_400],
  ["horas", 3_600],
  ["min", 60],
  ["seg", 1],
] as const;

function parts(seconds: number) {
  let rest = seconds;

  return UNITS.map(([label, size]) => {
    const value = Math.floor(rest / size);
    rest -= value * size;
    return { label, value };
  }).filter((part, index) => index > 0 || part.value > 0);
}

// Counts down to the product's real offer deadline; at zero the page reloads and the server shows the offer as closed.
// The server sends the seconds left, so the bar paints at its final size instead of growing after hydration.
export function Countdown({ endsAt, seconds }: { endsAt: string; seconds: number }) {
  const end = Date.parse(endsAt);
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    let previous = 0;

    // Reloads only on the transition to zero, so a phone with a wrong clock never loops.
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(seconds);
      if (seconds === 0 && previous > 0) location.reload();
      previous = seconds;
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [end]);

  return (
    <span className={styles.countdown} role="timer" aria-label="Tempo até o fim da oferta">
      {parts(left).map((part) => (
        <span key={part.label} className={styles.unit}>
          <strong>{String(part.value).padStart(2, "0")}</strong>
          <small>{part.label}</small>
        </span>
      ))}
    </span>
  );
}
