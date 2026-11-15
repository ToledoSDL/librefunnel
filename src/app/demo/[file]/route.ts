import { stat } from "node:fs/promises";
import { join } from "node:path";
import { DEMO_DIR } from "@/lib/db";
import { demoMode } from "@/lib/guard";
import { sendFile } from "@/lib/media";

// Only these names are ever joined to a path, so nothing outside demo/media can be reached.
const FILES = new Map([
  ["vsl-demo.mp4", "video/mp4"],
  ["vsl-demo.vtt", "text/vtt"],
  ["banner.svg", "image/svg+xml"],
  ["cover.svg", "image/svg+xml"],
  ["module-1.svg", "image/svg+xml"],
  ["module-2.svg", "image/svg+xml"],
  ["mentoria.svg", "image/svg+xml"],
  ["spreadsheet.svg", "image/svg+xml"],
]);

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const mime = FILES.get(file);
  if (!demoMode() || !mime) return new Response(null, { status: 404 });
  const path = join(DEMO_DIR, "media", file);
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return new Response(null, { status: 404 });
  return sendFile(request, path, info.size, mime, "public, max-age=3600");
}
