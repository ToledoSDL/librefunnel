"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

export type TrackEvent =
  "page_view" | "video_play" | "video_25" | "video_50" | "video_75" | "video_100" | "cta_view" | "cta_click";

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

export function Tracker({ product }: { product: string }) {
  useEffect(() => {
    track("page_view", product);
  }, [product]);
  return null;
}

export function TrackCta({ product, children }: { product: string; children: ReactNode }) {
  return <div onClick={() => track("cta_click", product)}>{children}</div>;
}
