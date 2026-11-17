/**
 * My Collection custom items service. No "use server", no auth import: callers (the server actions) authenticate
 * with requireActiveUser and pass the SESSION user id plus the CALLER's own Supabase client (so RLS applies).
 * Never pass an elevated (RLS-bypassing) client here. Owner is always the passed userId, never client input.
 * owner_id, source_item_id and shared_by are never read from input and never updated.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "./recipe";
import {
  firstCustomItemError,
  validateCustomItem,
  type CustomItemFieldErrors,
  type CustomItemInput,
  type CustomItemListItem,
} from "./custom-item";

export type CustomItemActionResult =
  | { ok: true; id?: string; count?: number }
  | { ok: false; error: string; fieldErrors?: CustomItemFieldErrors };

const NOT_FOUND = "Item not found.";

export async function createCustomItemForUser(
  supabase: SupabaseClient,
  userId: string,
  input: CustomItemInput,
): Promise<CustomItemActionResult> {
  const checked = validateCustomItem(input);
  if (!checked.ok) return { ok: false, error: firstCustomItemError(checked.errors), fieldErrors: checked.errors };
  const { data, error } = await supabase
    .from("saved_custom_items")
    .insert({ owner_id: userId, ...checked.value, price_saved_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "The item could not be saved." };
  return { ok: true, id: String(data.id) };
}

export async function updateCustomItemForUser(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  input: CustomItemInput,
): Promise<CustomItemActionResult> {
  if (!isUuid(itemId)) return { ok: false, error: NOT_FOUND };
  const checked = validateCustomItem(input);
  if (!checked.ok) return { ok: false, error: firstCustomItemError(checked.errors), fieldErrors: checked.errors };

  const { data: current, error: readError } = await supabase
    .from("saved_custom_items")
    .select("id,selling_price,currency")
    .eq("id", itemId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (readError || !current) return { ok: false, error: NOT_FOUND };

  // The saved-price date moves only when the price or the currency actually changed.
  const priceChanged =
    Number(current.selling_price) !== checked.value.selling_price || String(current.currency) !== checked.value.currency;
  const { data, error } = await supabase
    .from("saved_custom_items")
    .update({ ...checked.value, ...(priceChanged ? { price_saved_at: new Date().toISOString() } : {}) })
    .eq("id", itemId)
    .eq("owner_id", userId)
    .select("id");
  if (error || !data || data.length === 0) return { ok: false, error: "The item could not be saved." };
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
    .select("id");
  if (error || !data || data.length === 0) return { ok: false, error: NOT_FOUND };
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
};

/** The caller's own custom items (owner filter + RLS). */
export async function listCustomItemsForUser(supabase: SupabaseClient, userId: string): Promise<CustomItemListItem[]> {
  const { data, error } = await supabase
    .from("saved_custom_items")
    .select("id,brand_name,item_name,item_code,specification,unit_label,selling_price,currency,price_saved_at,created_at,last_used_at,use_count")
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
  }));
}

/** Loads ONE of the caller's own items (owner filter + RLS). Another user's item is "not found". */
export async function loadCustomItemForUser(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
): Promise<{ ok: true; item: CustomItemListItem } | { ok: false; error: string }> {
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
