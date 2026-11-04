import type { createClient } from "../supabase/server";
import { quotationLockReason } from "./quotation-lock";

export type QuotationLockTarget = { quotationId?: string | null; itemId?: string | null; sectionId?: string | null };
export type QuotationLockClient = Awaited<ReturnType<typeof createClient>>;

/** Resolve actual row ownership as well as the submitted quotation ID, so a forged parent cannot bypass the lock. */
export async function quotationWriteLockReason(supabase: QuotationLockClient, target: QuotationLockTarget): Promise<string | null> {
  const ids = new Set(target.quotationId ? [target.quotationId] : []);
  for (const [table, id] of [["quotation_items", target.itemId], ["quotation_sections", target.sectionId]] as const) {
    if (!id) continue;
    const { data, error } = await supabase.from(table).select("quotation_id").eq("id", id).maybeSingle<{ quotation_id: string }>();
    if (error || !data?.quotation_id) return "Quotation lock could not be verified. Reload and try again.";
    ids.add(data.quotation_id);
  }
  if (!ids.size) return "Quotation is required.";
  for (const id of ids) {
    const { data, error } = await supabase.from("quotations").select("layout_settings").eq("id", id).maybeSingle<{ layout_settings: unknown }>();
    if (error || !data) return "Quotation lock could not be verified. Reload and try again.";
    const reason = quotationLockReason(data);
    if (reason) return reason;
  }
  return null;
}
