import "server-only";

type Release = { version: string; notes: string; url: string; publishedAt: string };
export type UpdaterStatus = {
  state: "idle" | "updating" | "restarting" | "failed";
  target?: string;
  message?: string;
  pinned: string;
  autoHour: string;
};
export type UpdateCode = "UPDATER_UNAVAILABLE" | "UPDATE_BUSY" | "INVALID_VERSION" | "INVALID_HOUR";

const REPO = process.env.LIBREFUNNEL_REPO ?? "ToledoSDL/librefunnel";
const VERSION = /^v\d+\.\d+\.\d+$/;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

declare global {
  var libreFunnelRelease: Release | undefined;
  var libreFunnelReleaseCheckedAt: number | undefined;
}

export function currentVersion() {
  return process.env.APP_VERSION || "dev";
}

export function latestRelease() {
  return globalThis.libreFunnelRelease;
}

export function newer(candidate: string, current: string) {
  if (!VERSION.test(candidate)) return false;
  if (!VERSION.test(current)) return true;

  const parts = (version: string) => version.slice(1).split(".").map(Number);
  const [a, b] = [parts(candidate), parts(current)];

  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference) return difference > 0;
  }

  return false;
}

// Runs in the background loop, so opening the admin never waits on GitHub.
export async function checkRelease() {
  const now = Date.now();

  if (now - (globalThis.libreFunnelReleaseCheckedAt ?? 0) < CHECK_EVERY_MS) return;
  globalThis.libreFunnelReleaseCheckedAt = now;

  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "librefunnel" },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);

  if (!response?.ok) return;

  const release: { tag_name?: string; body?: string; html_url?: string; published_at?: string } = await response.json();

  if (!release.tag_name || !VERSION.test(release.tag_name)) return;

  globalThis.libreFunnelRelease = {
    version: release.tag_name,
    // GitHub's generated body is only a compare link, which "Ver o que mudou" already covers.
    notes: (release.body ?? "")
      .replace(/^\*\*Full Changelog\*\*.*$/gm, "")
      .replace(/\*\*|^#+\s*/gm, "")
      .trim()
      .slice(0, 4000),
    url: release.html_url ?? `https://github.com/${REPO}/releases`,
    publishedAt: release.published_at ?? "",
  };
}

// The updater runs next to the store on the Docker network: no answer in this time means it is not running.
function updater(method: "GET" | "POST", path: string, timeout = 5000) {
  const url = process.env.UPDATER_URL;
  const token = process.env.UPDATER_TOKEN;

  if (!url || !token) return Promise.resolve(undefined);

  return fetch(`${url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeout),
  }).catch(() => undefined);
}

export async function updaterStatus(): Promise<UpdaterStatus | undefined> {
  const response = await updater("GET", "/status", 1500);

  if (!response?.ok) return undefined;

  const status: UpdaterStatus = await response.json();

  return status;
}

async function command(path: string): Promise<UpdateCode | null> {
  const response = await updater("POST", path);

  if (!response) return "UPDATER_UNAVAILABLE";
  if (response.status === 409) return "UPDATE_BUSY";
  if (response.status === 400) return path.startsWith("/auto") ? "INVALID_HOUR" : "INVALID_VERSION";

  return response.ok ? null : "UPDATER_UNAVAILABLE";
}

export function startUpdate(version: string) {
  return VERSION.test(version)
    ? command(`/update?version=${encodeURIComponent(version)}`)
    : Promise.resolve<UpdateCode>("INVALID_VERSION");
}

export function restartStore() {
  return command("/restart");
}

export function switchWhatsApp(on: boolean) {
  return command(`/whatsapp?on=${on ? 1 : 0}`);
}

export function setAutoUpdate(hour: string) {
  return command(`/auto?hour=${encodeURIComponent(hour)}`);
}
