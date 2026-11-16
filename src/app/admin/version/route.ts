import { isAdmin } from "@/lib/sessions";
import { currentVersion } from "@/lib/updates";

// Polled while the store restarts, so the panel knows when it is back and on which version.
export async function GET() {
  if (!(await isAdmin())) return Response.json({ code: "NOT_SIGNED_IN" }, { status: 401 });

  return Response.json({ version: currentVersion() }, { headers: { "cache-control": "no-store" } });
}
