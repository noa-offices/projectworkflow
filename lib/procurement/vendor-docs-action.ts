"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";

export type VendorDocRecord = {
  slot_key: string;
  file_name: string;
  storage_path: string;
  public_url: string;
};

type ActionResult = { ok: true } | { ok: false; error: string };

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
): Promise<ActionResult> {
  const { user, profile } = await requireActiveUser();

  if (!canProcureRole(profile?.role)) {
    return { ok: false, error: "Forbidden." };
  }

  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("procurement_vendor_docs")
    .upsert(
      {
        order_no: orderNo,
        quotation_id: quotationId,
        vendor_key: vendorKey,
        slot_key: slotKey,
        file_name: fileName,
        storage_path: storagePath,
        public_url: publicUrl,
        created_by: user.id,
      },
      { onConflict: "order_no,vendor_key,slot_key" },
    );

  if (error) {
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

  return { ok: true };
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

  // Delete from storage — prefer admin client to bypass storage RLS
  const adminResult = createAdminClient();
  let storageDeleter;
  if (adminResult.client) {
    storageDeleter = adminResult.client;
  } else {
    storageDeleter = await createSupabaseClient();
  }

  const { error: storageErr } = await storageDeleter.storage
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

  // Delete DB row (uses authenticated server client to respect RLS)
  const supabase = await createSupabaseClient();
  const { error: dbErr } = await supabase
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
