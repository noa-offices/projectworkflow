"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { distinctBrands } from "./custom-brands";
import { CUSTOM_IMAGE_BUCKET } from "./custom-item-image";
import type { CustomItemFieldErrors } from "./custom-item";
import { listCustomItemsForUser, loadCustomItemForUser, uploadCustomItemImageForUser } from "./saved-custom-items-service";
import {
  SHARE_PICTURE_URL_SECONDS,
  isIncomingPicturePath,
  parsePictureMode,
  shareMessage,
  validateAcceptCustomItem,
  validateAcceptSetup,
  validateSendInput,
  type IncomingShare,
  type IncomingShareView,
  type SentShare,
  type ShareMessageKind,
  type ShareTarget,
} from "./shares";
import {
  copyIncomingPictureForAccept,
  removeIncomingPicture,
  removeOwnPicture,
  removePurgedPictures,
  transferPictureForSend,
} from "./shares-picture";
import {
  acceptCustomItemShare,
  acceptSetupShare,
  countPendingIncoming,
  dismissShare,
  listIncomingShares,
  listSentShares,
  loadIncomingShare,
  loadSentShareRouting,
  purgeFinishedShares,
  searchShareTargets,
  sendShare,
  unsendShare,
} from "./shares-service";
import { isUuid } from "./recipe";

// Server Actions are public POST endpoints: every action authenticates FIRST with requireActiveUser, takes the user from
// the SESSION (never from client input), uses the CALLER's Supabase client (RLS and storage policies stay on) and never an
// admin client. Every change to a share goes through the database functions in shares-service.ts.
// An action never throws to the browser: it returns { ok: true, ... } or { ok: false, message } with a message from
// SHARE_MESSAGES (or IMAGE_MESSAGES / the form validators for picture and field problems). Raw database text never leaves the server.
const MY_COLLECTION_PATH = "/products/my-collection";

export type ShareActionFailure = { ok: false; message: string; fieldErrors?: CustomItemFieldErrors };

function failure(kind: ShareMessageKind, problem?: unknown): ShareActionFailure {
  // A sign-in redirect thrown by requireActiveUser becomes the "not allowed" message instead of a raw exception.
  const digest = (problem as { digest?: unknown } | null)?.digest;
  const redirected = typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
  try {
    if (problem !== undefined && !redirected) console.error("my collection share action failed", problem instanceof Error ? problem.name : typeof problem);
  } catch {
    // logging must never fail an action
  }
  return { ok: false, message: shareMessage(redirected ? "not_allowed" : kind) };
}

export async function searchShareTargetsAction(query: string): Promise<{ ok: true; targets: ShareTarget[] } | ShareActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await searchShareTargets(supabase, String(query ?? ""));
    return result.ok ? { ok: true, targets: result.targets } : failure(result.kind);
  } catch (problem) {
    return failure("unknown", problem);
  }
}

/**
 * Sends a COPY of one of the caller's own items. The database builds the snapshot from the caller's own row and checks
 * the recipient, the limits and (for a setup) that the product is usable. For a custom item with a picture the picture is
 * then transferred; if that fails the share STILL goes through and the sender gets a pictureNote.
 */
export async function sendShareAction(input: { kind: string; itemId: string; recipientId: string; note?: string | null }): Promise<{ ok: true; shareId: string; pictureNote?: string } | ShareActionFailure> {
  try {
    const { user } = await requireActiveUser();
    const checked = validateSendInput(input);
    if (!checked.ok) return failure(checked.kind);
    const supabase = await createClient();

    // The item is read under the caller's own session (owner filter + RLS): somebody else's id is "not found".
    let imagePath: string | null = null;
    if (checked.value.kind === "custom_item") {
      const loaded = await loadCustomItemForUser(supabase, user.id, checked.value.itemId);
      if (!loaded.ok) return failure("item_not_found");
      imagePath = loaded.item.imagePath ?? null;
    }

    const sent = await sendShare(supabase, checked.value);
    if (!sent.ok) return failure(sent.kind);

    let pictureNote: string | undefined;
    if (imagePath) {
      const transferred = await transferPictureForSend(supabase, { senderId: user.id, imagePath, recipientId: checked.value.recipientId, shareId: sent.shareId });
      if (!transferred.attached && transferred.note) pictureNote = transferred.note;
    }
    revalidatePath(MY_COLLECTION_PATH);
    return { ok: true, shareId: sent.shareId, ...(pictureNote ? { pictureNote } : {}) };
  } catch (problem) {
    return failure("unknown", problem);
  }
}

/** The sender takes back a share that is still pending. The incoming picture file is removed best effort. */
export async function unsendShareAction(shareId: string): Promise<{ ok: true } | ShareActionFailure> {
  try {
    const { user } = await requireActiveUser();
    if (!isUuid(shareId)) return failure("share_not_found");
    const supabase = await createClient();
    const routing = await loadSentShareRouting(supabase, user.id, shareId);
    const result = await unsendShare(supabase, shareId);
    if (!result.ok) return failure(result.kind);
    if (routing?.hasPicture) await removeIncomingPicture(supabase, routing.recipientId, shareId);
    revalidatePath(MY_COLLECTION_PATH);
    return { ok: true };
  } catch (problem) {
    return failure("unknown", problem);
  }
}

/** The recipient rejects a pending share. Their incoming picture file is removed best effort. */
export async function dismissShareAction(shareId: string): Promise<{ ok: true } | ShareActionFailure> {
  try {
    const { user } = await requireActiveUser();
    if (!isUuid(shareId)) return failure("share_not_found");
    const supabase = await createClient();
    const result = await dismissShare(supabase, shareId);
    if (!result.ok) return failure(result.kind);
    await removeIncomingPicture(supabase, user.id, shareId);
    revalidatePath(MY_COLLECTION_PATH);
    return { ok: true };
  } catch (problem) {
    return failure("unknown", problem);
  }
}

type AcceptCustomInput = {
  shareId?: unknown;
  brand?: unknown;
  name?: unknown;
  code?: unknown;
  spec?: unknown;
  unit?: unknown;
  price?: unknown;
  currency?: unknown;
  pictureMode?: unknown;
  file?: unknown;
};

function readAcceptCustomInput(input: FormData | AcceptCustomInput | null | undefined): AcceptCustomInput {
  if (input instanceof FormData) {
    const text = (key: string) => {
      const value = input.get(key);
      return typeof value === "string" ? value : undefined;
    };
    return { shareId: text("shareId"), brand: text("brand"), name: text("name"), code: text("code"), spec: text("spec"), unit: text("unit"), price: text("price"), currency: text("currency"), pictureMode: text("pictureMode"), file: input.get("file") };
  }
  return input ?? {};
}

/**
 * The recipient adds a shared custom item to their own collection, with their own edits (brand, name, code, specification,
 * unit, price, currency). The edits are checked with the same validators as the My Collection form. Picture: "keep" copies
 * the sender's picture into the recipient's own folder, "remove" saves without one, "replace" uses a new (browser-compressed)
 * file. Accepting twice is harmless: the database returns the same item id. A picture made for an accept that fails (or that
 * lost a race) is removed again.
 */
export async function acceptCustomItemShareAction(input: FormData | AcceptCustomInput): Promise<{ ok: true; itemId: string } | ShareActionFailure> {
  try {
    const { user } = await requireActiveUser();
    const raw = readAcceptCustomInput(input);
    if (!isUuid(raw.shareId)) return failure("share_not_found");
    const mode = parsePictureMode(raw.pictureMode);
    if (!mode) return failure("invalid_request");
    const supabase = await createClient();

    const brands = distinctBrands(await listCustomItemsForUserSafe(supabase, user.id));
    const checked = validateAcceptCustomItem({ brandName: raw.brand, itemName: raw.name, itemCode: raw.code, specification: raw.spec, unitLabel: raw.unit, sellingPrice: raw.price, currency: raw.currency }, brands);
    if (!checked.ok) return { ok: false, message: checked.error, fieldErrors: checked.fieldErrors };

    const share = await loadIncomingShare(supabase, user.id, raw.shareId);
    if (!share || share.kind !== "custom_item") return failure("share_not_found");
    if (share.status !== "pending" && share.status !== "accepted") return failure("no_longer_available");

    // Already accepted (double click, second tab): no picture work; the database returns the same item id.
    let imagePath: string | null = null;
    let madeCopy = false;
    if (share.status === "pending") {
      if (mode === "keep" && share.picturePath) {
        const copied = await copyIncomingPictureForAccept(supabase, { recipientId: user.id, shareId: share.id, picturePath: share.picturePath });
        if (!copied.ok || !copied.path) return failure(copied.ok ? "unknown" : copied.kind);
        imagePath = copied.path;
        madeCopy = true;
      } else if (mode === "replace") {
        const file = raw.file;
        if (!(file instanceof File)) return failure("picture_invalid");
        const uploaded = await uploadCustomItemImageForUser(supabase, user.id, file);
        if (!uploaded.ok) return { ok: false, message: uploaded.error };
        imagePath = uploaded.path;
        madeCopy = true;
      }
    }

    const accepted = await acceptCustomItemShare(supabase, share.id, checked.value, imagePath);
    if (!accepted.ok) {
      if (madeCopy && imagePath) await removeOwnPicture(supabase, user.id, imagePath);
      return failure(accepted.kind);
    }
    if (madeCopy && imagePath) await dropUnusedCopy(supabase, user.id, accepted.itemId, imagePath);
    if (share.picturePath) await removeIncomingPicture(supabase, user.id, share.id);
    revalidatePath(MY_COLLECTION_PATH);
    return { ok: true, itemId: accepted.itemId };
  } catch (problem) {
    return failure("unknown", problem);
  }
}

async function listCustomItemsForUserSafe(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  try {
    return await listCustomItemsForUser(supabase, userId);
  } catch {
    return [];
  }
}

/** Two tabs accepting at once: only one item keeps its copy. If the returned item does not use OUR copy, delete it. */
async function dropUnusedCopy(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, itemId: string, ourPath: string) {
  try {
    const { data } = await supabase.from("saved_custom_items").select("image_path").eq("id", itemId).eq("owner_id", userId).maybeSingle();
    // Only when the row was read AND uses another picture. If the row cannot be read, the copy is kept (never guess).
    if (data && (data as { image_path?: unknown }).image_path !== ourPath) await removeOwnPicture(supabase, userId, ourPath);
  } catch {
    // best effort: a stray file is harmless and private to the recipient
  }
}

/** The recipient adds a shared setup. Only the name and note can be edited; brand, product and recipe come from the share. */
export async function acceptSetupShareAction(input: { shareId: string; setupName: string; note?: string | null }): Promise<{ ok: true; setupId: string } | ShareActionFailure> {
  try {
    await requireActiveUser();
    if (!isUuid(input?.shareId)) return failure("share_not_found");
    const checked = validateAcceptSetup({ setupName: input.setupName, note: input.note });
    if (!checked.ok) return { ok: false, message: checked.error };
    const supabase = await createClient();
    const accepted = await acceptSetupShare(supabase, input.shareId, checked.setupName, checked.note);
    if (!accepted.ok) return failure(accepted.kind);
    revalidatePath(MY_COLLECTION_PATH);
    return { ok: true, setupId: accepted.setupId };
  } catch (problem) {
    return failure("unknown", problem);
  }
}

/** Lazy 30-day cleanup before a list. A purge failure never breaks the list. */
async function purgeQuietly(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    await removePurgedPictures(supabase, await purgeFinishedShares(supabase));
  } catch {
    // the list still loads
  }
}

/**
 * The browser never gets a storage path: a pending share's picture becomes a short-lived signed link (10 minutes), made with
 * the recipient's OWN client (they own the incoming folder). A signing problem only means "no picture shown".
 */
async function toIncomingViews(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, shares: IncomingShare[]): Promise<IncomingShareView[]> {
  const wanted = shares.flatMap((share) => (share.status === "pending" && share.picturePath && isIncomingPicturePath(share.picturePath, userId, share.id) ? [share.picturePath] : []));
  const urls = new Map<string, string>();
  if (wanted.length > 0) {
    try {
      const { data } = await supabase.storage.from(CUSTOM_IMAGE_BUCKET).createSignedUrls(wanted, SHARE_PICTURE_URL_SECONDS);
      for (const entry of data ?? []) if (entry.path && entry.signedUrl && wanted.includes(entry.path)) urls.set(entry.path, entry.signedUrl);
    } catch {
      // the share is still listed, just without its picture
    }
  }
  return shares.map(({ picturePath, ...rest }) => ({ ...rest, hasPicture: Boolean(picturePath), pictureUrl: picturePath ? urls.get(picturePath) ?? null : null }));
}

export async function listIncomingSharesAction(): Promise<{ ok: true; shares: IncomingShareView[] } | ShareActionFailure> {
  try {
    const { user } = await requireActiveUser();
    const supabase = await createClient();
    await purgeQuietly(supabase);
    const result = await listIncomingShares(supabase, user.id);
    return result.ok ? { ok: true, shares: await toIncomingViews(supabase, user.id, result.shares) } : failure(result.kind);
  } catch (problem) {
    return failure("unknown", problem);
  }
}

export async function listSentSharesAction(): Promise<{ ok: true; shares: SentShare[] } | ShareActionFailure> {
  try {
    const { user } = await requireActiveUser();
    const supabase = await createClient();
    await purgeQuietly(supabase);
    const result = await listSentShares(supabase, user.id);
    return result.ok ? { ok: true, shares: result.shares } : failure(result.kind);
  } catch (problem) {
    return failure("unknown", problem);
  }
}

/** Cheap count for the sidebar badge. */
export async function pendingShareCountAction(): Promise<{ ok: true; count: number } | ShareActionFailure> {
  try {
    const { user } = await requireActiveUser();
    const supabase = await createClient();
    const result = await countPendingIncoming(supabase, user.id);
    return result.ok ? { ok: true, count: result.count } : failure(result.kind);
  } catch (problem) {
    return failure("unknown", problem);
  }
}
