import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateWorkspace } from "@/lib/local/quotation-publication";
import { preparePublication } from "@/lib/local/quotation-publication-payload";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(error: string, code: string, status: number) {
  return NextResponse.json({ ok: false, error, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return failure("Sign in before publishing.", "UNAUTHORIZED", 401);
  const { data: profile, error: profileError } = await supabase.from("profiles").select("role,account_status").eq("id", user.id).maybeSingle();
  if (profileError) return failure("Could not verify permissions.", "UNAVAILABLE", 503);
  if (profile?.account_status !== "active" || !["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer"].includes(profile?.role ?? "")) {
    return failure("You cannot publish this quotation.", "FORBIDDEN", 403);
  }
  let body;
  try {
    body = await request.json();
    validateWorkspace(body.workspace, id);
    if (!uuid.test(id) || !uuid.test(body.baseVersion ?? "") || !uuid.test(body.mutationId ?? "")) throw new Error("A verified server version and publication ID are required.");
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Invalid workspace.", "VALIDATION", 400);
  }
  try {
    const { data, error } = await supabase.rpc("publish_local_builder_workspace", {
      p_id: id, p_base_version: body.baseVersion, p_mutation_id: body.mutationId,
      p_payload: preparePublication(body.workspace, user.id),
    });
    if (error) {
      console.error("LOCAL BUILDER PUBLICATION ERROR", { code: error.code, message: error.message });
      if (error.code === "42501" || error.code === "28000") return failure("Publication not authorized.", "FORBIDDEN", 403);
      if (error.code === "22023") return failure(error.message, "VALIDATION", 400);
      if (error.code === "P0002") return failure("Quotation not found.", "NOT_FOUND", 404);
      // Even errors/timeouts with an unknown commit outcome retain the same attempt.
      return failure("Publication could not be confirmed. Keep this draft and retry the same save.", "UNCERTAIN", 503);
    }
    if (!data?.ok) return failure(data?.error ?? "Server quotation changed.", data?.code ?? "CONFLICT", 409);
    // Cache invalidation is best effort AFTER commit; it must not turn success into failure.
    try {
      revalidatePath(`/quotations/${id}`);
      revalidatePath(`/quotations/${id}/local-builder`);
    } catch (error) { console.warn("LOCAL BUILDER REVALIDATION ERROR", error); }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return failure("Publication outcome is unknown. Keep this draft and retry the same save.", "UNCERTAIN", 503);
  }
}
