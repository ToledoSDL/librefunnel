// Runs next to the store with the Docker socket. It is reachable only inside the compose network, needs the token,
// and can do nothing but these fixed operations, so the admin never gets a shell on the server.
const TOKEN = process.env.UPDATER_TOKEN ?? "";
const REPO = process.env.LIBREFUNNEL_REPO ?? "ToledoSDL/librefunnel";
const DIR = process.cwd();
const ENV_FILE = `${DIR}/.env`;
const VERSION = /^v\d+\.\d+\.\d+$/;

type Status = {
  state: "idle" | "updating" | "restarting" | "failed";
  target?: string;
  message?: string;
  at?: string;
};

let status: Status = { state: "idle" };
let lastAutoDay = "";

async function compose(...args: string[]) {
  const child = Bun.spawn(["docker", "compose", ...args], {
    cwd: DIR,
    stdout: "ignore",
    stderr: "pipe",
  });

  const code = await child.exited;

  if (code === 0) return;

  const output = (await new Response(child.stderr).text()).trim().split("\n");

  throw new Error(output.at(-1) || `docker compose ${args[0]} terminou com código ${code}`);
}

// Everything the updater remembers lives in .env next to the rest of the store's configuration.
async function readEnv(name: string) {
  const env = await Bun.file(ENV_FILE)
    .text()
    .catch(() => "");

  return env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
}

async function writeEnv(name: string, value: string) {
  const env = await Bun.file(ENV_FILE)
    .text()
    .catch(() => "");

  const pattern = new RegExp(`^${name}=.*$`, "m");
  const line = `${name}=${value}`;
  const next = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;

  await Bun.write(ENV_FILE, next);
}

function failed(error: Error | string, target?: string): Status {
  return {
    state: "failed",
    target,
    message: typeof error === "string" ? error : error.message,
    at: new Date().toISOString(),
  };
}

async function update(version: string) {
  const previous = await readEnv("LIBREFUNNEL_VERSION");

  status = { state: "updating", target: version, at: new Date().toISOString() };

  try {
    // A dump named after the version, so going back is restoring one file.
    await compose(
      "exec",
      "-T",
      "backup",
      "sh",
      "-c",
      `pg_dump --clean --if-exists --no-owner -f /backups/antes-${version}.sql`,
    );
    await writeEnv("LIBREFUNNEL_VERSION", version);

    try {
      await compose("pull", "app");
    } catch (error) {
      await writeEnv("LIBREFUNNEL_VERSION", previous);
      throw error;
    }

    await compose("up", "-d", "--no-build", "app");
    status = { state: "idle", target: version, at: new Date().toISOString() };
  } catch (error) {
    status = failed(error instanceof Error ? error : "Falha desconhecida", version);
  }
}

async function restart() {
  status = { state: "restarting", at: new Date().toISOString() };

  try {
    await compose("restart", "app");
    status = { state: "idle", at: new Date().toISOString() };
  } catch (error) {
    status = failed(error instanceof Error ? error : "Falha desconhecida");
  }
}

function newer(candidate: string, current: string) {
  const parts = (version: string) => version.replace(/^v/, "").split(".").map(Number);
  const [a, b] = [parts(candidate), parts(current)];

  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference) return difference > 0;
  }

  return false;
}

// Once a day at the hour chosen in the admin, install the latest release if it is newer than the pinned one.
async function autoUpdate() {
  const hour = await readEnv("AUTO_UPDATE_HOUR");
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (hour === "" || Number(hour) !== now.getHours() || lastAutoDay === today || status.state !== "idle") return;
  lastAutoDay = today;

  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "librefunnel-updater" },
  }).catch(() => undefined);

  if (!response?.ok) return;

  const release: { tag_name?: string } = await response.json();
  const latest = release.tag_name ?? "";
  const current = await readEnv("LIBREFUNNEL_VERSION");

  if (VERSION.test(latest) && (!VERSION.test(current) || newer(latest, current))) await update(latest);
}

setInterval(() => void autoUpdate(), 10 * 60_000);

function authorized(request: Request) {
  const sent = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${TOKEN}`;

  if (!TOKEN || sent.length !== expected.length) return false;

  let difference = 0;

  for (let index = 0; index < sent.length; index++) difference |= sent.charCodeAt(index) ^ expected.charCodeAt(index);

  return difference === 0;
}

Bun.serve({
  port: 8090,
  async fetch(request) {
    if (!authorized(request)) return Response.json({ code: "NOT_AUTHORIZED" }, { status: 401 });

    const { pathname, searchParams } = new URL(request.url);
    const busy = status.state === "updating" || status.state === "restarting";

    if (request.method === "GET" && pathname === "/status") {
      return Response.json({
        ...status,
        pinned: await readEnv("LIBREFUNNEL_VERSION"),
        autoHour: await readEnv("AUTO_UPDATE_HOUR"),
      });
    }

    if (request.method === "POST" && pathname === "/restart") {
      if (busy) return Response.json({ code: "BUSY" }, { status: 409 });
      void restart();
      return Response.json({ ok: true }, { status: 202 });
    }

    if (request.method === "POST" && pathname === "/update") {
      const version = searchParams.get("version") ?? "";

      if (!VERSION.test(version)) return Response.json({ code: "INVALID_VERSION" }, { status: 400 });
      if (busy) return Response.json({ code: "BUSY" }, { status: 409 });
      void update(version);
      return Response.json({ ok: true }, { status: 202 });
    }

    if (request.method === "POST" && pathname === "/auto") {
      const hour = searchParams.get("hour") ?? "";

      if (hour !== "" && !(/^\d{1,2}$/.test(hour) && Number(hour) <= 23)) {
        return Response.json({ code: "INVALID_HOUR" }, { status: 400 });
      }

      await writeEnv("AUTO_UPDATE_HOUR", hour);
      return Response.json({ ok: true });
    }

    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  },
});
