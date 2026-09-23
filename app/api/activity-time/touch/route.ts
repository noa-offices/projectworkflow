import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(null, { status: 401 });
  }

  const { error } = await supabase.rpc("touch_projectworkflow_activity");
  if (error) {
    return new Response(null, { status: error.code === "42501" ? 403 : 503 });
  }

  return new Response(null, { status: 204 });
}
