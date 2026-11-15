import "server-only";
import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as pglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as postgresJs } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { demoMode } from "./guard";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT>;
type Connection = { database: Database; migrate: () => Promise<void>; lead: () => Promise<boolean> };

declare global {
  var libreFunnelDb: Connection | undefined;
  var libreFunnelDemoResetDay: string | undefined;
  var libreFunnelDemoSeeded: boolean | undefined;
}

const MIGRATIONS = { migrationsFolder: join(process.cwd(), "src", "lib", "migrations") };
// Seeds and media of the public demo; only the image's demo target has this folder.
export const DEMO_DIR = join(process.cwd(), "demo");
// A product only showcase.sql creates: without it the demo store has not been loaded.
const DEMO_MARKER = "mentoria-demo";
const DEMO_RESET_HOUR = "04";
const JOBS_LOCK = 1_769_235;

const SAO_PAULO_HOUR = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export function newId(): string {
  let id = "";
  for (let index = 0; index < 20; index += 1) id += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(randomInt(36));
  return id;
}

export function dataDir(): string {
  return process.env.DATA_DIR ?? "data";
}

export function one<Row>(rows: Row[]): Row {
  const [row] = rows;
  if (!row) throw new Error("query returned no row");
  return row;
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

// Without DATABASE_URL, dev runs on PGlite under DATA_DIR and tests on an in-memory PGlite: real Postgres, no server.
function connect(): Connection {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url);
    const database = postgresJs(client);
    let leader: postgres.ReservedSql | undefined;

    // During an update two app containers run side by side; only the one holding this session lock runs the jobs.
    // The lock dies with its connection, so the holder checks the connection on every tick.
    const lead = async () => {
      if (
        leader &&
        (await leader`SELECT 1`.then(
          () => true,
          () => false,
        ))
      )
        return true;
      leader?.release();
      leader = undefined;
      const reserved = await client.reserve();

      const locked = await reserved<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${JOBS_LOCK}) AS locked`.then(
        ([row]) => row?.locked === true,
        () => false,
      );

      if (locked) leader = reserved;
      else reserved.release();
      return locked;
    };

    return { database, migrate: () => migratePostgres(database, MIGRATIONS), lead };
  }
  const dir = process.env.NODE_ENV === "test" ? undefined : join(dataDir(), "pglite");
  if (dir) mkdirSync(dir, { recursive: true });
  const database = pglite(new PGlite(dir));
  return { database, migrate: () => migratePglite(database, MIGRATIONS), lead: async () => true };
}

// Next loads instrumentation and routes as separate module graphs; globalThis keeps one connection per process.
function connection(): Connection {
  globalThis.libreFunnelDb ??= connect();
  return globalThis.libreFunnelDb;
}

export function db(): Database {
  return connection().database;
}

export function migrate(): Promise<void> {
  return connection().migrate();
}

export function leadJobs(): Promise<boolean> {
  return connection().lead();
}

export async function seedDemo(executor: Database, file: "store.sql" | "showcase.sql") {
  const seed = await readFile(join(DEMO_DIR, file), "utf8");
  for (const statement of seed.split("--> statement-breakpoint")) await executor.execute(sql.raw(statement));
}

// Empties every table (the migrations journal lives in its own schema) and loads the demo store again, in one transaction.
export async function resetDemo() {
  const tables = Object.values(schema).filter((value) => is(value, PgTable));

  await db().transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE ${sql.join(tables, sql`, `)} RESTART IDENTITY CASCADE`);
    await seedDemo(tx, "store.sql");
    await seedDemo(tx, "showcase.sql");
  });
}

// Runs in the background loop, so only the process holding the jobs lock resets. The first run after a boot also loads the
// demo store when it is not there yet. The day is kept in memory, so a restart during the reset hour resets once more.
export async function nightlyDemoReset() {
  if (!demoMode()) return;
  const [day, hour] = SAO_PAULO_HOUR.format(new Date()).split(", ");
  const nightly = hour === DEMO_RESET_HOUR && globalThis.libreFunnelDemoResetDay !== day;
  if (!nightly && globalThis.libreFunnelDemoSeeded) return;

  const present = await stat(DEMO_DIR).then(
    () => true,
    () => false,
  );

  const seeded =
    !nightly &&
    (await db()
      .select({ slug: schema.product.slug })
      .from(schema.product)
      .where(eq(schema.product.slug, DEMO_MARKER))
      .then((rows) => rows.length > 0));

  if (!present)
    console.error(
      "[librefunnel] DEMO_MODE=1 but this image has no demo/ folder: build the demo target (docs/deploy.md, Demo)",
    );
  else if (!seeded) await resetDemo();
  globalThis.libreFunnelDemoSeeded = true;
  if (nightly) globalThis.libreFunnelDemoResetDay = day;
}
