/**
 * My Collection service. No "use server", no auth import: callers (the server actions) authenticate with
 * requireActiveUser and pass the SESSION user id plus the CALLER's own Supabase client (so RLS applies).
 * Never pass an elevated (RLS-bypassing) client here. Owner is always the passed userId, never client input.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SAVED_SETUP_NAME_MAX,
  buildRecipe,
  isUuid,
  validateRecipeShape,
  type SavedSetupPlainState,
} from "./recipe";
import { isSetupUsable } from "./usable";

export type SetupActionResult = { ok: true; id?: string; count?: number } | { ok: false; error: string };

export type SaveSetupInput = {
  templateId: string;
  setupName: string;
  note?: string | null;
  state: SavedSetupPlainState;
};

export type SetupListItem = {
  id: string;
  brandName: string;
  productName: string;
  setupName: string;
  note: string | null;
  usable: boolean;
  removed: boolean;
  useCount: number;
  updatedAt: string;
};

const NOT_AVAILABLE = "This product is not available to you or is no longer active.";

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= SAVED_SETUP_NAME_MAX ? trimmed : null;
}

export async function saveSetupForUser(
  supabase: SupabaseClient,
  userId: string,
  input: SaveSetupInput,
): Promise<SetupActionResult> {
  const setupName = cleanName(input?.setupName);
  if (!setupName) return { ok: false, error: `Give the setup a name (1 to ${SAVED_SETUP_NAME_MAX} characters).` };
  if (!isUuid(input.templateId)) return { ok: false, error: NOT_AVAILABLE };
  // The template id inside the state can never differ from the one being saved.
  const { recipe, specOverrides } = buildRecipe({ ...input.state, templateId: input.templateId });
  const shape = validateRecipeShape(recipe, specOverrides);
  if (!shape.ok) return { ok: false, error: shape.error };

  // Read under the CALLER's RLS. Not readable, missing or inactive => refuse.
  const { data: template, error: templateError } = await supabase
    .from("product_templates")
    .select("id,brand_id,template_name,is_active,lifecycle_status,pricing_version")
    .eq("id", input.templateId)
    .maybeSingle();
  if (templateError || !template) return { ok: false, error: NOT_AVAILABLE };
  if (!isSetupUsable({ template_id: template.id }, template)) return { ok: false, error: NOT_AVAILABLE };

  let brandName = "";
  if (template.brand_id) {
    const { data: brand } = await supabase.from("brands").select("name").eq("id", template.brand_id).maybeSingle();
    brandName = typeof brand?.name === "string" ? brand.name.trim() : "";
  }

  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  const { data, error } = await supabase
    .from("saved_setups")
    .insert({
      owner_id: userId,
      template_id: template.id,
      brand_id: template.brand_id ?? null,
      brand_name: brandName || "Other",
      product_name: String(template.template_name ?? "").trim() || "Product",
      setup_name: setupName,
      note,
      recipe,
      recipe_version: recipe.recipe_version,
      spec_overrides: specOverrides,
      template_pricing_version_at_save: template.pricing_version ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "The setup could not be saved." };
  return { ok: true, id: String(data.id) };
}

export async function renameSetupForUser(
  supabase: SupabaseClient,
  userId: string,
  setupId: string,
  setupName: string,
): Promise<SetupActionResult> {
  const name = cleanName(setupName);
  if (!name) return { ok: false, error: `Give the setup a name (1 to ${SAVED_SETUP_NAME_MAX} characters).` };
  if (!isUuid(setupId)) return { ok: false, error: "Setup not found." };
  const { data, error } = await supabase
    .from("saved_setups")
    .update({ setup_name: name })
    .eq("id", setupId)
    .eq("owner_id", userId)
    .select("id");
  if (error || !data || data.length === 0) return { ok: false, error: "Setup not found." };
  return { ok: true, id: setupId };
}

export async function deleteSetupForUser(
  supabase: SupabaseClient,
  userId: string,
  setupId: string,
): Promise<SetupActionResult> {
  if (!isUuid(setupId)) return { ok: false, error: "Setup not found." };
  const { data, error } = await supabase
    .from("saved_setups")
    .delete()
    .eq("id", setupId)
    .eq("owner_id", userId)
    .select("id");
  if (error || !data || data.length === 0) return { ok: false, error: "Setup not found." };
  return { ok: true, id: setupId };
}

type SetupRow = {
  id: string;
  brand_name: string;
  product_name: string;
  setup_name: string;
  note: string | null;
  template_id: string | null;
  use_count: number | null;
  updated_at: string;
  product_templates: { is_active: boolean | null; lifecycle_status: string | null } | Array<{ is_active: boolean | null; lifecycle_status: string | null }> | null;
};

/** The caller's own setups (owner filter + RLS), with usability computed by isSetupUsable. */
export async function listSetupsForUser(supabase: SupabaseClient, userId: string): Promise<SetupListItem[]> {
  const { data, error } = await supabase
    .from("saved_setups")
    .select("id,brand_name,product_name,setup_name,note,template_id,use_count,updated_at,product_templates(is_active,lifecycle_status)")
    .eq("owner_id", userId)
    .eq("archived", false)
    .order("brand_name", { ascending: true })
    .order("product_name", { ascending: true })
    .order("setup_name", { ascending: true });
  if (error || !data) return [];
  return (data as unknown as SetupRow[]).map((row) => {
    const template = Array.isArray(row.product_templates) ? row.product_templates[0] ?? null : row.product_templates;
    return {
      id: row.id,
      brandName: row.brand_name,
      productName: row.product_name,
      setupName: row.setup_name,
      note: row.note,
      usable: isSetupUsable(row, template),
      removed: !row.template_id,
      useCount: row.use_count ?? 0,
      updatedAt: row.updated_at,
    };
  });
}

/** Deletes ONLY the caller's own removed/unavailable setups. */
export async function clearRemovedSetupsForUser(supabase: SupabaseClient, userId: string): Promise<SetupActionResult> {
  const items = await listSetupsForUser(supabase, userId);
  const ids = items.filter((item) => !item.usable).map((item) => item.id);
  if (ids.length === 0) return { ok: true, count: 0 };
  const { data, error } = await supabase
    .from("saved_setups")
    .delete()
    .in("id", ids)
    .eq("owner_id", userId)
    .select("id");
  if (error) return { ok: false, error: "Removed setups could not be cleared." };
  return { ok: true, count: data?.length ?? 0 };
}
