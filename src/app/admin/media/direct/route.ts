import { directUpload } from "@/lib/media";

export async function POST(request: Request) {
  return directUpload(request);
}
