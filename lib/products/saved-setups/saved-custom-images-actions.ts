"use server";

import { requireActiveUser, requireRecordsManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CUSTOM_IMAGE_BUCKET, ownImagePaths } from "./custom-item-image";
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

/** FormData field "file" only. Any "path", "owner" or "item" field the client adds is ignored. */
export async function uploadCustomItemImage(formData: FormData): Promise<ImageUploadResult> {
  const { user } = await requireActiveUser();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a picture to upload." };
  const supabase = await createClient();
  return uploadCustomItemImageForUser(supabase, user.id, file);
}

/** Drops a picture the user added but did not keep. Only the owner's own, currently unused file is removed. */
export async function removeCustomItemImage(path: string): Promise<{ ok: boolean }> {
  try {
    const { user } = await requireActiveUser();
    const supabase = await createClient();
    return { ok: await removeUnusedCustomImageForUser(supabase, user.id, path) };
  } catch {
    return { ok: false };
  }
}

/** Save as custom item: copy the quote row's picture into the owner's folder. Returns the NEW my-collection path. */
export async function copyQuoteImageToCollection(ref: string): Promise<ImageUploadResult> {
  const { user } = await requireActiveUser();
  const supabase = await createClient();
  return copyQuoteImageToCollectionForUser(supabase, user.id, String(ref ?? ""));
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
  const { user } = await requireRecordsManager();
  if (!UUID.test(String(quotationId ?? "")) || !/^[A-Za-z0-9_-]{1,100}$/.test(String(rowId ?? ""))) {
    return { ok: false, error: "This picture cannot be copied." };
  }
  const supabase = await createClient();
  const loaded = await loadCustomItemForUser(supabase, user.id, String(customItemId ?? ""));
  if (!loaded.ok || !loaded.item.imagePath) return { ok: false, error: "This item has no picture." };
  return copyCustomImageToQuoteRowForUser(supabase, user.id, { imagePath: loaded.item.imagePath, quotationId: String(quotationId), rowId: String(rowId) });
}

/**
 * Short-lived signed links (1 hour) for the pictures being shown. Only paths inside the caller's own folder are signed;
 * the caller's own client is used, so storage policies apply on top.
 */
export async function signCustomItemImageUrls(paths: string[]): Promise<Record<string, string>> {
  const { user } = await requireActiveUser();
  const own = ownImagePaths(user.id, paths);
  if (own.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(CUSTOM_IMAGE_BUCKET).createSignedUrls(own, 60 * 60);
  if (error || !data) return {};
  const urls: Record<string, string> = {};
  for (const entry of data) if (entry.path && entry.signedUrl && own.includes(entry.path)) urls[entry.path] = entry.signedUrl;
  return urls;
}
