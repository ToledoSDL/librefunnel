import "server-only";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { demoMode } from "../guard";
import { lesson, module, product, recoveryStep, reply as autoReply, setting } from "../schema";
import { bucket, call, listing, xmlValues } from "./bucket";
import type { Bucket } from "./bucket";
import { ID_TEXT, MEDIA_ID, PREFIX, mediaDir } from "./files";
import { busy } from "./video";

const ORPHAN_AGE_MS = 30 * 86_400_000;

// Every id that any row of these tables mentions, in any column: a column added later is covered without a change here.
async function usedMedia(): Promise<Set<string>> {
  const everything = sql.join(
    [product, module, lesson, setting, autoReply, recoveryStep].map(
      (table) => sql`SELECT ${table}::text AS row FROM ${table}`,
    ),
    sql` UNION ALL `,
  );

  const rows = await db()
    .selectDistinct({ id: sql<string>`(regexp_matches(everything.row, ${ID_TEXT}, 'g'))[1]` })
    .from(sql`(${everything}) AS everything`);

  return new Set(rows.map((row) => row.id));
}

async function oldBucketObjects(target: Bucket, before: number): Promise<string[]> {
  const keys: string[] = [];

  for await (const xml of listing(target, {}))
    for (const [, entry = ""] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const [key] = xmlValues(entry, "Key");
      const [modified] = xmlValues(entry, "LastModified");
      if (key && modified && Date.parse(modified) < before) keys.push(key);
    }

  return keys;
}

let sweptDay = "";

// Uploads nothing uses anymore. They are kept for 30 days, so a form saved late or a restored backup still finds its files.
export async function sweepMedia(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (demoMode() || busy || sweptDay === today) return;
  sweptDay = today;
  const used = await usedMedia();
  const before = Date.now() - ORPHAN_AGE_MS;

  const unused = (name: string) => {
    const id = MEDIA_ID.exec(name)?.[1];
    return id !== undefined && !used.has(id);
  };

  for (const name of (await readdir(mediaDir()).catch((): string[] => [])).filter(unused)) {
    const path = join(mediaDir(), name);
    const modified = (await stat(path).catch(() => undefined))?.mtimeMs ?? Infinity;
    if (modified < before) await rm(path, { recursive: true, force: true });
  }

  const target = await bucket();
  if (!target) return;
  for (const key of await oldBucketObjects(target, before))
    if (key.startsWith(PREFIX) && unused(key.slice(PREFIX.length))) await call(target, "DELETE", key);
}
