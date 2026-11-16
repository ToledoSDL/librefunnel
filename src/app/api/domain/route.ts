import { sellsAt } from "@/lib/catalog/products";
import { demoMode } from "@/lib/guard";
import { parseDomain } from "@/lib/input";

// Caddy asks before requesting a certificate for a product domain: 200 lets it, anything else refuses.
export async function GET(request: Request) {
  const domain = parseDomain(new URL(request.url).searchParams.get("domain") ?? "");
  return new Response(null, { status: domain && !demoMode() && (await sellsAt(domain)) ? 200 : 404 });
}
