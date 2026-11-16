import { readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";

// Runs next to the store with the Docker socket. It is reachable only inside the compose network, needs the token,
// and can do nothing but these fixed operations, so the admin never gets a shell on the server.
const TOKEN = process.env.UPDATER_TOKEN ?? "";
const REPO = process.env.LIBREFUNNEL_REPO ?? "ToledoSDL/librefunnel";
const DIR = process.cwd();
const ENV_FILE = `${DIR}/.env`;
const VERSION = /^v\d+\.\d+\.\d+$/;
const HEALTH_TIMEOUT_MS = 180_000;
const CADDYFILE = "deploy/Caddyfile";
// The files the installer downloads besides .env: each update brings them too, so no change needs the installer again.
const FILES = ["compose.yaml", CADDYFILE, "deploy/evolution.sql"];

type Status = {
  state: "idle" | "updating" | "restarting" | "failed";
  target?: string;
  message?: string;
  at?: string;
};

let status: Status = { state: "idle" };
let lastAutoDay = "";

async function docker(...args: string[]) {
  const child = Bun.spawn(["docker", ...args], {
    cwd: DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [code, output, errors] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (code === 0) return output.trim();

  throw new Error(
    errors.trim().split("\n").at(-1) || `docker ${args.slice(0, 2).join(" ")} terminou com código ${code}`,
  );
}

async function appContainers() {
  return (await docker("compose", "ps", "-q", "app")).split("\n").filter(Boolean);
}

async function healthy(id: string) {
  for (let waited = 0; waited < HEALTH_TIMEOUT_MS; waited += 2000) {
    const state = await docker("inspect", "-f", "{{.State.Health.Status}}", id);

    if (state === "healthy") return true;
    if (state === "unhealthy") return false;
    await Bun.sleep(2000);
  }

  return false;
}

// A new container starts next to the running one with the current image and .env; the old one stops only after the new
// one answers, so the store never goes offline. A version that does not come up is removed and the old one keeps selling.
async function rollout() {
  const running = await appContainers();

  await docker(
    "compose",
    "up",
    "-d",
    "--no-deps",
    "--no-build",
    "--no-recreate",
    "--scale",
    `app=${running.length + 1}`,
    "app",
  );

  const started = (await appContainers()).filter((id) => !running.includes(id));
  const ready = await Promise.all(started.map(healthy));

  if (!started.length || ready.includes(false)) {
    if (started.length) await docker("rm", "-f", ...started);
    throw new Error("A nova versão não respondeu a tempo. A loja continua na versão anterior.");
  }

  if (!running.length) return;

  // Caddy looks the app name up every second; this gives it time to send requests to the new container first.
  await Bun.sleep(3000);
  const images = (await docker("inspect", "-f", "{{.Image}}", ...running)).split("\n");

  await docker("stop", "-t", "30", ...running);
  await docker("rm", ...running);
  // Frees the disk the previous version used. An image still used by a container (a restart keeps the same one) stays.
  await docker("image", "rm", ...new Set(images)).catch(() => undefined);
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

async function download(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": "librefunnel-updater" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);

  return response?.ok ? response.text() : undefined;
}

// images.txt lists the digest of the image the release built and the SHA-256 of each file of FILES, so an image or a
// file changed after publishing is refused. Releases from before the file hashes keep the files they have.
async function published(version: string) {
  const manifest = await download(`https://github.com/${REPO}/releases/download/${version}/images.txt`);
  const hashes = new Map([...(manifest ?? "").matchAll(/^([\w./-]+)=(\S+)$/gm)].map(([, name, hash]) => [name, hash]));
  const digest = hashes.get("app")?.match(/^sha256:[0-9a-f]{64}$/)?.[0];
  const updaterDigest = hashes.get("updater")?.match(/^sha256:[0-9a-f]{64}$/)?.[0] ?? "";

  const files = await Promise.all(
    FILES.filter((path) => hashes.has(path)).map(async (path) => {
      const content = await download(`https://raw.githubusercontent.com/${REPO}/${version}/${path}`);

      if (content === undefined || new Bun.CryptoHasher("sha256").update(content).digest("hex") !== hashes.get(path))
        throw new Error(`O arquivo ${path} da versão ${version} não baixou inteiro. Nada mudou: tente de novo.`);
      return { path, content };
    }),
  );

  return { digest, updaterDigest, files };
}

// Written in place, not replaced, so the file Caddy has mounted sees the new content.
async function writeFiles(files: { path: string; content: string }[]) {
  const previous = await Promise.all(
    files.map(async ({ path }) => ({ path, content: await readFile(`${DIR}/${path}`, "utf8").catch(() => "") })),
  );

  await Promise.all(files.map(({ path, content }) => writeFile(`${DIR}/${path}`, content)));
  return previous;
}

async function update(version: string) {
  const previous = await readEnv("LIBREFUNNEL_VERSION");
  const previousDigest = await readEnv("LIBREFUNNEL_DIGEST");

  status = { state: "updating", target: version, at: new Date().toISOString() };

  try {
    const { digest, updaterDigest, files } = await published(version);

    if (!digest)
      throw new Error(
        `A versão ${version} não tem a impressão digital da imagem publicada no GitHub, então não foi instalada. Versões anteriores a essa verificação só se instalam pelo instalador.`,
      );

    // A dump named after the version, so going back is restoring one file. Only the last three are kept.
    await docker(
      "compose",
      "exec",
      "-T",
      "backup",
      "sh",
      "-c",
      `pg_dump --clean --if-exists --no-owner -f /backups/antes-${version}.sql && ls -t /backups/antes-*.sql | tail -n +4 | xargs -r rm -f`,
    );
    await writeEnv("LIBREFUNNEL_VERSION", version);
    await writeEnv("LIBREFUNNEL_DIGEST", digest);
    // compose.yaml goes first since the new app container is created from it; the Caddyfile only once that app answers.
    const previousCompose = await writeFiles(files.filter(({ path }) => path !== CADDYFILE));

    try {
      await docker("compose", "pull", "app");
      await rollout();
    } catch (error) {
      await writeEnv("LIBREFUNNEL_VERSION", previous);
      await writeEnv("LIBREFUNNEL_DIGEST", previousDigest);
      await writeFiles(previousCompose);
      throw error;
    }

    await reloadCaddy(files.find(({ path }) => path === CADDYFILE));
    status = { state: "idle", target: version, at: new Date().toISOString() };
    await replaceSelf(updaterDigest).catch((error) => console.warn("[updater] kept the current updater", error));
  } catch (error) {
    status = failed(error instanceof Error ? error : "Falha desconhecida", version);
  }
}

// A reload swaps the configuration without dropping connections, and Caddy keeps the old one if the new one fails.
async function reloadCaddy(caddyfile?: { path: string; content: string }) {
  if (!caddyfile) return;
  const [previous] = await writeFiles([caddyfile]);

  if (previous?.content === caddyfile.content) return;

  await docker("compose", "exec", "-T", "caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile").catch(
    async (error) => {
      console.warn("[updater] Caddy refused the new Caddyfile, keeping the previous one", error);
      if (previous) await writeFiles([previous]);
    },
  );
}

// Compose run here would mount this container's folder, not the host's, so a helper started with the host folder at the
// same path recreates the updater; this one stops partway and the new one takes over. A host path that is not a Linux path
// (Docker Desktop on Windows) cannot be mounted that way, so that updater stays until the installer runs again.
async function replaceSelf(digest: string) {
  const found = await docker(
    "inspect",
    "-f",
    `{{.Image}} {{range .Mounts}}{{if eq .Destination "${DIR}"}}{{.Source}}{{end}}{{end}}`,
    hostname(),
  );

  const image = found.slice(0, found.indexOf(" "));
  const folder = found.slice(found.indexOf(" ") + 1);

  if (!image || !folder.startsWith("/")) return;

  await writeEnv("LIBREFUNNEL_UPDATER_DIGEST", digest);
  await docker("compose", "pull", "updater");
  await docker(
    "run",
    "-d",
    "--rm",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${folder}:${folder}`,
    "-w",
    folder,
    "-e",
    `COMPOSE_PROJECT_NAME=${process.env.COMPOSE_PROJECT_NAME ?? ""}`,
    image,
    "docker",
    "compose",
    "up",
    "-d",
    "--no-deps",
    "updater",
  );
}

async function restart() {
  status = { state: "restarting", at: new Date().toISOString() };

  try {
    await rollout();
    status = { state: "idle", at: new Date().toISOString() };
  } catch (error) {
    status = failed(error instanceof Error ? error : "Falha desconhecida");
  }
}

// Evolution runs only while WhatsApp is in use. COMPOSE_PROFILES in .env keeps it on across `docker compose up -d`.
async function whatsapp(on: boolean) {
  if (on) {
    await writeEnv("COMPOSE_PROFILES", "whatsapp");
    await docker("compose", "--profile", "whatsapp", "up", "-d", "--no-deps", "evolution");
    return;
  }

  await docker("compose", "--profile", "whatsapp", "rm", "-s", "-f", "evolution");
  await writeEnv("COMPOSE_PROFILES", "");
}

// Stores from before Evolution became optional have it running already: keep it on for them.
async function keepRunningEvolution() {
  if ((await readEnv("COMPOSE_PROFILES")) !== "") return;
  const running = await docker("compose", "--profile", "whatsapp", "ps", "-q", "evolution");

  if (running) await writeEnv("COMPOSE_PROFILES", "whatsapp");
}

void keepRunningEvolution().catch((error) => console.warn("[updater] could not check Evolution", error));

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

    if (request.method === "POST" && pathname === "/whatsapp") {
      // The first start downloads the Evolution image, which can take minutes: answer now and let the store poll it.
      void whatsapp(searchParams.get("on") === "1").catch((error) =>
        console.warn("[updater] could not switch Evolution", error),
      );
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
