import { trackRequest } from "@/lib/tracking";

export async function POST(request: Request) {
  return trackRequest(request);
}
