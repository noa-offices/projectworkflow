"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";

type ItemSnapshot = {
  id: string;
  item_name_snapshot: string | null;
  item_code_snapshot: string | null;
  brand_name_snapshot: string | null;
  size_snapshot: string | null;
  finish_snapshot: string | null;
  qty: number;
  net_total: number | null;
};

type GeneratePoResult =
  | { ok: true; poNumber: string }
  | { ok: false; error: string };

export async function generatePoAction(
  orderNo: string,
  quotationId: string,
  vendorKey: string,
  vendorLabel: string,
  itemsSnapshot: ItemSnapshot[],
): Promise<GeneratePoResult> {
  const supabase = await createSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Unauthorized." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,account_status")
    .eq("id", user.id)
    .maybeSingle<{ role: string | null; account_status: string | null }>();

  if (profile?.account_status !== "active") {
    return { ok: false, error: "Account not active." };
  }

  const role = profile?.role ?? null;
  const canProcure =
    role === "system_owner" ||
    role === "admin_manager" ||
    role === "procurement_manager";

  if (!canProcure) {
    return { ok: false, error: "Forbidden." };
  }

  // Derive project code segment from CO-XXXX-YYY → XXXX
  const codeMatch = orderNo.trim().match(/^CO-(\d{4})/i);
  if (!codeMatch) {
    return { ok: false, error: `Cannot derive PO number from order: ${orderNo}` };
  }
  const projectCode = codeMatch[1];

  // Count existing POs for this orderNo to determine next sequence
  const { count, error: countError } = await supabase
    .from("project_purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("order_no", orderNo);

  if (countError) {
    logServerActionError("GENERATE PO COUNT ERROR", countError, {
      action: "generatePoAction",
      table: "project_purchase_orders",
      recordId: orderNo,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to count existing POs", countError),
    };
  }

  const nextSeq = (count ?? 0) + 1;
  const poNumber = `PO-${projectCode}-${String(nextSeq).padStart(3, "0")}`;

  const { error: insertError } = await supabase
    .from("project_purchase_orders")
    .insert({
      order_no: orderNo,
      quotation_id: quotationId,
      po_number: poNumber,
      vendor_key: vendorKey,
      vendor_label: vendorLabel,
      items_snapshot: itemsSnapshot,
      created_by: user.id,
    });

  if (insertError) {
    logServerActionError("GENERATE PO INSERT ERROR", insertError, {
      action: "generatePoAction",
      table: "project_purchase_orders",
      recordId: orderNo,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to create PO record", insertError),
    };
  }

  return { ok: true, poNumber };
}
