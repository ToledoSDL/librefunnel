import { createHmac } from "node:crypto";
import { adminSignIn, createOrder } from "@/lib/actions";
import { POST as paymentWebhook } from "@/app/api/webhooks/payment/route";
import { form, freshBrowser, redirected, WEBHOOK_SECRET } from "./fakes";

export async function buy(fields: Record<string, string> = {}): Promise<string> {
  const base = {
    slug: "metodo-demo",
    name: "Ana Souza",
    email: "ana@example.com",
    phone: "(48) 99999-0000",
    touch: "",
  };

  const to = await redirected(createOrder({ code: null }, form({ ...base, ...fields })));
  return new URL(to, "https://shop.example").searchParams.get("order") ?? "";
}

export function webhook(body: object | string, signature?: string): Promise<Response> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const sig = signature ?? createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
  return paymentWebhook(
    new Request("https://shop.example/api/webhooks/payment", {
      method: "POST",
      body: raw,
      headers: { "x-signature": sig },
    }),
  );
}

export function pay(order: string, amount = 9700, id = `e2e-${order}`): Promise<Response> {
  return webhook({ order, status: "paid", amount, id });
}

let adminIp = 0;

export async function signInAsAdmin() {
  adminIp += 1;
  freshBrowser(`198.51.100.${adminIp}`);
  await redirected(adminSignIn({ code: null }, form({ password: process.env.ADMIN_PASSWORD ?? "" })));
}
