"use client";

import { useEffect, useState } from "react";

function left(until: number) {
  const seconds = Math.max(0, Math.floor((until - Date.now()) / 1000));
  const days = Math.floor(seconds / 86400);

  const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  return days ? `${days}d ${clock}` : clock;
}

// Counts down to the product's real offer deadline; it never resets per visit.
export function Countdown({ until }: { until: number }) {
  const [text, setText] = useState(() => left(until));

  useEffect(() => {
    const timer = setInterval(() => setText(left(until)), 1000);

    return () => clearInterval(timer);
  }, [until]);

  // Server and phone clocks read a second or two apart; the next tick corrects it without a client re-render.
  return (
    <time dateTime={new Date(until).toISOString()} suppressHydrationWarning>
      {text}
    </time>
  );
}
