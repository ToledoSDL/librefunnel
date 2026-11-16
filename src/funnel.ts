// The whole funnel in one place, read by the server and by the browser tags. Each step a buyer can reach in the browser
// is a first-party event (counted in the panel) and, when it means something to ad platforms, the event name Meta and
// TikTok share (ads) and the Google Analytics one. Integrating a platform is a change here and in tracking/conversions.
export const STEPS = {
  page_view: { ads: "ViewContent", analytics: "view_item" },
  store_click: {},
  video_play: {},
  video_unmute: {},
  video_25: {},
  video_50: {},
  video_75: {},
  video_100: {},
  cta_view: {},
  cta_click: {},
  checkout_view: { ads: "InitiateCheckout", analytics: "begin_checkout" },
  checkout_start: {},
  bump_add: {},
  pix_view: {},
  pix_copy: {},
} as const satisfies Record<string, { ads?: "ViewContent" | "InitiateCheckout"; analytics?: string }>;

// Order steps happen on the server, which sends each to the platforms listed. A platform's browser tag sends the same
// event with the same id (Google Analytics: the same transaction), so it counts once. Google Ads takes only the sale,
// and Google Analytics only the sale and the refund: it has no deduplication for the other steps.
export const ORDER_STEPS = {
  created: { name: "AddPaymentInfo", analytics: "add_payment_info", platforms: ["meta", "tiktok"] },
  paid: { name: "Purchase", analytics: "purchase", platforms: ["meta", "tiktok", "analytics", "googleads"] },
  refunded: { name: "Refund", analytics: "refund", platforms: ["analytics"] },
} as const;

export type ClientEvent = keyof typeof STEPS;

export type OrderStep = keyof typeof ORDER_STEPS;

export function orderEventId(orderId: string, step: OrderStep): string {
  return `${orderId}:${ORDER_STEPS[step].name}`;
}
