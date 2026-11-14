import { uploadMedia } from "@/lib/media";

export async function POST(request: Request) {
  return uploadMedia(request);
}
