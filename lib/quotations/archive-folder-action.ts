"use server";

import { requireQuotationActionUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function archiveFolderAction(
  quotationId: string,
  archive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireQuotationActionUser();

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

  let updated: Record<string, unknown>;
  if (archive) {
    updated = { ...existing, folderArchivedAt: new Date().toISOString() };
  } else {
    const { folderArchivedAt: _removed, ...rest } = existing;
    updated = rest;
  }

  const { error: updateError } = await supabase
    .from("quotations")
    .update({ layout_settings: updated })
    .eq("id", quotationId);

  if (updateError) {
    return { ok: false, error: archive ? "Failed to archive folder." : "Failed to unarchive folder." };
  }

  revalidatePath("/quotations");
  revalidatePath("/sales/quotations");

  return { ok: true };
}
