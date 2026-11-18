/**
 * My Collection custom items service. No "use server", no auth import: callers (the server actions) authenticate
 * with requireActiveUser and pass the SESSION user id plus the CALLER's own Supabase client (so RLS applies).
 * Never pass an elevated (RLS-bypassing) client here. Owner is always the passed userId, never client input.
 * owner_id, source_item_id and shared_by are never read from input and never updated.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "./recipe";
import { distinctBrands, normaliseBrandKey, resolveBrandInput } from "./custom-brands";
import {
  CUSTOM_IMAGE_BUCKET,
  CUSTOM_IMAGE_MAX_BYTES,
  QUOTE_IMAGE_BUCKET,
  buildImagePath,
  buildQuoteRowImagePath,
  imageNameFromPath,
  imageTypeFromPath,
  isOwnImagePath,
  quoteImageStoragePath,
  quoteRowImageRef,
  validateImageFile,
  type CustomItemWithImage,
} from "./custom-item-image";
import {
  firstCustomItemError,
  validateCustomItem,
  type CustomItemFieldErrors,
  type CustomItemInput,
} from "./custom-item";

/** Create/update input: the picture path is ONLY ever one this owner's upload returned (checked, never trusted). */
export type CustomItemSaveInput = CustomItemInput & { imagePath?: unknown };

export type CustomItemActionResult =
  | { ok: true; id?: string; count?: number }
  | { ok: false; error: string; fieldErrors?: CustomItemFieldErrors };

const NOT_FOUND = "Item not found.";

export async function createCustomItemForUser(
  supabase: SupabaseClient,
  userId: string,
  input: CustomItemSaveInput,
): Promise<CustomItemActionResult> {
  const checked = validateCustomItem(input);
  if (!checked.ok) return { ok: false, error: firstCustomItemError(checked.errors), fieldErrors: checked.errors };
  const picture = checkedImagePath(userId, input.imagePath);
  if (!picture.ok) return { ok: false, error: picture.error };
  // A brand matching one of the owner's existing brands (ignoring case and extra spaces) reuses that spelling.
  const brand = resolveBrandInput(checked.value.brand_name, distinctBrands(await listCustomItemsForUser(supabase, userId)));
  const value = { ...checked.value, brand_name: brand.ok ? brand.name : checked.value.brand_name };
  const { data, error } = await supabase
    .from("saved_custom_items")
    .insert({ owner_id: userId, ...value, ...(picture.path ? { image_path: picture.path } : {}), price_saved_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error || !data) {
    // No orphan: the picture that was just uploaded for this save is removed (best effort).
    if (picture.path) await removeCustomImageFile(supabase, userId, picture.path);
    return { ok: false, error: "The item could not be saved." };
  }
  return { ok: true, id: String(data.id) };
}

export async function updateCustomItemForUser(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  input: CustomItemSaveInput,
): Promise<CustomItemActionResult> {
  if (!isUuid(itemId)) return { ok: false, error: NOT_FOUND };
  const checked = validateCustomItem(input);
  if (!checked.ok) return { ok: false, error: firstCustomItemError(checked.errors), fieldErrors: checked.errors };
  const picture = checkedImagePath(userId, input.imagePath);
  if (!picture.ok) return { ok: false, error: picture.error };

  const { data: current, error: readError } = await supabase
    .from("saved_custom_items")
    .select("id,selling_price,currency,image_path")
    .eq("id", itemId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (readError || !current) return { ok: false, error: NOT_FOUND };
  const oldPath = typeof current.image_path === "string" && current.image_path ? current.image_path : null;
  // undefined = leave the picture as it is; null = remove it; a path = replace it.
  const pictureChange = input.imagePath === undefined ? {} : { image_path: picture.path };
  const newPath = input.imagePath === undefined ? oldPath : picture.path;

  // The saved-price date moves only when the price or the currency actually changed.
  const priceChanged =
    Number(current.selling_price) !== checked.value.selling_price || String(current.currency) !== checked.value.currency;
  // Existing spelling is reused, but never the item's own old spelling (so a case-only fix of the only item works).
  const others = (await listCustomItemsForUser(supabase, userId)).filter((entry) => entry.id !== itemId);
  const brand = resolveBrandInput(checked.value.brand_name, distinctBrands(others));
  const value = { ...checked.value, brand_name: brand.ok ? brand.name : checked.value.brand_name };
  const { data, error } = await supabase
    .from("saved_custom_items")
    .update({ ...value, ...pictureChange, ...(priceChanged ? { price_saved_at: new Date().toISOString() } : {}) })
    .eq("id", itemId)
    .eq("owner_id", userId)
    .select("id");
  if (error || !data || data.length === 0) {
    // No orphan: a picture uploaded for this failed save is removed; the item keeps its old picture.
    if (picture.path && picture.path !== oldPath) await removeCustomImageFile(supabase, userId, picture.path);
    return { ok: false, error: "The item could not be saved." };
  }
  // The row change is done: the replaced or removed old file goes now (best effort, never blocks the save).
  if (oldPath && oldPath !== newPath) await removeCustomImageFile(supabase, userId, oldPath);
  return { ok: true, id: itemId };
}

/** Never blocked by anything: only the owner's own row is matched. */
export async function deleteCustomItemForUser(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
): Promise<CustomItemActionResult> {
  if (!isUuid(itemId)) return { ok: false, error: NOT_FOUND };
  const { data, error } = await supabase
    .from("saved_custom_items")
    .delete()
    .eq("id", itemId)
    .eq("owner_id", userId)
    .select("id,image_path");
  if (error || !data || data.length === 0) return { ok: false, error: NOT_FOUND };
  // The row is gone: its picture file is removed best effort. A failed removal never fails the delete.
  const picture = (data[0] as { image_path?: unknown }).image_path;
  if (typeof picture === "string" && picture) await removeCustomImageFile(supabase, userId, picture);
  return { ok: true, id: itemId };
}

type CustomItemRow = {
  id: string;
  brand_name: string;
  item_name: string;
  item_code: string | null;
  specification: string | null;
  unit_label: string;
  selling_price: number | string;
  currency: string;
  price_saved_at: string | null;
  created_at: string;
  last_used_at: string | null;
  use_count: number | null;
  image_path?: string | null;
};

/** The caller's own custom items (owner filter + RLS). */
export async function listCustomItemsForUser(supabase: SupabaseClient, userId: string): Promise<CustomItemWithImage[]> {
  const { data, error } = await supabase
    .from("saved_custom_items")
    .select("id,brand_name,item_name,item_code,specification,unit_label,selling_price,currency,price_saved_at,created_at,last_used_at,use_count,image_path")
    .eq("owner_id", userId)
    .order("brand_name", { ascending: true })
    .order("item_name", { ascending: true });
  if (error || !data) return [];
  return (data as unknown as CustomItemRow[]).map((row) => ({
    id: row.id,
    brandName: row.brand_name,
    itemName: row.item_name,
    itemCode: row.item_code,
    specification: row.specification,
    unitLabel: row.unit_label,
    sellingPrice: Number(row.selling_price),
    currency: row.currency,
    priceSavedAt: row.price_saved_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
    useCount: row.use_count ?? 0,
    ...(row.image_path ? { imagePath: row.image_path } : {}),
  }));
}

/** Loads ONE of the caller's own items (owner filter + RLS). Another user's item is "not found". */
export async function loadCustomItemForUser(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
): Promise<{ ok: true; item: CustomItemWithImage } | { ok: false; error: string }> {
  if (!isUuid(itemId)) return { ok: false, error: NOT_FOUND };
  const items = await listCustomItemsForUser(supabase, userId);
  const item = items.find((entry) => entry.id === itemId);
  return item ? { ok: true, item } : { ok: false, error: NOT_FOUND };
}

/** Best effort, owner-only. A failure never blocks adding the item to a quote. */
export async function markCustomItemUsedForUser(supabase: SupabaseClient, userId: string, itemId: string): Promise<CustomItemActionResult> {
  try {
    if (!isUuid(itemId)) return { ok: false, error: NOT_FOUND };
    const { data: current } = await supabase
      .from("saved_custom_items")
      .select("use_count")
      .eq("id", itemId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (!current) return { ok: false, error: NOT_FOUND };
    const { data, error } = await supabase
      .from("saved_custom_items")
      .update({ use_count: Number((current as { use_count: number | null }).use_count ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("owner_id", userId)
      .select("id");
    if (error || !data || data.length === 0) return { ok: false, error: NOT_FOUND };
    return { ok: true, id: itemId };
  } catch {
    return { ok: false, error: "Usage could not be recorded." };
  }
}

export type RenameBrandResult = { ok: true; count: number; brandName: string } | { ok: false; error: string };

/**
 * Renames a brand on ALL of the caller's items with that brand: one UPDATE restricted to the owner's matching ids
 * (caller's client, RLS applies). If the new name matches ANOTHER existing brand (ignoring case and spaces), the items
 * merge into that brand's spelling. Only brand_name is written, so no saved-price date moves.
 */
export async function renameCustomBrandForUser(
  supabase: SupabaseClient,
  userId: string,
  fromBrand: unknown,
  toBrand: unknown,
): Promise<RenameBrandResult> {
  const items = await listCustomItemsForUser(supabase, userId);
  const fromKey = normaliseBrandKey(fromBrand);
  const ids = items.filter((item) => normaliseBrandKey(item.brandName) === fromKey).map((item) => item.id);
  if (!fromKey || ids.length === 0) return { ok: false, error: "Brand not found." };
  const otherBrands = distinctBrands(items.filter((item) => normaliseBrandKey(item.brandName) !== fromKey));
  const target = resolveBrandInput(toBrand, otherBrands);
  if (!target.ok) return { ok: false, error: target.error };
  const { data, error } = await supabase
    .from("saved_custom_items")
    .update({ brand_name: target.name })
    .eq("owner_id", userId)
    .in("id", ids)
    .select("id");
  if (error || !data) return { ok: false, error: "The brand could not be renamed." };
  return { ok: true, count: data.length, brandName: target.name };
}

// ── Pictures (PR 2b-3) ───────────────────────────────────────────────────────────────────────────────────────
// Every function takes the CALLER's own Supabase client (storage policies keep the owner folder private) and the
// SESSION user id. Paths are built here from that id; a path sent by a client is only checked with isOwnImagePath.
// No admin client. Removing a file is always best effort: it never throws and never fails the action around it.

function checkedImagePath(userId: string, value: unknown): { ok: true; path: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, path: null };
  if (!isOwnImagePath(userId, value)) return { ok: false, error: "The picture is not valid. Add it again." };
  return { ok: true, path: value };
}

/** Best effort. Only a path inside the owner's own folder is ever removed. Returns whether it was removed. */
export async function removeCustomImageFile(supabase: SupabaseClient, userId: string, path: string): Promise<boolean> {
  try {
    if (!isOwnImagePath(userId, path)) return false;
    const { error } = await supabase.storage.from(CUSTOM_IMAGE_BUCKET).remove([path]);
    return !error;
  } catch {
    return false;
  }
}

/** For a picture the user dropped before saving: removed only if none of the owner's items uses it. */
export async function removeUnusedCustomImageForUser(supabase: SupabaseClient, userId: string, path: unknown): Promise<boolean> {
  try {
    if (!isOwnImagePath(userId, path)) return false;
    const { data } = await supabase.from("saved_custom_items").select("id").eq("owner_id", userId).eq("image_path", path).limit(1);
    if (data && data.length > 0) return false;
    return await removeCustomImageFile(supabase, userId, path);
  } catch {
    return false;
  }
}

export type ImageFileInput = { type: string; size: number; name: string; arrayBuffer: () => Promise<ArrayBuffer> };
export type ImageUploadResult = { ok: true; path: string } | { ok: false; error: string };

async function putCustomImage(supabase: SupabaseClient, userId: string, body: Uint8Array, name: string, type: string, now: Date): Promise<ImageUploadResult> {
  const path = buildImagePath(userId, crypto.randomUUID(), name, now, type);
  const { data, error } = await supabase.storage.from(CUSTOM_IMAGE_BUCKET).upload(path, body, { cacheControl: "3600", contentType: type, upsert: false });
  if (error || !data?.path) return { ok: false, error: "The picture could not be uploaded. Try again." };
  return { ok: true, path: data.path };
}

/** Upload from the form: type and size are checked here (never trusted from the browser), the path is built here. */
export async function uploadCustomItemImageForUser(supabase: SupabaseClient, userId: string, file: ImageFileInput, now: Date = new Date()): Promise<ImageUploadResult> {
  const checked = validateImageFile(file?.type, file?.size, file?.name);
  if (!checked.ok) return { ok: false, error: checked.error };
  try {
    const body = new Uint8Array(await file.arrayBuffer());
    if (body.byteLength !== file.size || body.byteLength > CUSTOM_IMAGE_MAX_BYTES) return { ok: false, error: "The picture must be 5 MB or smaller." };
    return await putCustomImage(supabase, userId, body, file.name, file.type, now);
  } catch {
    return { ok: false, error: "The picture could not be uploaded. Try again." };
  }
}

/** Quote row picture ("quote-images:quotation-items/...") -> a COPY in the owner's folder of my-collection-images. */
export async function copyQuoteImageToCollectionForUser(supabase: SupabaseClient, userId: string, ref: unknown, now: Date = new Date()): Promise<ImageUploadResult> {
  const source = quoteImageStoragePath(ref);
  if (!source) return { ok: false, error: "This picture cannot be copied." };
  try {
    const { data, error } = await supabase.storage.from(QUOTE_IMAGE_BUCKET).download(source);
    if (error || !data) return { ok: false, error: "The row picture could not be read." };
    const name = imageNameFromPath(source);
    const type = imageTypeFromPath(source) ?? (typeof data.type === "string" ? data.type : "");
    const checked = validateImageFile(type, data.size, name);
    if (!checked.ok) return { ok: false, error: checked.error };
    return await putCustomImage(supabase, userId, new Uint8Array(await data.arrayBuffer()), name, type, now);
  } catch {
    return { ok: false, error: "The picture could not be copied." };
  }
}

/**
 * My Collection picture -> a COPY in quote-images under the NEW row's own path, so a quote row never points at a private
 * My Collection path. Needs the caller to be allowed to write quote-images (the callers check that first).
 */
export async function copyCustomImageToQuoteRowForUser(
  supabase: SupabaseClient,
  userId: string,
  input: { imagePath: unknown; quotationId: string; rowId: string },
  now: Date = new Date(),
): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  if (!isOwnImagePath(userId, input.imagePath)) return { ok: false, error: "This picture cannot be copied." };
  try {
    const { data, error } = await supabase.storage.from(CUSTOM_IMAGE_BUCKET).download(input.imagePath);
    if (error || !data) return { ok: false, error: "The picture could not be read." };
    const name = imageNameFromPath(input.imagePath);
    const type = imageTypeFromPath(input.imagePath) ?? (typeof data.type === "string" ? data.type : "");
    const checked = validateImageFile(type, data.size, name);
    if (!checked.ok) return { ok: false, error: checked.error };
    const target = buildQuoteRowImagePath(input.quotationId, input.rowId, name, now, type);
    const { data: uploaded, error: uploadError } = await supabase.storage
      .from(QUOTE_IMAGE_BUCKET)
      .upload(target, new Uint8Array(await data.arrayBuffer()), { cacheControl: "3600", contentType: type, upsert: false });
    if (uploadError || !uploaded?.path) return { ok: false, error: "The picture could not be copied." };
    return { ok: true, ref: quoteRowImageRef(uploaded.path) };
  } catch {
    return { ok: false, error: "The picture could not be copied." };
  }
}

/**
 * Server builder: after the manual row exists, copy the item's picture into quote-images and set the row's usual picture
 * field ("bucket:path", proposed_image_url_snapshot). Never throws; a failure returns a short note and the row stays
 * without a picture (the copied file is removed again if the row could not be updated).
 */
export async function addCustomItemPictureToQuoteRow(
  supabase: SupabaseClient,
  userId: string,
  input: { imagePath: string | null | undefined; quotationId: string; rowId: string },
): Promise<{ ok: true; attached: boolean } | { ok: false; note: string }> {
  if (!input.imagePath) return { ok: true, attached: false };
  const note = "The picture could not be copied, so the row was added without it.";
  const copied = await copyCustomImageToQuoteRowForUser(supabase, userId, { imagePath: input.imagePath, quotationId: input.quotationId, rowId: input.rowId });
  if (!copied.ok) return { ok: false, note };
  try {
    const { data, error } = await supabase
      .from("quotation_items")
      .update({ proposed_image_url_snapshot: copied.ref })
      .eq("id", input.rowId)
      .eq("quotation_id", input.quotationId)
      .select("id");
    if (!error && data && data.length > 0) return { ok: true, attached: true };
  } catch {
    // fall through to the cleanup below
  }
  try {
    await supabase.storage.from(QUOTE_IMAGE_BUCKET).remove([copied.ref.slice(QUOTE_IMAGE_BUCKET.length + 1)]);
  } catch {
    // best effort
  }
  return { ok: false, note };
}
