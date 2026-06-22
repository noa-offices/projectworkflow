"use server";

import { requireActiveUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function reopenProjectAction(
  quotationId: string,
  orderNo: string,
): Promise<{ ok: boolean; error?: string }> {
  const { profile } = await requireActiveUser();

  const canEdit =
    profile?.role === "system_owner" || profile?.role === "admin_manager";
  if (!canEdit) return { ok: false, error: "Permission denied" };

  const adminResult = createAdminClient();
  if (!adminResult.client) {
    return { ok: false, error: adminResult.error ?? "Admin client unavailable" };
  }
  const supabase = adminResult.client;

  const { data: quotation, error: fetchError } = await supabase
    .from("quotations")
    .select("id, layout_settings")
    .eq("id", quotationId)
    .maybeSingle<{ id: string; layout_settings: Record<string, unknown> | null }>();

  if (fetchError || !quotation) {
    console.error("reopenProjectAction fetch failed:", JSON.stringify(fetchError));
    return { ok: false, error: "Quotation not found." };
  }

  const updated = { ...(quotation.layout_settings ?? {}) };
  delete updated.projectCompletedAt;

  const { error: updateError } = await supabase
    .from("quotations")
    .update({ layout_settings: updated } as never)
    .eq("id", quotationId);

  if (updateError) {
    console.error("reopenProjectAction update failed:", JSON.stringify(updateError));
    return { ok: false, error: updateError.message };
  }

  revalidatePath("/projects/orders");
  revalidatePath(`/projects/orders/${encodeURIComponent(orderNo)}`);
  revalidatePath("/projects/completed");
  revalidatePath("/procurement/orders");

  return { ok: true };
}
