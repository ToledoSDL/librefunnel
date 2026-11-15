import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// The updater sends traffic to a new container only after this answers, which also means the migrations ran.
export async function GET() {
  await db().execute(sql`SELECT 1`);
  return new Response(null, { status: 204 });
}
