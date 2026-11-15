import { paymentWebhook } from "@/lib/orders/webhooks";

export async function POST(request: Request) {
  return paymentWebhook(request);
}
