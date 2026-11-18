/**
 * My Collection sharing: picture transfer (PR 4-2). The CALLER's own Supabase client only (storage policies stay on);
 * no admin client. Every function here is best effort or returns a typed result: none throws.
 *
 * SEND:   the sender's own picture is downloaded, re-encoded to WebP (<= 2 MB, long side <= 1600, same quality ladder as
 *         every other My Collection picture) and uploaded to {recipient}/incoming/{share}/picture.webp (upsert false, the one
 *         file the storage policy allows while the share is pending). The share itself never depends on it.
 * ACCEPT: the recipient's session copies the incoming file into the recipient's own item path, after checking real WebP
 *         bytes and the 2 MB limit. Incoming files are removed best effort after accept, dismiss and unsend.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CUSTOM_IMAGE_BUCKET, LEGACY_MAX_BYTES, STORED_IMAGE_TYPE, isOwnImagePath, validateStoredWebp } from "./custom-item-image";
import { toStoredWebp } from "./custom-item-image-sharp";
import { buildAcceptedPicturePath, buildIncomingPicturePath, isIncomingPicturePath, shareMessage, type ShareMessageKind } from "./shares";
import { attachSharePicture } from "./shares-service";

export type PictureTransferResult = { ok: true } | { ok: false; kind: ShareMessageKind };

function logPictureProblem(where: string, error: unknown) {
  try {
    const code = (error as { statusCode?: unknown; code?: unknown } | null);
    console.error(`my collection share picture (${where}) failed`, String(code?.statusCode ?? code?.code ?? ""));
  } catch {
    // logging must never fail a share
  }
}

/** Sender: own picture -> WebP in the recipient's incoming folder. */
export async function uploadSharePictureForSend(
  supabase: SupabaseClient,
  input: { senderId: string; imagePath: string; recipientId: string; shareId: string },
): Promise<PictureTransferResult> {
  try {
    if (!isOwnImagePath(input.senderId, input.imagePath)) return { ok: false, kind: "picture_unavailable" };
    const { data, error } = await supabase.storage.from(CUSTOM_IMAGE_BUCKET).download(input.imagePath);
    if (error || !data) {
      logPictureProblem("send download", error);
      return { ok: false, kind: "picture_unavailable" };
    }
    if (!(data.size > 0) || data.size > LEGACY_MAX_BYTES) return { ok: false, kind: "picture_unreadable" };
    const converted = await toStoredWebp(new Uint8Array(await data.arrayBuffer()));
    if (!converted.ok) return { ok: false, kind: converted.reason === "too_detailed" ? "picture_too_detailed" : "picture_unreadable" };
    const { data: uploaded, error: uploadError } = await supabase.storage
      .from(CUSTOM_IMAGE_BUCKET)
      .upload(buildIncomingPicturePath(input.recipientId, input.shareId), converted.bytes, { cacheControl: "3600", contentType: STORED_IMAGE_TYPE, upsert: false });
    if (uploadError || !uploaded?.path) {
      logPictureProblem("send upload", uploadError);
      return { ok: false, kind: "picture_upload_failed" };
    }
    return { ok: true };
  } catch (error) {
    logPictureProblem("send", error);
    return { ok: false, kind: "picture_upload_failed" };
  }
}

/**
 * Sender: upload, then tell the database. If ANY step fails the share still goes through: the database stores the note
 * (a short reason from SHARE_MESSAGES) and the sender gets it back. Returns whether the picture is attached.
 */
export async function transferPictureForSend(
  supabase: SupabaseClient,
  input: { senderId: string; imagePath: string; recipientId: string; shareId: string },
): Promise<{ attached: boolean; note: string | null }> {
  const uploaded = await uploadSharePictureForSend(supabase, input);
  if (uploaded.ok) {
    if (await attachSharePicture(supabase, input.shareId, true, null)) return { attached: true, note: null };
    await removeIncomingPicture(supabase, input.recipientId, input.shareId); // not attached: no orphan file
    const note = shareMessage("picture_not_included");
    await attachSharePicture(supabase, input.shareId, false, note);
    return { attached: false, note };
  }
  const note = shareMessage(uploaded.kind);
  await attachSharePicture(supabase, input.shareId, false, note);
  return { attached: false, note };
}

/** Recipient: incoming file -> the recipient's own item path (real WebP, <= 2 MB). Returns the new own path. */
export async function copyIncomingPictureForAccept(
  supabase: SupabaseClient,
  input: { recipientId: string; shareId: string; picturePath: string; now?: Date },
): Promise<PictureTransferResult & { path?: string }> {
  try {
    if (!isIncomingPicturePath(input.picturePath, input.recipientId, input.shareId)) return { ok: false, kind: "picture_invalid" };
    const { data, error } = await supabase.storage.from(CUSTOM_IMAGE_BUCKET).download(input.picturePath);
    if (error || !data) {
      logPictureProblem("accept download", error);
      return { ok: false, kind: "picture_unavailable" };
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    // The bucket only holds WebP, but the bytes are checked again: RIFF....WEBP and 2 MB.
    if (!validateStoredWebp(STORED_IMAGE_TYPE, bytes.byteLength, "picture.webp", bytes).ok) return { ok: false, kind: "picture_invalid" };
    const target = buildAcceptedPicturePath(input.recipientId, input.shareId, input.now ?? new Date());
    const { data: uploaded, error: uploadError } = await supabase.storage
      .from(CUSTOM_IMAGE_BUCKET)
      .upload(target, bytes, { cacheControl: "3600", contentType: STORED_IMAGE_TYPE, upsert: false });
    if (uploadError || !uploaded?.path) {
      logPictureProblem("accept upload", uploadError);
      return { ok: false, kind: "picture_upload_failed" };
    }
    return { ok: true, path: uploaded.path };
  } catch (error) {
    logPictureProblem("accept", error);
    return { ok: false, kind: "picture_upload_failed" };
  }
}

async function removeQuietly(supabase: SupabaseClient, path: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage.from(CUSTOM_IMAGE_BUCKET).remove([path]);
    if (error) logPictureProblem("remove", error);
    return !error;
  } catch (error) {
    logPictureProblem("remove", error);
    return false;
  }
}

/** Best effort: the incoming file of ONE share (the path is built from ids, never taken from the client). */
export async function removeIncomingPicture(supabase: SupabaseClient, recipientId: string, shareId: string): Promise<boolean> {
  try {
    return await removeQuietly(supabase, buildIncomingPicturePath(recipientId, shareId));
  } catch {
    return false;
  }
}

/** Best effort: one of the caller's OWN picture files (for example the copy made for an accept that then failed). */
export async function removeOwnPicture(supabase: SupabaseClient, userId: string, path: string): Promise<boolean> {
  if (!isOwnImagePath(userId, path)) return false;
  return removeQuietly(supabase, path);
}

/** Best effort: the incoming files of purged shares. Anything that is not an incoming path is ignored. */
export async function removePurgedPictures(supabase: SupabaseClient, paths: readonly string[]): Promise<void> {
  const incoming = paths.filter((path) => isIncomingPicturePath(path));
  if (incoming.length === 0) return;
  try {
    const { error } = await supabase.storage.from(CUSTOM_IMAGE_BUCKET).remove(incoming);
    if (error) logPictureProblem("purge remove", error);
  } catch (error) {
    logPictureProblem("purge remove", error);
  }
}
