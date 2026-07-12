import { healthPayload } from '../lib/status.mjs';

export async function GET() {
  return Response.json(healthPayload());
}
