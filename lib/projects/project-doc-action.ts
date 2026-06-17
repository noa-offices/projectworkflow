"use server";

import { requireActiveUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";

export type ProjectDocRecord = {
  id: string;
  slot_key: string;
  file_name: string;
  storage_path: string;
  public_url: string;
};

type ActionResult = { ok: true } | { ok: false; error: string };
type SaveResult = { ok: true; id: string } | { ok: false; error: string };

function canManageRecordsRole(role: string | null | undefined): boolean {
  return (
    role === "system_owner" ||
    role === "admin_manager" ||
    role === "procurement_manager" ||
    role === "sales_designer"
  );
}

export async function saveProjectDoc(
  orderNo: string,
  slotKey: string,
  fileName: string,
  storagePath: string,
  publicUrl: string,
): Promise<SaveResult> {
  const { user, profile } = await requireActiveUser();

  if (!canManageRecordsRole(profile?.role)) {
    return { ok: false, error: "Forbidden." };
  }

  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    return { ok: false, error: adminResult.error ?? "Admin client unavailable" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = adminResult.client as any;

  const { data, error } = await supabase
    .from("project_document_attachments")
    .insert({
      order_no: orderNo,
      slot_key: slotKey,
      file_name: fileName,
      storage_path: storagePath,
      public_url: publicUrl,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    logServerActionError("SAVE PROJECT DOC ERROR", error, {
      action: "saveProjectDoc",
      table: "project_document_attachments",
      recordId: orderNo,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to save document record", error),
    };
  }

  return { ok: true, id: data.id as string };
}

export async function deleteProjectDoc(
  orderNo: string,
  slotKey: string,
  storagePath: string,
): Promise<ActionResult> {
  const { profile } = await requireActiveUser();

  if (!canManageRecordsRole(profile?.role)) {
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
    logServerActionError("DELETE PROJECT DOC STORAGE ERROR", storageErr, {
      action: "deleteProjectDoc",
      storagePath,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to delete file from storage", storageErr),
    };
  }

  const { error: dbErr } = await adminClient
    .from("project_document_attachments")
    .delete()
    .eq("order_no", orderNo)
    .eq("slot_key", slotKey);

  if (dbErr) {
    logServerActionError("DELETE PROJECT DOC DB ERROR", dbErr, {
      action: "deleteProjectDoc",
      table: "project_document_attachments",
      recordId: orderNo,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to delete document record", dbErr),
    };
  }

  return { ok: true };
}

export async function deleteProjectDocById(
  id: string,
  storagePath: string,
): Promise<ActionResult> {
  const { profile } = await requireActiveUser();

  if (!canManageRecordsRole(profile?.role)) {
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
    logServerActionError("DELETE PROJECT DOC STORAGE ERROR", storageErr, {
      action: "deleteProjectDocById",
      storagePath,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to delete file from storage", storageErr),
    };
  }

  const { error: dbErr } = await adminClient
    .from("project_document_attachments")
    .delete()
    .eq("id", id);

  if (dbErr) {
    logServerActionError("DELETE PROJECT DOC DB ERROR", dbErr, {
      action: "deleteProjectDocById",
      table: "project_document_attachments",
      recordId: id,
    });
    return {
      ok: false,
      error: formatSafeActionError("Failed to delete document record", dbErr),
    };
  }

  return { ok: true };
}
