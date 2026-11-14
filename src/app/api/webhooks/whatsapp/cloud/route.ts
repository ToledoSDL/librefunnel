import { cloudVerify, cloudWebhook } from "@/lib/messages";

export function GET(request: Request) {
  return cloudVerify(request);
}

export async function POST(request: Request) {
  return cloudWebhook(request);
}
