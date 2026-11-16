import { createServer } from "node:http";
import { spyOn } from "bun:test";

type CookieOptions = { httpOnly?: boolean; secure?: boolean; sameSite?: string; maxAge?: number };
type Recorded = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: string };
type Reply = { status: number; body: object | string; headers?: Record<string, string> };

export const cookieStore = new Map<string, string>();
export const cookieOptions = new Map<string, CookieOptions>();
export const requestHeaders = new Headers();
export const sentMail: { to: string; subject: string; text: string }[] = [];
export const mailFailures: Error[] = [];
export const mailTransports: { host: string; port: number; secure: boolean; auth?: { user: string; pass: string } }[] =
  [];
export const WEBHOOK_SECRET = "webhook-test-secret";

export const jar = {
  get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) ?? "" } : undefined),
  getAll: () => [...cookieStore].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string, options: CookieOptions) => {
    cookieStore.set(name, value);
    cookieOptions.set(name, options);
  },
  delete: (name: string) => cookieStore.delete(name),
};

export class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect ${to}`);
  }
}

export function freshBrowser(ip = "203.0.113.10") {
  cookieStore.clear();
  cookieOptions.clear();
  for (const name of [...requestHeaders.keys()]) requestHeaders.delete(name);
  requestHeaders.set("x-forwarded-for", ip);
  requestHeaders.set("user-agent", "Mozilla/5.0 (test)");
}

// Bun's fetch type carries preconnect, so the replacement keeps the real one; restored by vi.restoreAllMocks.
export function fakeFetch(handler: (url: string, init: RequestInit | undefined) => Promise<Response>) {
  const real = globalThis.fetch;
  return spyOn(globalThis, "fetch").mockImplementation(
    Object.assign((input: URL | RequestInfo, init?: RequestInit) => handler(String(input), init), {
      preconnect: real.preconnect,
    }),
  );
}

export function redirectFetch(from: string | RegExp, to: string) {
  const real = globalThis.fetch;
  return fakeFetch((url, init) => real(url.replace(from, to), init));
}

export async function fakeServer(routes: Record<string, Reply>) {
  const requests: Recorded[] = [];

  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const path = (request.url ?? "/").split("?")[0] ?? "/";
      requests.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers, body });

      const notFound: Reply = { status: 404, body: { error: "not found" } };
      const reply = routes[`${request.method} ${path}`] ?? routes[`${request.method} *`] ?? notFound;

      response.writeHead(reply.status, { "Content-Type": "application/json", ...reply.headers });
      response.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`,
    requests,
    routes,
    to: (method: string, path: string) =>
      requests.filter((entry) => entry.method === method && entry.path.split("?")[0] === path),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function redirected(action: Promise<unknown>): Promise<string> {
  try {
    await action;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.to;
    throw error;
  }
  throw new Error("expected a redirect");
}

export function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}
