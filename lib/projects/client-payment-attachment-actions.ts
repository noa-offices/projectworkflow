"use server";

import { revalidatePath } from "next/cache";
import {
  canManageClientPaymentReceiptAttachments,
  canRecordClientPaymentReceipts,
  canViewClientPayments,
  requireActiveUser,
} from "@/lib/auth";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  CLIENT_PAYMENT_ATTACHMENT_MAX_SIZE,
  clientPaymentAttachmentHasExpectedSignature,
  safeClientPaymentAttachmentFilename,
} from "@/lib/projects/client-payment-attachment-model";

const RECEIPT_BUCKET = "client-payment-receipts";

type ActionResult = { ok: true } | { ok: false; error: string };
type SignedUrlResult = { ok: true; url: string; fileName: string } | { ok: false; error: string };
type AttachmentContext = {
  attachment_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
};

function adminStorage() {
  const result = createAdminClient();
  if (result.error || !result.client) return { client: null, error: result.error ?? "Trusted Storage client unavailable." };
  return { client: result.client, error: null };
}

function refreshProject(orderNo: string) {
  revalidatePath(`/projects/orders/${encodeURIComponent(orderNo)}`);
  revalidatePath("/projects/completed");
}

export async function uploadClientPaymentReceiptAttachment(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireActiveUser();
  if (!canRecordClientPaymentReceipts(profile?.role)) return { ok: false, error: "Forbidden." };

  const receiptId = String(formData.get("receiptId") ?? "");
  const quotationId = String(formData.get("quotationId") ?? "");
  const orderNo = String(formData.get("orderNo") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a file to upload." };
  if (!/^[A-Za-z0-9_-]+$/.test(orderNo)) return { ok: false, error: "Invalid Project File number." };
  if (!file.name.trim() || file.name.length > 255 || /[\u0000-\u001F\u007F/\\]/.test(file.name)) {
    return { ok: false, error: "Invalid attachment filename." };
  }
  if (file.size <= 0) return { ok: false, error: "Empty files cannot be uploaded." };
  if (file.size > CLIENT_PAYMENT_ATTACHMENT_MAX_SIZE) return { ok: false, error: "Receipt attachments must be 10 MB or smaller." };
  const safeName = safeClientPaymentAttachmentFilename(file.name, file.type);
  if (!safeName) return { ok: false, error: "Use a PDF, PNG, JPEG, or WebP file with a matching extension." };

  const supabase = await createSupabaseClient();
  const { data: ownership, error: ownershipError } = await supabase.rpc("client_payment_receipt_attachment_context", {
    p_receipt_id: receiptId,
    p_quotation_id: quotationId,
    p_order_no: orderNo,
  });
  if (ownershipError || !Array.isArray(ownership) || ownership.length !== 1) {
    return { ok: false, error: formatSafeActionError("Could not verify receipt ownership", ownershipError) };
  }
  if (ownership[0]?.receipt_voided) return { ok: false, error: "Attachments cannot be added to a voided receipt." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!clientPaymentAttachmentHasExpectedSignature(bytes, file.type)) return { ok: false, error: "File contents do not match the selected file type." };

  const attachmentId = crypto.randomUUID();
  const storagePath = `projects/${orderNo}/receipts/${receiptId}/${attachmentId}-${safeName}`;
  const storage = adminStorage();
  if (storage.error || !storage.client) return { ok: false, error: storage.error ?? "Trusted Storage client unavailable." };

  const { error: uploadError } = await storage.client.storage
    .from(RECEIPT_BUCKET)
    .upload(storagePath, Buffer.from(bytes), { contentType: file.type, upsert: false });
  if (uploadError) {
    logServerActionError("CLIENT PAYMENT ATTACHMENT UPLOAD ERROR", uploadError, { action: "uploadClientPaymentReceiptAttachment", recordId: receiptId });
    return { ok: false, error: formatSafeActionError("Could not upload receipt attachment", uploadError) };
  }

  const { error: metadataError } = await supabase.rpc("add_client_payment_receipt_attachment_metadata", {
    p_attachment_id: attachmentId,
    p_receipt_id: receiptId,
    p_quotation_id: quotationId,
    p_order_no: orderNo,
    p_file_name: file.name,
    p_safe_file_name: safeName,
    p_storage_path: storagePath,
    p_mime_type: file.type,
    p_file_size_bytes: file.size,
  });
  if (metadataError) {
    const { error: cleanupError } = await storage.client.storage.from(RECEIPT_BUCKET).remove([storagePath]);
    logServerActionError("CLIENT PAYMENT ATTACHMENT METADATA ERROR", metadataError, { action: "uploadClientPaymentReceiptAttachment", recordId: receiptId });
    return {
      ok: false,
      error: cleanupError
        ? "Payment receipt was unchanged, but attachment metadata and orphan cleanup both failed. Administrator recovery is required."
        : formatSafeActionError("Attachment metadata could not be saved; the uploaded object was removed", metadataError),
    };
  }

  refreshProject(orderNo);
  return { ok: true };
}

export async function getClientPaymentReceiptAttachmentUrl(
  attachmentId: string,
  receiptId: string,
  quotationId: string,
  orderNo: string,
  download: boolean,
): Promise<SignedUrlResult> {
  const { profile } = await requireActiveUser();
  if (!canViewClientPayments(profile?.role)) return { ok: false, error: "Forbidden." };
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("get_client_payment_receipt_attachment", {
    p_attachment_id: attachmentId,
    p_receipt_id: receiptId,
    p_quotation_id: quotationId,
    p_order_no: orderNo,
  });
  const attachment = Array.isArray(data) ? data[0] as AttachmentContext | undefined : undefined;
  if (error || !attachment) return { ok: false, error: formatSafeActionError("Could not verify attachment access", error) };
  const storage = adminStorage();
  if (storage.error || !storage.client) return { ok: false, error: storage.error ?? "Trusted Storage client unavailable." };
  const { data: signed, error: signedError } = await storage.client.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(attachment.storage_path, 600, { download: download ? attachment.file_name : false });
  if (signedError || !signed?.signedUrl) return { ok: false, error: formatSafeActionError("Could not create attachment link", signedError) };
  return { ok: true, url: signed.signedUrl, fileName: attachment.file_name };
}

export async function removeClientPaymentReceiptAttachment(
  attachmentId: string,
  receiptId: string,
  quotationId: string,
  orderNo: string,
): Promise<ActionResult> {
  const { profile } = await requireActiveUser();
  if (!canManageClientPaymentReceiptAttachments(profile?.role)) return { ok: false, error: "Forbidden." };
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("get_client_payment_receipt_attachment", {
    p_attachment_id: attachmentId,
    p_receipt_id: receiptId,
    p_quotation_id: quotationId,
    p_order_no: orderNo,
  });
  const attachment = Array.isArray(data) ? data[0] as AttachmentContext | undefined : undefined;
  if (error || !attachment) return { ok: false, error: formatSafeActionError("Could not verify attachment ownership", error) };
  const storage = adminStorage();
  if (storage.error || !storage.client) return { ok: false, error: storage.error ?? "Trusted Storage client unavailable." };

  const { error: storageError } = await storage.client.storage.from(RECEIPT_BUCKET).remove([attachment.storage_path]);
  if (storageError) {
    return { ok: false, error: formatSafeActionError("Storage object was not removed; metadata was preserved", storageError) };
  }
  const { error: metadataError } = await supabase.rpc("remove_client_payment_receipt_attachment_metadata", {
    p_attachment_id: attachmentId,
    p_receipt_id: receiptId,
    p_quotation_id: quotationId,
    p_order_no: orderNo,
  });
  if (metadataError) {
    return { ok: false, error: "Storage object was removed, but its recoverable metadata record remains. Administrator recovery is required." };
  }
  refreshProject(orderNo);
  return { ok: true };
}
