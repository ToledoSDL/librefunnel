"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { ORDER_STEPS, STEPS, orderEventId } from "@/funnel";
import type { ClientEvent, OrderStep } from "@/funnel";

export type TrackEvent = ClientEvent;

// Set by the tags the seller turned on (src/app/tags.tsx); absent otherwise, so every call is optional.
declare global {
  interface Window {
    fbq?: (command: "track", event: string, params: object, options: { eventID: string }) => void;
    ttq?: { track: (event: string, params: object, options: { event_id: string }) => void };
    gtag?: (command: "event", event: string, params: object) => void;
  }
}

export const QUARTILES: [number, TrackEvent][] = [
  [0.25, "video_25"],
  [0.5, "video_50"],
  [0.75, "video_75"],
  [0.98, "video_100"],
];

// items: the product slugs, the order bump after the main product.
type Offer = { items: string[]; value: number };

// The browser tags get the same event id as the server's event, so each platform counts the step once.
function tag(ads: string | undefined, analytics: string | undefined, id: string, offer: Offer, order?: string) {
  const value = offer.value / 100;
  const params = { currency: "BRL", value, content_ids: offer.items, content_type: "product" };
  if (ads) window.fbq?.("track", ads, params, { eventID: id });

  if (ads)
    window.ttq?.track(
      ads,
      {
        currency: "BRL",
        value,
        content_type: "product",
        contents: offer.items.map((item) => ({ content_id: item, quantity: 1 })),
      },
      { event_id: id },
    );

  if (analytics)
    window.gtag?.("event", analytics, {
      currency: "BRL",
      value,
      items: offer.items.map((item) => ({ item_id: item, quantity: 1 })),
      ...(order ? { transaction_id: order } : {}),
    });
}

export function track(event: TrackEvent, product: string, value = 0) {
  const step: { ads?: string; analytics?: string } = STEPS[event];
  const id = crypto.randomUUID();
  if (product) tag(step.ads, step.analytics, id, { items: [product], value });

  const body = JSON.stringify({
    e: event,
    p: product,
    q: location.search,
    r: document.referrer,
    l: location.pathname,
    i: id,
  });

  if (navigator.sendBeacon("/t", new Blob([body], { type: "application/json" }))) return;
  fetch("/t", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(
    () => undefined,
  );
}

export function Tracker({
  product,
  event = "page_view",
  value,
}: {
  product: string;
  event?: TrackEvent;
  value?: number;
}) {
  useEffect(() => {
    track(event, product, value);
  }, [event, product, value]);
  return null;
}

// The order steps the server already sends, repeated by the browser tags with the same id so they count once.
// The Pix page refreshes itself while pending, which hands a new items array each time: the key keeps it one event.
export function OrderTracker({ step, order, items, value }: { step: OrderStep; order: string } & Offer) {
  const slugs = items.join(" ");

  useEffect(() => {
    const offer = { items: slugs.split(" "), value };
    tag(ORDER_STEPS[step].name, ORDER_STEPS[step].analytics, orderEventId(order, step), offer, order);
  }, [step, order, slugs, value]);
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
