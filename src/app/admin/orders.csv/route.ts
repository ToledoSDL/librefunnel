import { ordersCsv } from "@/lib/dashboard";
import { isAdmin } from "@/lib/sessions";

export async function GET(request: Request) {
  if (!(await isAdmin())) return new Response(null, { status: 303, headers: { Location: "/admin" } });
  return new Response(await ordersCsv(new URL(request.url).searchParams), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="pedidos.csv"',
      "Cache-Control": "no-store",
    },
  });
}
