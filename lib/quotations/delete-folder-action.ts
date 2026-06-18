"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";

// Structural interface matching the Supabase StorageFileApi subset we use.
// Using as unknown as StorageBucketApi below because the Supabase type
// includes overloads that don't intersect cleanly with a minimal interface.
interface StorageBucketApi {
  list(
    prefix: string,
    options?: { limit?: number },
  ): Promise<{ data: Array<{ name: string; id: string | null }> | null; error: unknown }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
}

// Recursively list and delete every file under a storage prefix.
// Failures are swallowed — storage cleanup is best-effort.
async function tryDeleteStoragePrefix(
  bucket: StorageBucketApi,
  prefix: string,
  depth = 0,
): Promise<void> {
  if (depth > 4) return;
  try {
    const { data: items } = await bucket.list(prefix, { limit: 1000 });
    if (!items?.length) return;
    const filePaths: string[] = [];
    const subdirPaths: string[] = [];
    for (const item of items) {
      const fullPath = `${prefix}/${item.name}`;
      if (item.id) filePaths.push(fullPath);
      else subdirPaths.push(fullPath);
    }
    if (filePaths.length) await bucket.remove(filePaths);
    for (const subdir of subdirPaths) {
      await tryDeleteStoragePrefix(bucket, subdir, depth + 1);
    }
  } catch {
    // non-fatal
  }
}

export async function deleteFolderAction(
  quotationIds: string[],
  folderLabel: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireActiveUser();

  // Stricter than canManageRecords — only the two highest roles may delete folders.
  const canDelete =
    profile?.role === "system_owner" || profile?.role === "admin_manager";
  if (!canDelete) return { ok: false, error: "Forbidden." };

  if (!quotationIds.length) return { ok: false, error: "No quotations specified." };

  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    return { ok: false, error: adminResult.error ?? "Server admin delete is not configured." };
  }
  const admin = adminResult.client;

  // ── 1. Fetch all quotations (admin bypasses RLS; includes is_active=false) ──
  const { data: quotations, error: fetchError } = await admin
    .from("quotations")
    .select("id, layout_settings")
    .in("id", quotationIds)
    .returns<Array<{ id: string; layout_settings: Record<string, unknown> | null }>>();

  if (fetchError || !quotations?.length) {
    return { ok: false, error: "Quotations not found." };
  }

  // ── 2. Server-side eligibility re-check ──────────────────────────────────
  for (const q of quotations) {
    const hasProjectFile =
      Boolean(projectFileFromLayoutSettings(q.layout_settings)) ||
      Boolean(clientApprovalDraftFromLayoutSettings(q.layout_settings)?.confirmedOrder);

    if (hasProjectFile) {
      const isCancelled = typeof q.layout_settings?.projectCancelledAt === "string";
      if (!isCancelled) {
        return {
          ok: false,
          error: "This folder has an active or completed project. Cancel the project before deleting.",
        };
      }
    }
  }

  // ── 3. Collect orderNo if a (cancelled) project existed ──────────────────
  let orderNo: string | null = null;
  for (const q of quotations) {
    const pf =
      projectFileFromLayoutSettings(q.layout_settings) ??
      (clientApprovalDraftFromLayoutSettings(q.layout_settings)?.confirmedOrder ?? null);
    if (pf) {
      orderNo = pf.orderNo;
      break;
    }
  }

  // ── 4. Collect procurement_vendor_docs storage paths before cascade ───────
  const vendorDocPaths: string[] = [];
  {
    const { data: vendorDocs } = await admin
      .from("procurement_vendor_docs")
      .select("storage_path")
      .in("quotation_id", quotationIds)
      .returns<Array<{ storage_path: string }>>();
    for (const doc of vendorDocs ?? []) vendorDocPaths.push(doc.storage_path);
  }

  // ── 5. Collect project_document_attachments storage paths ─────────────────
  const projectDocPaths: string[] = [];
  if (orderNo) {
    const { data: projectDocs } = await admin
      .from("project_document_attachments")
      .select("storage_path")
      .eq("order_no", orderNo)
      .returns<Array<{ storage_path: string }>>();
    for (const doc of projectDocs ?? []) projectDocPaths.push(doc.storage_path);
  }

  // ── 6. Delete quote-images storage files (non-fatal) ─────────────────────
  const quoteImages = admin.storage.from("quote-images") as unknown as StorageBucketApi;
  for (const qId of quotationIds) {
    await tryDeleteStoragePrefix(quoteImages, `quotation-items/${qId}`);
    await tryDeleteStoragePrefix(quoteImages, `quotation-finishes/${qId}`);
    await tryDeleteStoragePrefix(quoteImages, `quotation-presentations/${qId}`);
  }

  // ── 7. Delete project-documents storage files (non-fatal) ────────────────
  const projectDocs = admin.storage.from("project-documents") as unknown as StorageBucketApi;
  if (vendorDocPaths.length) {
    try { await projectDocs.remove(vendorDocPaths); } catch { /* non-fatal */ }
  }
  if (projectDocPaths.length) {
    try { await projectDocs.remove(projectDocPaths); } catch { /* non-fatal */ }
  }

  // ── 8. Delete order-based orphans ─────────────────────────────────────────
  if (orderNo) {
    await admin.from("project_document_attachments").delete().eq("order_no", orderNo);
    await admin.from("procurement_vendor_progress").delete().eq("order_no", orderNo);
  }

  // ── 9. Delete audit log entries (no authenticated DELETE policy → admin) ──
  await admin.from("audit_activity_log").delete().in("entity_id", quotationIds);
  await admin.from("audit_activity_log").delete().in("parent_entity_id", quotationIds);

  // ── 10. Delete quotations — CASCADE handles all FK children ───────────────
  //
  //   Cascade deletes: quotation_sections, quotation_items,
  //   quotation_item_price_history, quotation_presentations,
  //   quotation_procurement_rfqs, quotation_purchase_orders,
  //   quotation_order_confirmations, quotation_pdfs,
  //   project_purchase_orders, procurement_vendor_docs.
  //
  const { error: deleteError } = await admin
    .from("quotations")
    .delete()
    .in("id", quotationIds);

  if (deleteError) {
    return { ok: false, error: `Delete failed: ${deleteError.message}` };
  }

  console.info("FOLDER DELETED", { folderLabel, quotationIds, orderNo });

  revalidatePath("/quotations");
  revalidatePath("/sales/quotations");
  revalidatePath("/projects/orders");
  revalidatePath("/procurement/orders");

  return { ok: true };
}
