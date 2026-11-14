import { serveMedia } from "@/lib/media";

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  return serveMedia(request, (await params).file);
}
