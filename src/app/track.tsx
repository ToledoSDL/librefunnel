"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import type { ClientEvent } from "@/lib/tracking/funnel";

export type TrackEvent = ClientEvent;

export const QUARTILES: [number, TrackEvent][] = [
  [0.25, "video_25"],
  [0.5, "video_50"],
  [0.75, "video_75"],
  [0.98, "video_100"],
];

export function track(event: TrackEvent, product: string) {
  const body = JSON.stringify({ e: event, p: product, q: location.search, r: document.referrer, l: location.pathname });
  if (navigator.sendBeacon("/t", new Blob([body], { type: "application/json" }))) return;
  fetch("/t", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(
    () => undefined,
  );
}

export function Tracker({ product, event = "page_view" }: { product: string; event?: TrackEvent }) {
  useEffect(() => {
    track(event, product);
  }, [event, product]);
  return null;
}

// Counts a click on any link or button inside, and a copy of any text inside.
export function TrackClick({ event, product, children }: { event: TrackEvent; product: string; children: ReactNode }) {
  return (
    <div
      onClick={(click) => {
        if (click.target instanceof Element && click.target.closest("a, button")) track(event, product);
      }}
      onCopy={() => track(event, product)}
    >
      {children}
    </div>
  );
}
