import { botWebhook } from "@/lib/messages";

export async function POST(request: Request) {
  return botWebhook(request);
}
