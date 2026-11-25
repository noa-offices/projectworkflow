import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isStagedImagePath, STAGED_IMAGE_BUCKET } from "@/lib/products/staged-image-upload";

/** Reads a browser-staged image back with the user's own session (RLS applies) so the existing save helpers can validate it. */
export async function loadStagedReferenceFile(path: string): Promise<File> {
  if (!isStagedImagePath(path)) throw new Error("Staged image path is invalid.");
  const { data, error } = await (await createClient()).storage.from(STAGED_IMAGE_BUCKET).download(path);
  if (error || !data) throw new Error("Staged image could not be read.");
  return new File([data], path.split("/").pop() ?? "image.webp", { type: data.type || "image/webp" });
}
/** Best effort: a leftover staged object is harmless and never blocks the save. */
export async function removeStagedReferenceFile(path: string) {
  try { if (isStagedImagePath(path)) await (await createClient()).storage.from(STAGED_IMAGE_BUCKET).remove([path]); } catch { /* ignore */ }
}
