"use server";

import { requireActiveUser, requireRecordsManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CUSTOM_IMAGE_BUCKET, imageMessage, ownImagePaths, type ImageErrorKind } from "./custom-item-image";
import {
  copyCustomImageToQuoteRowForUser,
  copyQuoteImageToCollectionForUser,
  loadCustomItemForUser,
  removeUnusedCustomImageForUser,
  uploadCustomItemImageForUser,
  type ImageUploadResult,
} from "./saved-custom-items-service";

// Public POST endpoints: every action authenticates inside, takes the owner from the SESSION (never from client input),
// uses the CALLER's Supabase client (storage policies stay on) and never uses an admin client.
// The client can send a file or a reference to a picture, never an owner id or a storage path to write to.
// None of these actions throws to the client: each returns { ok: false, error } with a plain-English message, and the
// technical detail goes only to the server log. (A sign-in redirect is turned into the "not allowed" message too.)

function failure(kind: ImageErrorKind, problem: unknown, detail?: string): { ok: false; error: string; kind: ImageErrorKind } {
  const digest = (problem as { digest?: unknown } | null)?.digest;
  const authProblem = typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
  const finalKind: ImageErrorKind = authProblem ? "not_allowed" : kind;
  try {
    if (!authProblem) console.error("custom item picture action failed:", problem instanceof Error ? problem.message : problem);
  } catch {
    // logging must never fail an action
  }
  return { ok: false, error: imageMessage(finalKind, authProblem ? undefined : detail), kind: finalKind };
}

/**
 * FormData field "file" only. The browser has already compressed the picture to a small WebP (Vercel limits a request body
 * to about 4.5 MB, so the original is never posted); the server still re-checks everything. Any "path", "owner" or "item"
 * field the client adds is ignored.
 */
export async function uploadCustomItemImage(formData: FormData): Promise<ImageUploadResult> {
  try {
    const { user } = await requireActiveUser();
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: imageMessage("server_rejected", "not_webp"), kind: "server_rejected" };
    const supabase = await createClient();
    return await uploadCustomItemImageForUser(supabase, user.id, file);
  } catch (problem) {
    return failure("unknown", problem);
  }
}

/** Drops a picture the user added but did not keep. Only the owner's own, currently unused file is removed. */
export async function removeCustomItemImage(path: string): Promise<{ ok: boolean }> {
  try {
    const { user } = await requireActiveUser();
    const supabase = await createClient();
    return { ok: await removeUnusedCustomImageForUser(supabase, user.id, path) };
  } catch (problem) {
    try {
      console.error("custom item picture cleanup failed:", problem instanceof Error ? problem.message : problem);
    } catch {
      // best effort
    }
    return { ok: false };
  }
}

/** Save as custom item: copy the quote row's picture into the owner's folder as a WebP. Returns the NEW my-collection path. */
export async function copyQuoteImageToCollection(ref: string): Promise<ImageUploadResult> {
  try {
    const { user } = await requireActiveUser();
    const supabase = await createClient();
    return await copyQuoteImageToCollectionForUser(supabase, user.id, String(ref ?? ""));
  } catch (problem) {
    return failure("copy_from_row_failed", problem, "storage");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Local quote builder: copy the item's picture into quote-images under the new row's own path. Returns the row's
 * "bucket:path" reference. Same permission as the builders (records manager); the item is loaded under the caller's
 * own session, so another user's item is "not found".
 */
export async function copyCustomItemImageToQuote(
  customItemId: string,
  quotationId: string,
  rowId: string,
): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  try {
    const { user } = await requireRecordsManager();
    if (!UUID.test(String(quotationId ?? "")) || !/^[A-Za-z0-9_-]{1,100}$/.test(String(rowId ?? ""))) {
      return { ok: false, error: imageMessage("copy_to_quote_failed", "not_copyable") };
    }
    const supabase = await createClient();
    const loaded = await loadCustomItemForUser(supabase, user.id, String(customItemId ?? ""));
    if (!loaded.ok || !loaded.item.imagePath) return { ok: false, error: imageMessage("copy_to_quote_failed", "not_found") };
    return await copyCustomImageToQuoteRowForUser(supabase, user.id, { imagePath: loaded.item.imagePath, quotationId: String(quotationId), rowId: String(rowId) });
  } catch (problem) {
    return failure("copy_to_quote_failed", problem, "storage");
  }
}

/**
 * Short-lived signed links (1 hour) for the pictures being shown. Only paths inside the caller's own folder are signed;
 * the caller's own client is used, so storage policies apply on top. A failure just means "no picture links".
 */
export async function signCustomItemImageUrls(paths: string[]): Promise<Record<string, string>> {
  try {
    const { user } = await requireActiveUser();
    const own = ownImagePaths(user.id, paths);
    if (own.length === 0) return {};
    const supabase = await createClient();
    const { data, error } = await supabase.storage.from(CUSTOM_IMAGE_BUCKET).createSignedUrls(own, 60 * 60);
    if (error || !data) return {};
    const urls: Record<string, string> = {};
    for (const entry of data) if (entry.path && entry.signedUrl && own.includes(entry.path)) urls[entry.path] = entry.signedUrl;
    return urls;
  } catch {
    return {};
  }
}
