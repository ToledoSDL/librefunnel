import { serveMedia } from "@/lib/media";

export async function GET(request: Request, { params }: { params: Promise<{ file: string; path: string[] }> }) {
  const { file, path } = await params;
  return serveMedia(request, [file, ...path].join("/"));
}
