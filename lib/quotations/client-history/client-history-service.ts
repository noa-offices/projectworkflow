/**
 * Client Quote History service. No "use server", no auth import: the server actions authenticate with requireActiveUser and
 * pass the CALLER's own Supabase client (so RLS and storage policies stay on). Never pass an elevated client here.
 * History rows are written ONLY by a database trigger. This file reads them, deletes one through a database function,
 * and copies a custom row's picture into the new quote row. A recipe, payload or price is never logged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUOTE_IMAGE_BUCKET,
  buildQuoteRowImagePath,
  imageNameFromPath,
  imageTypeFromPath,
  quoteImageStoragePath,
  quoteRowImageRef,
  validateCopyableStored,
} from "../../products/saved-setups/custom-item-image";
import { parseLineConfigurationRecipe, type LineConfigurationRecipe } from "../../products/saved-setups/line-recipe";
import { isUuid, type SavedSetupRecipeV1, type SavedSetupSpecOverrides } from "../../products/saved-setups/recipe";
import { isSetupUsable } from "../../products/saved-setups/usable";
import {
  CLIENT_HISTORY_PAGE_SIZE,
  CLIENT_HISTORY_PICTURE_URLS_MAX,
  CLIENT_HISTORY_PICTURE_URL_SECONDS,
  clampHistoryPage,
  historySearchPattern,
  isClientHistoryKind,
  isSafeRowId,
  readPriceHistory,
  specPreview,
  type ClientHistoryListItem,
  type ClientHistoryMessageKind,
  type ClientHistoryPicture,
} from "./client-history";

// The list NEVER selects the recipe itself: only two small values read out of it (does it have one, and its chosen picture).
const LIST_COLUMNS = [
  "id", "kind", "item_name", "brand", "item_code", "spec_short", "unit_label", "qty", "currency", "last_unit_price", "last_prices",
  "quoted_at", "last_quotation_no", "template_id", "picture_ref",
  "has_recipe:line_recipe->recipe->>template_id", "selected_image:line_recipe->recipe->>selected_image",
].join(",");

type HistoryRow = {
  id: string;
  kind: string;
  item_name: string;
  brand: string | null;
  item_code: string | null;
  spec_short: string | null;
  unit_label: string | null;
  qty: number | string | null;
  currency: string;
  last_unit_price: number | string;
  last_prices: unknown;
  quoted_at: string;
  last_quotation_no: string | null;
  template_id: string | null;
  picture_ref: string | null;
  has_recipe: string | null;
  selected_image: string | null;
};

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function logProblem(where: string, problem: unknown) {
  // Only a short code/name. Never the payload, a price or a recipe.
  try {
    console.error(`client history (${where}):`, problem instanceof Error ? problem.name : typeof problem);
  } catch {
    // logging must never fail an action
  }
}

const PROPOSED_IMAGE_FIELDS = Array.from({ length: 20 }, (_, index) => `proposed_image_url_${index + 1}`);
const TEMPLATE_IMAGE_SELECT = ["id", "default_image_url", ...PROPOSED_IMAGE_FIELDS].join(",");

function templateImagePaths(template: Record<string, unknown>): string[] {
  return PROPOSED_IMAGE_FIELDS.flatMap((field) => {
    const value = field === "proposed_image_url_1" ? template[field] ?? template.default_image_url : template[field];
    return typeof value === "string" && value.trim() ? [value] : [];
  });
}

/** One batched query for the templates on the page, under the caller's own RLS. */
async function templateImagesFor(supabase: SupabaseClient, templateIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const byTemplate = new Map<string, Record<string, unknown>>();
  if (templateIds.length === 0) return byTemplate;
  try {
    const { data } = await supabase.from("product_templates").select(TEMPLATE_IMAGE_SELECT).in("id", templateIds);
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) byTemplate.set(String(row.id), row);
  } catch (problem) {
    logProblem("template pictures", problem);
  }
  return byTemplate;
}

/** Custom rows: short-lived signed links, one batch, made with the caller's own client. A failure just means no pictures. */
async function signedPictureUrls(supabase: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = Array.from(new Set(paths)).slice(0, CLIENT_HISTORY_PICTURE_URLS_MAX);
  if (unique.length === 0) return urls;
  try {
    const { data, error } = await supabase.storage.from(QUOTE_IMAGE_BUCKET).createSignedUrls(unique, CLIENT_HISTORY_PICTURE_URL_SECONDS);
    if (error || !data) return urls;
    for (const entry of data) if (entry.path && entry.signedUrl && unique.includes(entry.path)) urls.set(entry.path, entry.signedUrl);
  } catch (problem) {
    logProblem("picture links", problem);
  }
  return urls;
}

export type ListClientHistoryInput = { clientId: unknown; query?: unknown; kind?: unknown; page?: unknown };
export type ListClientHistoryResult =
  | { ok: true; items: ClientHistoryListItem[]; total: number; page: number; pageSize: number; hasMore: boolean }
  | { ok: false; kind: ClientHistoryMessageKind };

/** One client's history, newest first, 30 per page. Display fields only: the recipe never leaves the server in a list. */
export async function listClientHistory(supabase: SupabaseClient, input: ListClientHistoryInput): Promise<ListClientHistoryResult> {
  if (!isUuid(input?.clientId)) return { ok: false, kind: "invalid_request" };
  if (input.kind !== undefined && input.kind !== null && input.kind !== "" && !isClientHistoryKind(input.kind)) return { ok: false, kind: "invalid_request" };
  const page = clampHistoryPage(input.page);
  const from = (page - 1) * CLIENT_HISTORY_PAGE_SIZE;
  try {
    let query = supabase
      .from("client_quote_history")
      .select(LIST_COLUMNS, { count: "exact" })
      .eq("client_id", input.clientId)
      .order("quoted_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + CLIENT_HISTORY_PAGE_SIZE - 1);
    if (isClientHistoryKind(input.kind)) query = query.eq("kind", input.kind);
    const pattern = historySearchPattern(input.query);
    if (pattern) query = query.or(`item_name.ilike."${pattern}",brand.ilike."${pattern}",item_code.ilike."${pattern}"`);
    const { data, error, count } = await query;
    if (error || !data) return { ok: false, kind: "load_failed" };
    const rows = data as unknown as HistoryRow[];

    const templateIds = Array.from(new Set(rows.flatMap((row) => (row.kind !== "custom" && isUuid(row.template_id) ? [row.template_id] : []))));
    const customPaths = rows.flatMap((row) => (row.kind === "custom" ? [quoteImageStoragePath(row.picture_ref)] : [])).filter((path): path is string => Boolean(path));
    const [templateImages, signed] = await Promise.all([templateImagesFor(supabase, templateIds), signedPictureUrls(supabase, customPaths)]);

    const items: ClientHistoryListItem[] = rows.flatMap((row) => {
      if (!isClientHistoryKind(row.kind)) return [];
      const lastUnitPrice = numberOrNull(row.last_unit_price);
      if (lastUnitPrice === null) return [];
      let picture: ClientHistoryPicture = null;
      if (row.kind === "custom") {
        const path = quoteImageStoragePath(row.picture_ref);
        const url = path ? signed.get(path) : undefined;
        if (url) picture = { kind: "signed", url };
      } else if (row.template_id) {
        const images = templateImages.get(row.template_id);
        if (images) {
          const available = templateImagePaths(images);
          const chosen = row.selected_image && available.includes(row.selected_image) ? row.selected_image : available[0];
          if (chosen) picture = { kind: "template", path: chosen };
        }
      }
      return [{
        id: row.id,
        kind: row.kind,
        itemName: row.item_name,
        brand: row.brand ?? "",
        itemCode: row.item_code ?? "",
        specShort: specPreview(row.spec_short),
        unitLabel: row.unit_label ?? "",
        qty: numberOrNull(row.qty),
        currency: row.currency,
        lastUnitPrice,
        lastQuotedAt: row.quoted_at,
        lastQuotationNo: row.last_quotation_no,
        hasRecipe: row.has_recipe !== null && row.has_recipe !== undefined,
        templateId: row.template_id,
        picture,
        priceHistory: readPriceHistory(row.last_prices),
      }];
    });
    const total = typeof count === "number" ? count : from + rows.length;
    return { ok: true, items, total, page, pageSize: CLIENT_HISTORY_PAGE_SIZE, hasMore: from + rows.length < total };
  } catch (problem) {
    logProblem("list", problem);
    return { ok: false, kind: "load_failed" };
  }
}

// ── Everything needed to add ONE row ───────────────────────────────────────
/** Same shape as the My Collection SetupForUse, so the EXISTING replay (openSetupFromCollection) can take it as is. */
export type HistorySetupForUse = { id: string; templateId: string; setupName: string; recipe: SavedSetupRecipeV1; specOverrides: SavedSetupSpecOverrides };

export type ClientHistoryAddItem =
  | { kind: "configured"; id: string; templateId: string; itemName: string; setup: HistorySetupForUse }
  /** recipeUnavailable: an older line (or an unreadable recipe): open the product, the exact setup cannot be restored. */
  | { kind: "library"; id: string; templateId: string; itemName: string; recipeUnavailable: boolean }
  | {
      kind: "custom";
      id: string;
      itemName: string;
      itemCode: string | null;
      brand: string;
      specification: string | null;
      unitLabel: string;
      price: number;
      currency: string;
      pictureRef: string | null;
    };

export type ClientHistoryAddResult = { ok: true; item: ClientHistoryAddItem } | { ok: false; kind: ClientHistoryMessageKind };

type AddRow = {
  id: string; client_id: string; kind: string; template_id: string | null; item_name: string; brand: string | null; item_code: string | null;
  spec_short: string | null; unit_label: string | null; currency: string; last_unit_price: number | string; line_recipe: unknown; picture_ref: string | null;
};

/** One history row for adding. The row must belong to the client passed in (the quote's client): another client's row is refused. */
export async function getClientHistoryItemForAdd(supabase: SupabaseClient, input: { id: unknown; clientId: unknown }): Promise<ClientHistoryAddResult> {
  if (!isUuid(input?.id) || !isUuid(input?.clientId)) return { ok: false, kind: "invalid_request" };
  try {
    const { data, error } = await supabase
      .from("client_quote_history")
      .select("id,client_id,kind,template_id,item_name,brand,item_code,spec_short,unit_label,currency,last_unit_price,line_recipe,picture_ref")
      .eq("id", input.id)
      .maybeSingle();
    if (error) return { ok: false, kind: "load_failed" };
    const row = data as unknown as AddRow | null;
    if (!row) return { ok: false, kind: "item_not_found" };
    if (row.client_id !== input.clientId) return { ok: false, kind: "wrong_client" };

    if (row.kind === "custom") {
      const price = numberOrNull(row.last_unit_price);
      if (price === null || price <= 0) return { ok: false, kind: "item_not_found" };
      return {
        ok: true,
        item: {
          kind: "custom",
          id: row.id,
          itemName: row.item_name,
          itemCode: row.item_code,
          brand: row.brand ?? "",
          specification: row.spec_short,
          unitLabel: row.unit_label || "Pc",
          price,
          currency: row.currency,
          pictureRef: quoteImageStoragePath(row.picture_ref) ? row.picture_ref : null,
        },
      };
    }

    if ((row.kind !== "configured" && row.kind !== "library") || !isUuid(row.template_id)) return { ok: false, kind: "product_unavailable" };
    // The product must still exist and be active (the same rule as My Collection replay).
    const { data: template } = await supabase.from("product_templates").select("id,is_active,lifecycle_status").eq("id", row.template_id).maybeSingle();
    const activity = template as { is_active: boolean | null; lifecycle_status: string | null } | null;
    if (!isSetupUsable({ template_id: row.template_id }, activity)) return { ok: false, kind: "product_unavailable" };

    if (row.kind === "configured") {
      const parsed: LineConfigurationRecipe | null = parseLineConfigurationRecipe(row.line_recipe, row.template_id);
      if (parsed) {
        return {
          ok: true,
          item: { kind: "configured", id: row.id, templateId: row.template_id, itemName: row.item_name, setup: { id: row.id, templateId: row.template_id, setupName: row.item_name, recipe: parsed.recipe, specOverrides: parsed.spec_overrides } },
        };
      }
    }
    return { ok: true, item: { kind: "library", id: row.id, templateId: row.template_id, itemName: row.item_name, recipeUnavailable: row.kind === "configured" } };
  } catch (problem) {
    logProblem("load for add", problem);
    return { ok: false, kind: "load_failed" };
  }
}

/** Removes one history row through the database function (it checks the role itself). */
export async function deleteClientHistoryItem(supabase: SupabaseClient, id: unknown): Promise<{ ok: true } | { ok: false; kind: ClientHistoryMessageKind }> {
  if (!isUuid(id)) return { ok: false, kind: "invalid_request" };
  try {
    const { data, error } = await supabase.rpc("client_quote_history_delete", { p_id: id });
    if (error) return { ok: false, kind: error.code === "42501" || /not allowed/i.test(error.message ?? "") ? "not_allowed" : "delete_failed" };
    return data === true ? { ok: true } : { ok: false, kind: "item_not_found" };
  } catch (problem) {
    logProblem("delete", problem);
    return { ok: false, kind: "delete_failed" };
  }
}

// ── Picture: copied into the NEW row's own quote-images path, only at the moment of adding ─────────────────
export type HistoryPictureCopy = { ok: true; ref: string } | { ok: false; kind: "picture_gone" | "picture_failed" };

function isMissingObject(error: unknown): boolean {
  const e = (error ?? {}) as { status?: unknown; statusCode?: unknown; message?: unknown };
  const code = String(e.statusCode ?? e.status ?? "");
  return code === "404" || /not.?found|does not exist|no such/i.test(typeof e.message === "string" ? e.message : "");
}

/**
 * The history row points at the ORIGINAL quote row's picture. At add time the file is read (every active user may read quote-images)
 * and written under the new row's own path (the adding user's own insert permission). The file is copied as stored: it was already
 * checked (type and size) when the original was uploaded, and is checked again here. A missing file is "picture_gone", never an error.
 */
export async function copyHistoryPictureToQuoteRow(
  supabase: SupabaseClient,
  input: { pictureRef: unknown; quotationId: string; rowId: string },
  now: Date = new Date(),
): Promise<HistoryPictureCopy> {
  const source = quoteImageStoragePath(input.pictureRef);
  if (!source || !isUuid(input.quotationId) || !isSafeRowId(input.rowId)) return { ok: false, kind: "picture_failed" };
  try {
    const { data, error } = await supabase.storage.from(QUOTE_IMAGE_BUCKET).download(source);
    if (error || !data) {
      if (error && isMissingObject(error)) return { ok: false, kind: "picture_gone" };
      logProblem("picture download", error);
      return { ok: false, kind: "picture_failed" };
    }
    const type = imageTypeFromPath(source);
    if (!type || !validateCopyableStored(type, data.size)) return { ok: false, kind: "picture_failed" };
    const target = buildQuoteRowImagePath(input.quotationId, input.rowId, imageNameFromPath(source), now, type);
    const { data: uploaded, error: uploadError } = await supabase.storage
      .from(QUOTE_IMAGE_BUCKET)
      .upload(target, new Uint8Array(await data.arrayBuffer()), { cacheControl: "3600", contentType: type, upsert: false });
    if (uploadError || !uploaded?.path) {
      logProblem("picture upload", uploadError);
      return { ok: false, kind: "picture_failed" };
    }
    return { ok: true, ref: quoteRowImageRef(uploaded.path) };
  } catch (problem) {
    logProblem("picture copy", problem);
    return { ok: false, kind: "picture_failed" };
  }
}

/**
 * Server builder: after the manual row exists, copy the picture and set the row's usual picture field. Never throws. A failure returns
 * the kind (the row stays without a picture); the copied file is removed again if the row could not be updated.
 */
export async function addHistoryPictureToQuoteRow(
  supabase: SupabaseClient,
  input: { pictureRef: string | null | undefined; quotationId: string; rowId: string },
): Promise<{ ok: true; attached: boolean } | { ok: false; kind: "picture_gone" | "picture_failed" }> {
  if (!input.pictureRef) return { ok: true, attached: false };
  const copied = await copyHistoryPictureToQuoteRow(supabase, { pictureRef: input.pictureRef, quotationId: input.quotationId, rowId: input.rowId });
  if (!copied.ok) return copied;
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
  return { ok: false, kind: "picture_failed" };
}
