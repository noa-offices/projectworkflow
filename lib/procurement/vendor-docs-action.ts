"use server";

import { requireActiveUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/lib/audit-log";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { isVendorReceivingStatus, nextVendorReceivedAt, type VendorReceivingStatus } from "@/lib/procurement/vendor-steps";

export type VendorDocRecord = {
  id: string;
  slot_key: string;
  file_name: string;
  storage_path: string;
  public_url: string;
};

type ActionResult = { ok: true } | { ok: false; error: string };
type SaveVendorResult = { ok: true; id: string } | { ok: false; error: string };

function canProcureRole(role: string | null | undefined): boolean {
  return (
    role === "system_owner" ||
    role === "admin_manager" ||
    role === "procurement_manager"
  );
}

export async function saveVendorDocUrl(
  orderNo: string,
  quotationId: string,
  vendorKey: string,
  slotKey: string,
  fileName: string,
  storagePath: string,
  publicUrl: string,
): Promise<SaveVendorResult> {
  const { user, profile } = await requireActiveUser();

  if (!canProcureRole(profile?.role)) {
    return { ok: false, error: "Forbidden." };
  }

  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    return { ok: false, error: adminResult.error ?? "Admin client unavailable" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = adminResult.client as any;

  const { data, error } = await supabase
    .from("procurement_vendor_docs")
    .insert({
      order_no: orderNo,
      quotation_id: quotationId,
      vendor_key: vendorKey,
      slot_key: slotKey,
      file_name: fileName,
      storage_path: storagePath,
      public_url: publicUrl,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    logServerActionError("SAVE VENDOR DOC ERROR", error, {
      action: "saveVendorDocUrl",
      table: "procurement_vendor_docs",
      recordId: orderNo,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to save document record", error),
    };
  }

  return { ok: true, id: data.id as string };
}

export async function deleteVendorDoc(
  orderNo: string,
  vendorKey: string,
  slotKey: string,
  storagePath: string,
): Promise<ActionResult> {
  const { profile } = await requireActiveUser();

  if (!canProcureRole(profile?.role)) {
    return { ok: false, error: "Forbidden." };
  }

  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    return { ok: false, error: adminResult.error ?? "Admin client unavailable" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = adminResult.client as any;

  const { error: storageErr } = await adminClient.storage
    .from("project-documents")
    .remove([storagePath]);

  if (storageErr) {
    logServerActionError("DELETE VENDOR DOC STORAGE ERROR", storageErr, {
      action: "deleteVendorDoc",
      storagePath,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to delete file from storage", storageErr),
    };
  }

  const { error: dbErr } = await adminClient
    .from("procurement_vendor_docs")
    .delete()
    .eq("order_no", orderNo)
    .eq("vendor_key", vendorKey)
    .eq("slot_key", slotKey);

  if (dbErr) {
    logServerActionError("DELETE VENDOR DOC DB ERROR", dbErr, {
      action: "deleteVendorDoc",
      table: "procurement_vendor_docs",
      recordId: orderNo,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to delete document record", dbErr),
    };
  }

  return { ok: true };
}

export type VendorProgressRecord = {
  id: string;
  order_no: string;
  vendor_key: string;
  active_step: number;
  etd: string | null;
  eta: string | null;
};

export async function saveVendorProgress(
  orderNo: string,
  vendorKey: string,
  activeStep: number,
  etd: string,
  eta: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, profile } = await requireActiveUser();

  if (!canProcureRole(profile?.role)) {
    return { ok: false, error: "Forbidden." };
  }

  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    return { ok: false, error: adminResult.error ?? "Admin client unavailable" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = adminResult.client as any;

  // N2B3.3 PART 1/3: ONE bounded pre-read of exactly this vendor-progress row's three
  // instrumented columns, identified by the same order_no/vendor_key pair the upsert below
  // already uses as its conflict target - never a whole-row/whole-table read. A missing row
  // (no prior save) means every "old" value is honestly null (PART 1), never guessed.
  const { data: previous } = await supabase
    .from("procurement_vendor_progress")
    .select("active_step,etd,eta")
    .eq("order_no", orderNo)
    .eq("vendor_key", vendorKey)
    .maybeSingle();

  // N2B3.3 PART 3: the EXACT same normalization the upsert below writes to the database - never
  // a second, divergent comparison (e.g. comparing old null against new "").
  const nextEtd = etd || null;
  const nextEta = eta || null;

  const { error } = await supabase
    .from("procurement_vendor_progress")
    .upsert(
      {
        order_no: orderNo,
        vendor_key: vendorKey,
        active_step: activeStep,
        etd: nextEtd,
        eta: nextEta,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "order_no,vendor_key" },
    );

  if (error) {
    return { ok: false, error: error.message };
  }

  // N2B3.3 PART 4/5/6/16: structured change detection only AFTER the write above has already
  // succeeded (never before - PART 16/17). Only the three allow-listed fields are ever
  // considered; a no-op save (changes.length === 0) creates no audit row at all (PART 5).
  const changes: Array<{ field: string; label: string; oldValue: number | string | null; newValue: number | string | null }> = [];
  if ((previous?.active_step ?? null) !== activeStep) {
    changes.push({ field: "active_step", label: "Procurement step", oldValue: previous?.active_step ?? null, newValue: activeStep });
  }
  if ((previous?.etd ?? null) !== nextEtd) {
    changes.push({ field: "etd", label: "ETD", oldValue: previous?.etd ?? null, newValue: nextEtd });
  }
  if ((previous?.eta ?? null) !== nextEta) {
    changes.push({ field: "eta", label: "ETA", oldValue: previous?.eta ?? null, newValue: nextEta });
  }

  if (changes.length > 0) {
    // N2B3.3 PART 7/8/9/10: the audit INSERT uses the ordinary user-scoped client (never the
    // admin client above) - it runs under the existing audit_activity_log_insert_managers RLS
    // policy (current_user_can_manage_records(), already confirmed to include
    // procurement_manager, migration 064), exactly like the proven
    // lib/procurement/log-vendor-milestone-action.ts pattern this reuses (same entityType/
    // parentEntityType, no new profiles lookup, no actorName - none of that existing analogous
    // writer resolves either). vendorKey stays internal-only metadata for correlation; the
    // human-facing title/description never expose it, only the CO order number.
    const auditClient = await createSupabaseClient();
    await createAuditLog(auditClient, {
      entityType: "procurement_vendor",
      entityId: null,
      parentEntityType: "confirmed_order",
      parentEntityId: null,
      action: "vendor_progress_updated",
      title: "Vendor progress updated",
      description: `Procurement progress updated for ${orderNo}.`,
      metadata: { orderNo, vendorKey, changes },
      createdBy: user.id,
    });
  }

  return { ok: true };
}

export type VendorProgressExtraRecord = VendorProgressRecord & {
  supplier_confirmed_at: string | null;
  supplier_confirmed_by: string | null;
  receiving_status: VendorReceivingStatus;
  received_at: string | null;
};

// Task 1 Part 1: explicit supplier confirmation, deliberately independent of active_step - a PO
// can be "issued" (step 1) with the supplier never having confirmed it. `confirmed: false` clears
// both fields rather than merely setting a boolean, so a cleared confirmation carries no stale
// actor/timestamp. Same auth/admin-client/upsert-onConflict pattern as saveVendorProgress above.
export async function setVendorSupplierConfirmation(
  orderNo: string,
  vendorKey: string,
  confirmed: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, profile } = await requireActiveUser();

  if (!canProcureRole(profile?.role)) {
    return { ok: false, error: "Forbidden." };
  }

  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    return { ok: false, error: adminResult.error ?? "Admin client unavailable" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = adminResult.client as any;

  const { data: previous } = await supabase
    .from("procurement_vendor_progress")
    .select("supplier_confirmed_at")
    .eq("order_no", orderNo)
    .eq("vendor_key", vendorKey)
    .maybeSingle();

  // Confirming again preserves the original timestamp instead of resetting it on every save.
  const nextConfirmedAt = confirmed ? ((previous?.supplier_confirmed_at as string | null) ?? new Date().toISOString()) : null;
  const nextConfirmedBy = confirmed ? user.id : null;

  const { error } = await supabase
    .from("procurement_vendor_progress")
    .upsert(
      {
        order_no: orderNo,
        vendor_key: vendorKey,
        supplier_confirmed_at: nextConfirmedAt,
        supplier_confirmed_by: nextConfirmedBy,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "order_no,vendor_key" },
    );

  if (error) {
    return { ok: false, error: error.message };
  }

  if ((previous?.supplier_confirmed_at ?? null) !== nextConfirmedAt) {
    const auditClient = await createSupabaseClient();
    await createAuditLog(auditClient, {
      entityType: "procurement_vendor",
      entityId: null,
      parentEntityType: "confirmed_order",
      parentEntityId: null,
      action: "vendor_supplier_confirmation_updated",
      title: confirmed ? "Supplier confirmed" : "Supplier confirmation cleared",
      description: `Supplier confirmation ${confirmed ? "recorded" : "cleared"} for ${orderNo}.`,
      metadata: { orderNo, vendorKey, confirmed },
      createdBy: user.id,
    });
  }

  return { ok: true };
}

// Task 1 Part 2: simple vendor-group receiving status. received_at is derived deterministically
// via nextVendorReceivedAt() - never set/cleared ad hoc here - so moving away from "received"
// can never leave a stale timestamp, matching the DB CHECK constraint added in migration 112.
export async function setVendorReceivingStatus(
  orderNo: string,
  vendorKey: string,
  status: VendorReceivingStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, profile } = await requireActiveUser();

  if (!canProcureRole(profile?.role)) {
    return { ok: false, error: "Forbidden." };
  }
  if (!isVendorReceivingStatus(status)) {
    return { ok: false, error: "Invalid receiving status." };
  }

  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    return { ok: false, error: adminResult.error ?? "Admin client unavailable" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = adminResult.client as any;

  const { data: previous } = await supabase
    .from("procurement_vendor_progress")
    .select("receiving_status,received_at")
    .eq("order_no", orderNo)
    .eq("vendor_key", vendorKey)
    .maybeSingle();

  const nextReceivedAtValue = nextVendorReceivedAt(status, (previous?.received_at as string | null) ?? null);

  const { error } = await supabase
    .from("procurement_vendor_progress")
    .upsert(
      {
        order_no: orderNo,
        vendor_key: vendorKey,
        receiving_status: status,
        received_at: nextReceivedAtValue,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "order_no,vendor_key" },
    );

  if (error) {
    return { ok: false, error: error.message };
  }

  const previousStatus = (previous?.receiving_status as VendorReceivingStatus | null) ?? "pending";
  if (previousStatus !== status) {
    const auditClient = await createSupabaseClient();
    await createAuditLog(auditClient, {
      entityType: "procurement_vendor",
      entityId: null,
      parentEntityType: "confirmed_order",
      parentEntityId: null,
      action: "vendor_receiving_status_updated",
      title: "Receiving status updated",
      description: `Receiving status set to ${status} for ${orderNo}.`,
      metadata: { orderNo, vendorKey, previousStatus, status },
      createdBy: user.id,
    });
  }

  return { ok: true };
}

export async function deleteVendorDocById(
  id: string,
  storagePath: string,
): Promise<ActionResult> {
  const { profile } = await requireActiveUser();

  if (!canProcureRole(profile?.role)) {
    return { ok: false, error: "Forbidden." };
  }

  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    return { ok: false, error: adminResult.error ?? "Admin client unavailable" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = adminResult.client as any;

  const { error: storageErr } = await adminClient.storage
    .from("project-documents")
    .remove([storagePath]);

  if (storageErr) {
    logServerActionError("DELETE VENDOR DOC STORAGE ERROR", storageErr, {
      action: "deleteVendorDocById",
      storagePath,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to delete file from storage", storageErr),
    };
  }

  const { error: dbErr } = await adminClient
    .from("procurement_vendor_docs")
    .delete()
    .eq("id", id);

  if (dbErr) {
    logServerActionError("DELETE VENDOR DOC DB ERROR", dbErr, {
      action: "deleteVendorDocById",
      table: "procurement_vendor_docs",
      recordId: id,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to delete document record", dbErr),
    };
  }

  return { ok: true };
}
