import { directUpload } from "@/lib/media/uploads";

export async function POST(request: Request) {
  return directUpload(request);
}
