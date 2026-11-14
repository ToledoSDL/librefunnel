import "server-only";
import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as pglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as postgresJs } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export type Database = PgDatabase<PgQueryResultHKT>;
type Connection = { database: Database; migrate: () => Promise<void> };

declare global {
  var libreFunnelDb: Connection | undefined;
}

const MIGRATIONS = { migrationsFolder: join(process.cwd(), "src", "lib", "migrations") };

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
    const database = postgresJs(postgres(url));
    return { database, migrate: () => migratePostgres(database, MIGRATIONS) };
  }
  const dir = process.env.NODE_ENV === "test" ? undefined : join(dataDir(), "pglite");
  if (dir) mkdirSync(dir, { recursive: true });
  const database = pglite(new PGlite(dir));
  return { database, migrate: () => migratePglite(database, MIGRATIONS) };
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
