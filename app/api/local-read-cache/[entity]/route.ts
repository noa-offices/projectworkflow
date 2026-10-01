import { createClient } from "@/lib/supabase/server";
import { readProjection } from "@/lib/local-read-cache/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ entity: string }> }) {
  const { entity } = await context.params;
  return readProjection(request, entity, createClient);
}
