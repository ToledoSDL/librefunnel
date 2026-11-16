import "server-only";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { bucket, putFile, putFolder } from "./bucket";
import type { Bucket } from "./bucket";
import { FOLDER, PREFIX, mediaDir, mimeOf } from "./files";

const DUMP = /^librefunnel-\d\.sql$/;

let backupSentAt = 0;

// The daily database dump also goes to the connected bucket, so losing the server does not lose the sales.
// Named after the weekday like on disk, so the bucket keeps the same last 7 days.
export async function sendBackup(): Promise<void> {
  const dir = process.env.BACKUP_DIR;
  if (!dir) return;
  const names = (await readdir(dir).catch((): string[] => [])).filter((name) => DUMP.test(name));
  const dumps = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(dir, name))).mtimeMs })));
  const newest = dumps.sort((a, b) => b.at - a.at)[0];
  if (!newest || newest.at <= backupSentAt) return;
  const target = await bucket();
  if (!target) return;
  await putFile(target, `backups/${newest.name}`, join(dir, newest.name), "application/sql");
  backupSentAt = newest.at;
}

// Once a bucket is connected, files already on disk move to it one by one; the local copy goes only after the upload succeeds.
export async function sendToBucket(target: Bucket, name: string): Promise<void> {
  const path = join(mediaDir(), name);
  if (FOLDER.test(name)) await putFolder(target, name, path);
  else await putFile(target, `${PREFIX}${name}`, path, mimeOf(name) ?? "application/octet-stream");
  await rm(path, { recursive: true, force: true });
}
