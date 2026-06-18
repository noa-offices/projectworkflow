"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function cancelProjectAction(
  quotationId: string,
  orderNo: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireActiveUser();

  const canEdit =
    profile?.role === "system_owner" || profile?.role === "admin_manager";
  if (!canEdit) return { ok: false, error: "Forbidden." };

  const supabase = await createSupabaseClient();

  const { data: quotation, error: fetchError } = await supabase
    .from("quotations")
    .select("id, layout_settings")
    .eq("id", quotationId)
    .maybeSingle<{ id: string; layout_settings: Record<string, unknown> | null }>();

  if (fetchError || !quotation) {
    return { ok: false, error: "Quotation not found." };
  }

  const existing = quotation.layout_settings ?? {};

  if (typeof existing.projectCompletedAt === "string") {
    return { ok: false, error: "Project is already marked as completed." };
  }

  const updated = {
    ...existing,
    projectCancelledAt: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from("quotations")
    .update({ layout_settings: updated })
    .eq("id", quotationId);

  if (updateError) {
    return { ok: false, error: "Failed to cancel project." };
  }

  revalidatePath("/projects/orders");
  revalidatePath(`/projects/orders/${encodeURIComponent(orderNo)}`);
  revalidatePath("/procurement/orders");

  return { ok: true };
}
