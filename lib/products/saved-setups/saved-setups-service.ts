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
import { findSetupDuplicate, type DuplicateInfo } from "./duplicates";
import type { SavedSetupRecipeV1, SavedSetupSpecOverrides } from "./recipe";

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
  createdAt: string;
  lastUsedAt: string | null;
  /** Stored image path (resolved to a URL by the browser's existing image helper). null = placeholder. */
  imagePath: string | null;
  /** The product's main code (the saved configuration's main code, else the product's item code). Display and search only; absent when there is none. */
  productCode?: string;
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

/**
 * The caller's own live setups of ONE template (owner filter + RLS; archived and removed ones are skipped), compared with the
 * canonical recipe. Read-only. A read problem means "no warning", never a failure of the save. The recipe is not returned.
 */
export async function findSetupDuplicateForUser(
  supabase: SupabaseClient,
  userId: string,
  templateId: string,
  recipe: unknown,
  specOverrides: unknown,
): Promise<DuplicateInfo | null> {
  try {
    const { data, error } = await supabase
      .from("saved_setups")
      .select("id,template_id,brand_name,product_name,setup_name,recipe,spec_overrides,archived,created_at")
      .eq("owner_id", userId)
      .eq("template_id", templateId)
      .eq("archived", false);
    if (error || !Array.isArray(data)) return null;
    return findSetupDuplicate(
      { templateId, recipe, specOverrides },
      (data as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        templateId: typeof row.template_id === "string" ? row.template_id : null,
        setupName: String(row.setup_name ?? ""),
        brandName: String(row.brand_name ?? ""),
        productName: String(row.product_name ?? ""),
        recipe: row.recipe,
        specOverrides: row.spec_overrides,
        archived: row.archived === true,
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
      })),
    );
  } catch {
    return null;
  }
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
  created_at: string;
  last_used_at: string | null;
  selected_image?: string | null;
  main_code?: string | null;
  product_templates: { is_active: boolean | null; lifecycle_status: string | null; item_code?: string | null } | Array<{ is_active: boolean | null; lifecycle_status: string | null; item_code?: string | null }> | null;
};

const PROPOSED_IMAGE_FIELDS = Array.from({ length: 20 }, (_, index) => `proposed_image_url_${index + 1}`);
const TEMPLATE_IMAGE_SELECT = ["id", "default_image_url", ...PROPOSED_IMAGE_FIELDS].join(",");

function templateImagePaths(template: Record<string, unknown>): string[] {
  return PROPOSED_IMAGE_FIELDS.flatMap((field) => {
    const value = field === "proposed_image_url_1" ? template[field] ?? template.default_image_url : template[field];
    return typeof value === "string" && value.trim() ? [value] : [];
  });
}

/**
 * One batched query for ALL template ids on the page, under the CALLER's RLS (no elevated client).
 * Picture = the image the user had selected at save time if the template still has it, else the template's
 * main picture (proposed image 1, then default). Unreadable or missing template => no entry => placeholder.
 */
async function templateImagesFor(supabase: SupabaseClient, templateIds: string[]) {
  const byTemplate = new Map<string, Record<string, unknown>>();
  if (templateIds.length === 0) return byTemplate;
  const { data } = await supabase.from("product_templates").select(TEMPLATE_IMAGE_SELECT).in("id", templateIds);
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) byTemplate.set(String(row.id), row);
  return byTemplate;
}

/** Main code for display and search: the saved configuration's main code (for example "EV211"), else the product's item code. */
function productCodeOf(row: { main_code?: string | null }, template: { item_code?: string | null } | null): string {
  const saved = typeof row.main_code === "string" ? row.main_code.trim() : "";
  if (saved) return saved;
  return typeof template?.item_code === "string" ? template.item_code.trim() : "";
}

/** The caller's own setups (owner filter + RLS), with usability computed by isSetupUsable. */
export async function listSetupsForUser(
  supabase: SupabaseClient,
  userId: string,
  options: { withImages?: boolean } = {},
): Promise<SetupListItem[]> {
  const { data, error } = await supabase
    .from("saved_setups")
    .select("id,brand_name,product_name,setup_name,note,template_id,use_count,updated_at,created_at,last_used_at,selected_image:recipe->>selected_image,main_code:recipe->display->>main_code,product_templates(is_active,lifecycle_status,item_code)")
    .eq("owner_id", userId)
    .eq("archived", false)
    .order("brand_name", { ascending: true })
    .order("product_name", { ascending: true })
    .order("setup_name", { ascending: true });
  if (error || !data) return [];
  const rows = data as unknown as SetupRow[];
  const images = options.withImages === false
    ? new Map<string, Record<string, unknown>>()
    : await templateImagesFor(supabase, Array.from(new Set(rows.flatMap((row) => (row.template_id ? [row.template_id] : [])))));
  return rows.map((row) => {
    const template = Array.isArray(row.product_templates) ? row.product_templates[0] ?? null : row.product_templates;
    const templateImages = row.template_id ? images.get(row.template_id) : undefined;
    let imagePath: string | null = null;
    if (templateImages) {
      const available = templateImagePaths(templateImages);
      imagePath = row.selected_image && available.includes(row.selected_image) ? row.selected_image : available[0] ?? null;
    }
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
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at ?? null,
      imagePath,
      ...(productCodeOf(row, template) ? { productCode: productCodeOf(row, template) } : {}),
    };
  });
}

/** Deletes ONLY the caller's own removed/unavailable setups. */
export async function clearRemovedSetupsForUser(supabase: SupabaseClient, userId: string): Promise<SetupActionResult> {
  const items = await listSetupsForUser(supabase, userId, { withImages: false });
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

export type PickerSetup = {
  id: string;
  brandName: string;
  productName: string;
  setupName: string;
  imagePath: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
  /** Main code for display and search (absent when the setup has none). */
  productCode?: string;
};

/** The caller's USABLE setups only, for the "Add from My Collection" picker. Two batched queries in total. */
export async function listUsableSetupsForUser(supabase: SupabaseClient, userId: string): Promise<PickerSetup[]> {
  const items = await listSetupsForUser(supabase, userId);
  return items
    .filter((item) => item.usable)
    .map((item) => ({
      id: item.id,
      brandName: item.brandName,
      productName: item.productName,
      setupName: item.setupName,
      imagePath: item.imagePath,
      createdAt: item.createdAt,
      lastUsedAt: item.lastUsedAt,
      useCount: item.useCount,
      ...(item.productCode ? { productCode: item.productCode } : {}),
    }));
}

export type SetupForUse = {
  id: string;
  templateId: string;
  setupName: string;
  recipe: SavedSetupRecipeV1;
  specOverrides: SavedSetupSpecOverrides;
};

/** Loads ONE of the caller's own setups for replay. Unusable (removed / archived / inactive template) => error. */
export async function loadSetupForUse(
  supabase: SupabaseClient,
  userId: string,
  setupId: string,
): Promise<{ ok: true; setup: SetupForUse } | { ok: false; error: string }> {
  if (!isUuid(setupId)) return { ok: false, error: "Setup not found." };
  const { data, error } = await supabase
    .from("saved_setups")
    .select("id,template_id,setup_name,recipe,spec_overrides,product_templates(is_active,lifecycle_status)")
    .eq("id", setupId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Setup not found." };
  const row = data as unknown as {
    id: string;
    template_id: string | null;
    setup_name: string;
    recipe: unknown;
    spec_overrides: unknown;
    product_templates: SetupRow["product_templates"];
  };
  const template = Array.isArray(row.product_templates) ? row.product_templates[0] ?? null : row.product_templates;
  if (!isSetupUsable(row, template) || !row.template_id) return { ok: false, error: "This product is no longer available." };
  const shape = validateRecipeShape(row.recipe, row.spec_overrides ?? {});
  if (!shape.ok) return { ok: false, error: shape.error };
  return {
    ok: true,
    setup: {
      id: row.id,
      templateId: row.template_id,
      setupName: row.setup_name,
      recipe: row.recipe as SavedSetupRecipeV1,
      specOverrides: ((row.spec_overrides as SavedSetupSpecOverrides | null) ?? {}) as SavedSetupSpecOverrides,
    },
  };
}

/** Best effort: use_count + 1 and last_used_at for the caller's own setup. Never throws. */
export async function markSetupUsedForUser(supabase: SupabaseClient, userId: string, setupId: string): Promise<SetupActionResult> {
  try {
    if (!isUuid(setupId)) return { ok: false, error: "Setup not found." };
    const { data: current } = await supabase
      .from("saved_setups")
      .select("use_count")
      .eq("id", setupId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (!current) return { ok: false, error: "Setup not found." };
    const { data, error } = await supabase
      .from("saved_setups")
      .update({ use_count: Number((current as { use_count: number | null }).use_count ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("id", setupId)
      .eq("owner_id", userId)
      .select("id");
    if (error || !data || data.length === 0) return { ok: false, error: "Setup not found." };
    return { ok: true, id: setupId };
  } catch {
    return { ok: false, error: "Usage could not be recorded." };
  }
}
