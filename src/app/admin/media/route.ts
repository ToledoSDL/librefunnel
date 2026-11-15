import { demoMode } from "@/lib/guard";
import { uploadMedia } from "@/lib/media";

export async function POST(request: Request) {
  // The demo password is public, and uploads survive the nightly reset, so they would fill the disk.
  if (demoMode()) return Response.json({ code: "DEMO_BLOCKED" }, { status: 403 });

  return uploadMedia(request);
}
