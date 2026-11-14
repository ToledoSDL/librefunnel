const BATCH = 120;
const counted = new Map<string, Set<number>>();
const pending = new Map<string, number[]>();
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function send(product: string, seconds: number[]) {
  const body = JSON.stringify({ e: "retention", p: product, s: seconds });
  if (navigator.sendBeacon("/t", new Blob([body], { type: "application/json" }))) return;
  fetch("/t", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(
    () => undefined,
  );
}

function flush() {
  clearTimeout(timer);
  timer = undefined;
  for (const [product, seconds] of pending)
    for (let index = 0; index < seconds.length; index += BATCH) send(product, seconds.slice(index, index + BATCH));
  pending.clear();
}

export function watched(product: string, second: number): void {
  if (!Number.isInteger(second) || second < 0 || second > 7200) return;
  const seen = counted.get(product) ?? new Set<number>();
  if (seen.has(second)) return;
  seen.add(second);
  counted.set(product, seen);
  pending.set(product, [...(pending.get(product) ?? []), second]);
  timer ??= setTimeout(flush, 10_000);
  if (listening) return;
  listening = true;
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
