import { paymentWebhook } from "@/lib/orders";

export async function POST(request: Request) {
  return paymentWebhook(request);
}
