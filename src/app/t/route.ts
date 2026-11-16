import { trackRequest } from "@/lib/tracking/funnel";

export async function POST(request: Request) {
  return trackRequest(request);
}
