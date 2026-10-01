"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { createAuditLog } from "@/lib/audit-log";

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

  // Count-then-insert can race under near-simultaneous requests: two calls can derive the same
  // next sequence before either inserts. The unique constraint on po_number catches the second
  // insert; retrying with a freshly recounted sequence resolves it instead of surfacing a raw
  // DB conflict, bounded to a few attempts so a genuine failure still returns deterministically.
  const MAX_PO_GENERATION_ATTEMPTS = 3;
  let poNumber = "";
  let insertSucceeded = false;
  let lastInsertError: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt < MAX_PO_GENERATION_ATTEMPTS; attempt++) {
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
    poNumber = `PO-${projectCode}-${String(nextSeq).padStart(3, "0")}`;

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

    if (!insertError) {
      insertSucceeded = true;
      break;
    }

    lastInsertError = insertError;
    // 23505 = Postgres unique_violation: another request already took this PO number. Retry
    // with a recounted sequence. Any other error is a real failure - surface it immediately.
    if (insertError.code !== "23505") {
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
  }

  if (!insertSucceeded) {
    logServerActionError("GENERATE PO INSERT ERROR", lastInsertError, {
      action: "generatePoAction",
      table: "project_purchase_orders",
      recordId: orderNo,
    });
    return {
      ok: false,
      error: "Another PO was generated for this order at the same time. Please try again.",
    };
  }

  // Best-effort audit log, after successful creation only. No items_snapshot/prices - only
  // safe identifiers, matching the existing audit-log conventions used elsewhere in Procurement.
  await createAuditLog(supabase, {
    entityType: "procurement_vendor",
    entityId: null,
    parentEntityType: "confirmed_order",
    parentEntityId: null,
    action: "po_generated",
    title: "Purchase Order generated",
    description: `PO ${poNumber} generated for ${orderNo}.`,
    metadata: { orderNo, vendorKey, vendorLabel, poNumber },
    createdBy: user.id,
  });

  return { ok: true, poNumber };
}
