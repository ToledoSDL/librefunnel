import { isAdmin } from "@/lib/guard";
import { contactPhoto } from "@/lib/messages";

export async function GET(request: Request) {
  if (!(await isAdmin())) return Response.json({ code: "NOT_SIGNED_IN" }, { status: 401 });
  const address = new URL(request.url).searchParams.get("a") ?? "";
  const photo = /^\d{10,15}$/.test(address) ? await contactPhoto(address) : undefined;
  if (!photo) return new Response(null, { status: 404 });

  // The link carries the lookup time, so a new photo gets a new link and this one can be cached.
  return new Response(photo.bytes, {
    headers: {
      "Content-Type": photo.type,
      "Cache-Control": "private, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
