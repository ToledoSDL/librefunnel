import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// A fresh nonce per page: Next reads it from this header and stamps it on its own scripts, so no inline script runs without it.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // https: because a connected bucket (R2, S3) serves images, videos and uploads from its own host, set in the panel.
    "img-src 'self' data: blob: https:",
    "media-src 'self' https: blob:",
    "font-src 'self'",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  identify(request, response);
  return response;
}

const DAY = 86400;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// Set with the page itself, so the first tracking beacons and the order share one visitor id, and Meta gets fbp
// without a browser pixel.
function identify(request: NextRequest, response: NextResponse) {
  if (request.method !== "GET" || request.nextUrl.pathname.startsWith("/admin")) return;
  const secure = (process.env.BASE_URL ?? "").startsWith("https://");
  const options = { path: "/", sameSite: "lax", secure, httpOnly: true } as const;

  if (!/^[a-z0-9]{20}$/.test(request.cookies.get("lf_vid")?.value ?? "")) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) => ALPHABET.charAt(byte % 36)).join("");
    response.cookies.set("lf_vid", id, { ...options, maxAge: 400 * DAY });
  }

  if (!request.cookies.has("_fbp")) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    response.cookies.set("_fbp", `fb.1.${Date.now()}.${random}`, { ...options, maxAge: 90 * DAY });
  }
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|media/|t$|_next/static|_next/image|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
