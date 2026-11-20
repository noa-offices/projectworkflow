import { GALLERY_MESSAGES } from "./gallery";
import type { GalleryAddItem } from "./gallery-service";

/**
 * The pick flow of "Add from Gallery": load the saved setup of the chosen item, hand it to the existing replay (onChoose), and report a
 * plain-words message when it cannot be opened. PURE: the action and the replay are passed in. No price is read or passed; the setup is
 * only ids and neutral spec overrides.
 */
export const GALLERY_PICK_MESSAGES = {
  unavailable: "This product is no longer available.",
  notFound: "This gallery item could not be found.",
  failed: "Could not open this item. Please try again.",
} as const;

type FetchResult = { ok: true; item: GalleryAddItem } | { ok: false; message: string };

export function galleryPickMessage(serverMessage: string): string {
  if (serverMessage === GALLERY_MESSAGES.product_unavailable) return GALLERY_PICK_MESSAGES.unavailable;
  if (serverMessage === GALLERY_MESSAGES.item_not_found) return GALLERY_PICK_MESSAGES.notFound;
  return GALLERY_PICK_MESSAGES.failed;
}

/** `{ ok: true }` means the configurator took over (close the dialog); otherwise show `message` and keep the dialog open. */
export async function openGalleryPick(
  id: string,
  fetchItem: (input: { id: string }) => Promise<FetchResult>,
  onChoose: (setup: GalleryAddItem["setup"]) => string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const result = await fetchItem({ id });
    if (!result.ok) return { ok: false, message: galleryPickMessage(result.message) };
    const problem = onChoose(result.item.setup);
    return problem ? { ok: false, message: problem } : { ok: true };
  } catch {
    return { ok: false, message: GALLERY_PICK_MESSAGES.failed };
  }
}
