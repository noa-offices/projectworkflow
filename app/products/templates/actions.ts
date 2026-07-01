"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { requireProductLibraryManager } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit-log";
import { defaultCurrency, normalizeCurrency } from "@/lib/currencies";
import {
  groupedStandardCategoryPricingRows,
  normalizeCategoryPriceLabel,
} from "@/lib/products/category-pricing-groups";
import { materialDisplayCategoryLabel } from "@/lib/products/material-classification";
import {
  MODULAR_GROUP_PRICING_TYPE,
  MODULAR_ITEM_PRICING_TYPE,
  MODULAR_META_PRICING_TYPE,
} from "@/lib/products/modular-pricing";
import { brandPriceBaselineDate, latestBrandPriceListUpdate } from "@/lib/product-price-check";
import { createClient } from "@/lib/supabase/server";

const allowedOptionTypes = new Set([
  "material_finish",
  "fabric_category",
  "size_variant",
  "cluster_preset",
  "linked_addon",
  "other",
]);
const imageFits = new Set(["contain", "cover"]);
const imageFields = [
  "proposed_image_url_1",
  "proposed_image_url_2",
  "proposed_image_url_3",
  "proposed_image_url_4",
  "proposed_image_url_5",
  "proposed_image_url_6",
  "proposed_image_url_7",
  "proposed_image_url_8",
  "proposed_image_url_9",
  "proposed_image_url_10",
  "proposed_image_url_11",
  "proposed_image_url_12",
  "proposed_image_url_13",
  "proposed_image_url_14",
  "proposed_image_url_15",
  "proposed_image_url_16",
  "proposed_image_url_17",
  "proposed_image_url_18",
  "proposed_image_url_19",
  "proposed_image_url_20",
] as const;
const imageFieldSet = new Set(imageFields);
const deskingRoles = new Set([
  "none",
  "base_size",
  "cluster_type",
  "accessory",
]);
const priceListUpdateStatuses = new Set(["draft", "active", "archived"]);
const detailPriceFieldsBySource = {
  product_components: new Set(["unit_price"]),
  "product_templates.desking_size_pricing": new Set(["default_price", "additional_price"]),
  "product_templates.variant_pricing": new Set(["price"]),
  "product_templates.category_pricing": new Set(["prices.Cat A", "prices.Cat B", "prices.Cat C", "prices.Cat D"]),
  "product_templates.accessory_pricing": new Set(["price"]),
} as const;

type DetailPriceSourceTable = keyof typeof detailPriceFieldsBySource;

type JsonPriceRow = Record<string, unknown> & {
  id?: string;
  currency?: string;
  items?: JsonPriceRow[];
  prices?: Record<string, unknown>;
};

type ProductLibraryImageReference =
  | { kind: "empty"; value: null }
  | { kind: "direct"; value: string }
  | { kind: "product"; path: string }
  | { kind: "quote"; path: string };

function isDirectImagePath(value: string) {
  return /^(https?:|blob:|data:|\/)/i.test(value);
}

function isQuoteStoragePath(value: string) {
  return value.startsWith("quotation-items/") || value.startsWith("quotation-finishes/");
}

function isProductStoragePath(value: string) {
  return value.startsWith("product-templates/") || value.startsWith("brand-materials/");
}

function parseProductLibraryImageReference(value: string | null): ProductLibraryImageReference {
  if (!value) {
    return { kind: "empty", value: null };
  }

  if (isDirectImagePath(value)) {
    return { kind: "direct", value };
  }

  if (value.startsWith("product-images:")) {
    return { kind: "product", path: value.slice("product-images:".length) };
  }

  if (value.startsWith("quote-images:")) {
    return { kind: "quote", path: value.slice("quote-images:".length) };
  }

  if (isQuoteStoragePath(value)) {
    return { kind: "quote", path: value };
  }

  if (isProductStoragePath(value)) {
    return { kind: "product", path: value };
  }

  return { kind: "product", path: value };
}

function safeStorageFilename(path: string) {
  const rawFilename = path.split("/").at(-1) ?? "image";
  const dotIndex = rawFilename.lastIndexOf(".");
  const extension = dotIndex >= 0 ? rawFilename.slice(dotIndex + 1).toLowerCase() : "";
  const basename = (dotIndex >= 0 ? rawFilename.slice(0, dotIndex) : rawFilename)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return extension ? `${basename || "image"}.${extension}` : basename || "image";
}

function contentTypeFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";

  return undefined;
}

async function copyQuoteImageToProductImages({
  sourcePath,
  supabase,
  templateId,
}: {
  sourcePath: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  templateId: string;
}) {
  const { data, error } = await supabase.storage.from("quote-images").download(sourcePath);

  if (error || !data) {
    throw new Error(error?.message || "Source image could not be downloaded.");
  }

  const targetPath = `product-templates/${templateId}/${Date.now()}-${safeStorageFilename(sourcePath)}`;
  const body = new Uint8Array(await data.arrayBuffer());
  const contentType = data.type || contentTypeFromPath(sourcePath);
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(targetPath, body, {
      cacheControl: "3600",
      contentType,
      upsert: false,
    });

  if (uploadError || !uploadData?.path) {
    throw new Error(uploadError?.message || "Image could not be uploaded.");
  }

  return uploadData.path;
}

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalTextValue(formData: FormData, name: string) {
  const value = textValue(formData, name);
  return value || null;
}

function boolValue(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function numberValue(formData: FormData, name: string, fallback: number) {
  const value = Number.parseFloat(textValue(formData, name));
  return Number.isFinite(value) ? value : fallback;
}

function optionalNumberValue(formData: FormData, name: string) {
  const rawValue = textValue(formData, name);
  if (!rawValue) return undefined;

  const value = Number.parseFloat(rawValue);
  return Number.isFinite(value) ? value : undefined;
}

function selectionModeValue(formData: FormData) {
  const value = textValue(formData, "selection_mode");
  return value === "selected_categories" || value === "selected_items" ? value : "full_group";
}

function selectedMaterialIdsValue(formData: FormData) {
  return Array.from(new Set(
    formData
      .getAll("brand_material_id[]")
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean),
  ));
}

function selectedMaterialCategoriesValue(formData: FormData) {
  return Array.from(new Set(
    formData
      .getAll("material_category[]")
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean),
  ));
}

function materialCategoryLabel(material: { material_category?: string | null; material_collection?: string | null }) {
  return materialDisplayCategoryLabel(material);
}

function priceListUpdateStatusValue(formData: FormData) {
  const status = textValue(formData, "status") || "draft";

  return priceListUpdateStatuses.has(status) ? status : "draft";
}

function detailPriceSourceValue(value: string): DetailPriceSourceTable | null {
  return value in detailPriceFieldsBySource ? value as DetailPriceSourceTable : null;
}

function detailPriceFieldIsAllowed(sourceTable: DetailPriceSourceTable, priceField: string) {
  if (sourceTable === "product_templates.category_pricing" && priceField.startsWith("prices.")) {
    return true;
  }

  return detailPriceFieldsBySource[sourceTable].has(priceField);
}

function jsonArrayValue(value: unknown): JsonPriceRow[] {
  return Array.isArray(value) ? value.filter((row): row is JsonPriceRow => Boolean(row && typeof row === "object")) : [];
}

function moneyNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function updateJsonPriceRows({
  currency,
  priceField,
  rows,
  sourceRecordId,
  sourceTable,
  newPrice,
}: {
  currency: string | null;
  priceField: string;
  rows: JsonPriceRow[];
  sourceRecordId: string;
  sourceTable: DetailPriceSourceTable;
  newPrice: number;
}) {
  let oldPrice: number | null = null;
  let matched = false;

  const updateRow = (row: JsonPriceRow): JsonPriceRow => {
    if (row.id !== sourceRecordId) {
      return row;
    }

    matched = true;
    const nextRow = { ...row };

    if (sourceTable === "product_templates.category_pricing") {
      const category = priceField.replace("prices.", "");
      const prices = typeof row.prices === "object" && row.prices !== null ? row.prices : {};
      oldPrice = moneyNumber(prices[category]);
      nextRow.prices = { ...prices, [category]: newPrice };
    } else {
      oldPrice = moneyNumber(row[priceField]);
      nextRow[priceField] = newPrice;
    }

    if (currency) {
      nextRow.currency = currency;
    }

    return nextRow;
  };

  if (sourceTable === "product_templates.accessory_pricing" || sourceTable === "product_templates.category_pricing") {
    const nestedRows = rows.map((group) => ({
      ...group,
      items: jsonArrayValue(group.items).map(updateRow),
    }));

    const nextRows = sourceTable === "product_templates.category_pricing"
      ? nestedRows.map(updateRow)
      : nestedRows;

    return { matched, oldPrice, rows: nextRows };
  }

  const nextRows = rows.map(updateRow);
  return { matched, oldPrice, rows: nextRows };
}

function numberInRange(formData: FormData, name: string, fallback: number, min: number, max: number) {
  const value = numberValue(formData, name, fallback);

  return Math.min(Math.max(value, min), max);
}

type ProductTemplateLifecycleStatus = "active" | "archived" | "discontinued";

function splitRelativePath(path: string) {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const pathWithoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = pathWithoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? pathWithoutHash.slice(0, queryIndex) : pathWithoutHash;
  const queryString = queryIndex >= 0 ? pathWithoutHash.slice(queryIndex + 1) : "";

  return { hash, pathname, queryString };
}

function pathWithParams(path: string, params: Record<string, string | null | undefined>) {
  const { hash, pathname, queryString } = splitRelativePath(path);
  const searchParams = new URLSearchParams(queryString);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    } else {
      searchParams.delete(key);
    }
  }

  const nextQuery = searchParams.toString();
  const nextPath = nextQuery ? `${pathname}?${nextQuery}` : pathname;
  return `${nextPath}${hash}`;
}

function returnPath(formData: FormData, fallback = "/products/templates") {
  const value = textValue(formData, "return_to");
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "http://local.test");
    return parsed.origin === "http://local.test" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch {
    return fallback;
  }
}

function redirectWithMessage(message: string): never {
  redirect(`/products/templates?message=${encodeURIComponent(message)}`);
}

function redirectWithMessageToPath(path: string, message: string): never {
  redirect(pathWithParams(path, { message }));
}

function redirectToTemplates(
  message: string,
  params: Record<string, string | null | undefined> = {},
): never {
  const query = new URLSearchParams();
  query.set("message", message);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }

  redirect(`/products/templates?${query.toString()}`);
}

function actionErrorMessage(actionLabel: string, error: unknown, fallbackMessage?: string) {
  return formatSafeActionError(actionLabel, error, fallbackMessage);
}

function imageSlotLabel(field: string) {
  const suffix = field.match(/(\d+)$/)?.[1];
  return suffix ? `Image slot ${suffix}` : "Product image";
}

function safeTemplateLabel(templateName: string | null | undefined) {
  return templateName?.trim() || "Product template";
}

function safeBrandLabel(brandName: string | null | undefined) {
  return brandName?.trim() || "Brand";
}

const productLibraryTemplateSelect =
  "id,brand_id,main_category_id,sub_category_id,template_code,template_name,internal_selection_name,item_code,description,default_specification,origin,supplier_name,default_image_url,reference_image_url,proposed_image_url_1,proposed_image_url_2,proposed_image_url_3,proposed_image_url_4,proposed_image_url_5,proposed_image_url_6,proposed_image_url_7,proposed_image_url_8,proposed_image_url_9,proposed_image_url_10,proposed_image_url_11,proposed_image_url_12,proposed_image_url_13,proposed_image_url_14,proposed_image_url_15,proposed_image_url_16,proposed_image_url_17,proposed_image_url_18,proposed_image_url_19,proposed_image_url_20,image_settings,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing,unit_label,currency,default_unit_price,last_price_checked_at,price_check_interval_days,price_check_note,created_at,price_notes";

type ProductTemplateModalActionResult = {
  message: string;
  ok: boolean;
  template?: Record<string, unknown>;
};

async function fetchProductLibraryTemplateForClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  templateId: string,
) {
  const { data: template, error: templateError } = await supabase
    .from("product_templates")
    .select(productLibraryTemplateSelect)
    .eq("id", templateId)
    .maybeSingle<Record<string, unknown> & { brand_id: string }>();

  if (templateError || !template) {
    throw templateError ?? new Error("Product template could not be loaded.");
  }

  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id,last_price_list_checked_at")
    .eq("id", template.brand_id)
    .maybeSingle<{ id: string; last_price_list_checked_at: string | null }>();

  if (brandError) {
    throw brandError;
  }

  const { data: updates, error: updatesError } = await supabase
    .from("brand_price_list_updates")
    .select("title,effective_from,received_at,created_at,status")
    .eq("brand_id", template.brand_id)
    .in("status", ["draft", "active"])
    .order("effective_from", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (updatesError) {
    throw updatesError;
  }

  const latestUpdate = latestBrandPriceListUpdate(updates ?? []);

  return {
    ...template,
    brand_latest_price_list_at: brandPriceBaselineDate({
      fallbackCheckedAt: brand?.last_price_list_checked_at ?? null,
      latestBrandPriceListUpdate: latestUpdate ?? null,
    }),
    latest_brand_price_list_update: latestUpdate ?? null,
  };
}

async function markTemplatePriceCheckedRecord({
  actorName,
  createdBy,
  note,
  supabase,
  templateId,
}: {
  actorName: string;
  createdBy: string;
  note?: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
  templateId: string;
}) {
  const trimmedNote = note?.trim() || null;
  const payload = {
    last_price_checked_at: new Date().toISOString(),
    last_price_checked_by: createdBy,
    ...(trimmedNote ? { price_check_note: trimmedNote } : {}),
  };
  const { data: template, error: templateError } = await supabase
    .from("product_templates")
    .select("id,template_name,brand_id")
    .eq("id", templateId)
    .maybeSingle<{ id: string; template_name: string; brand_id: string }>();

  if (templateError || !template) {
    throw templateError ?? new Error("Product template could not be loaded.");
  }

  const { error } = await supabase
    .from("product_templates")
    .update(payload)
    .eq("id", templateId);

  if (error) {
    throw error;
  }

  await createAuditLog(supabase, {
    entityType: "product_template",
    entityId: template.id,
    action: "price_checked",
    title: `${safeTemplateLabel(template.template_name)} price checked`,
    description: "Product template marked as price checked.",
    metadata: {
      brandId: template.brand_id,
      note: trimmedNote,
    },
    actorName,
    createdBy,
  });
}

function textValueFromNames(formData: FormData, names: string[]) {
  for (const name of names) {
    const value = textValue(formData, name);
    if (value) return value;
  }

  return "";
}

function optionalTextValueFromNames(formData: FormData, names: string[]) {
  for (const name of names) {
    const value = optionalTextValue(formData, name);
    if (value) return value;
  }

  return null;
}

function boolValueFromNames(formData: FormData, names: string[]) {
  return names.some((name) => formData.get(name) === "on");
}

async function validateProductTemplateCategories({
  brandId,
  mainCategoryId,
  redirectPath,
  subCategoryId,
}: {
  brandId: string;
  mainCategoryId: string | null;
  redirectPath?: string;
  subCategoryId: string | null;
}) {
  const supabase = await createClient();

  if (mainCategoryId) {
    const { data: mainCategory, error: mainCategoryError } = await supabase
      .from("product_categories")
      .select("id,brand_id,parent_id")
      .eq("id", mainCategoryId)
      .maybeSingle<{ id: string; brand_id: string; parent_id: string | null }>();

    if (
      mainCategoryError ||
      !mainCategory ||
      mainCategory.brand_id !== brandId ||
      mainCategory.parent_id !== null
    ) {
      console.error("PRODUCT TEMPLATE MAIN CATEGORY VALIDATION ERROR", mainCategoryError?.message);
      if (redirectPath) {
        redirectWithMessageToPath(redirectPath, "Selected category does not belong to this brand.");
      }

      throw new Error("Selected category does not belong to this brand.");
    }
  }

  if (subCategoryId) {
    const { data: subCategory, error: subCategoryError } = await supabase
      .from("product_categories")
      .select("id,brand_id,parent_id")
      .eq("id", subCategoryId)
      .maybeSingle<{ id: string; brand_id: string; parent_id: string | null }>();

    if (
      subCategoryError ||
      !subCategory ||
      subCategory.brand_id !== brandId ||
      !mainCategoryId ||
      subCategory.parent_id !== mainCategoryId
    ) {
      console.error("PRODUCT TEMPLATE SUB CATEGORY VALIDATION ERROR", subCategoryError?.message);
      if (redirectPath) {
        redirectWithMessageToPath(redirectPath, "Selected category does not belong to this brand.");
      }

      throw new Error("Selected category does not belong to this brand.");
    }
  }
}

async function updateProductTemplateLifecycle({
  actionLabel,
  id,
  message,
  status,
}: {
  actionLabel: string;
  id: string;
  message: string;
  status: ProductTemplateLifecycleStatus;
}) {
  const supabase = await createClient();
  const isActive = status === "active";
  const { error } = await supabase
    .from("product_templates")
    .update({
      is_active: isActive,
      lifecycle_status: status,
    })
    .eq("id", id);

  if (error) {
    console.error(`PRODUCT TEMPLATE ${actionLabel} ERROR`, error.message);
    redirectWithMessage(message);
  }
}

async function duplicateCategoryExists({
  brandId,
  name,
  parentId,
}: {
  brandId: string;
  name: string;
  parentId: string | null;
}) {
  const supabase = await createClient();
  let query = supabase
    .from("product_categories")
    .select("id")
    .eq("brand_id", brandId)
    .ilike("name", name);

  query = parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null);

  const { data, error } = await query.limit(1);

  if (error) {
    console.error("CATEGORY DUPLICATE CHECK ERROR", error.message);
    return false;
  }

  return Boolean(data?.length);
}

export async function createMainCategoryFromTemplates(formData: FormData) {
  const { user } = await requireProductLibraryManager();
  const brandId = textValueFromNames(formData, ["quick_brand_id", "brand_id"]);
  const name = textValueFromNames(formData, ["quick_name", "name"]);
  const returnMode = textValueFromNames(formData, ["quick_return_mode", "return_mode"]);

  if (!brandId || !name) {
    redirectToTemplates("Brand and category name are required.", {
      addTemplate: returnMode === "add-template" ? "1" : null,
      brand: brandId,
    });
  }

  if (await duplicateCategoryExists({ brandId, name, parentId: null })) {
    redirectToTemplates("A main category with that name already exists.", {
      addTemplate: returnMode === "add-template" ? "1" : null,
      brand: brandId,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_categories")
    .insert({
      brand_id: brandId,
      parent_id: null,
      name,
      code: optionalTextValueFromNames(formData, ["quick_code", "code"]),
      description: optionalTextValueFromNames(formData, ["quick_description", "description"]),
      is_active: boolValueFromNames(formData, ["quick_is_active", "is_active"]),
      sort_order: 0,
      created_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    console.error("MAIN CATEGORY CREATE ERROR", error?.message);
    redirectToTemplates("Main category could not be created.", {
      addTemplate: returnMode === "add-template" ? "1" : null,
      brand: brandId,
    });
  }

  revalidatePath("/products/templates");
  revalidatePath("/products/brands");
  redirectToTemplates("Main category created.", {
    addTemplate: returnMode === "add-template" ? "1" : null,
    brand: brandId,
    main: data.id,
  });
}

export async function createSubCategoryFromTemplates(formData: FormData) {
  const { user } = await requireProductLibraryManager();
  const brandId = textValueFromNames(formData, ["quick_brand_id", "brand_id"]);
  const parentId = textValueFromNames(formData, ["quick_parent_id", "parent_id"]);
  const name = textValueFromNames(formData, ["quick_name", "name"]);
  const returnMode = textValueFromNames(formData, ["quick_return_mode", "return_mode"]);

  if (!brandId || !parentId || !name) {
    redirectToTemplates("Brand, main category, and subcategory name are required.", {
      addTemplate: returnMode === "add-template" ? "1" : null,
      brand: brandId,
      main: parentId,
    });
  }

  if (await duplicateCategoryExists({ brandId, name, parentId })) {
    redirectToTemplates("A subcategory with that name already exists.", {
      addTemplate: returnMode === "add-template" ? "1" : null,
      brand: brandId,
      main: parentId,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_categories")
    .insert({
      brand_id: brandId,
      parent_id: parentId,
      name,
      code: optionalTextValueFromNames(formData, ["quick_code", "code"]),
      description: optionalTextValueFromNames(formData, ["quick_description", "description"]),
      is_active: boolValueFromNames(formData, ["quick_is_active", "is_active"]),
      sort_order: 0,
      created_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    console.error("SUBCATEGORY CREATE ERROR", error?.message);
    redirectToTemplates("Subcategory could not be created.", {
      addTemplate: returnMode === "add-template" ? "1" : null,
      brand: brandId,
      main: parentId,
    });
  }

  revalidatePath("/products/templates");
  revalidatePath("/products/brands");
  redirectToTemplates("Subcategory created.", {
    addTemplate: returnMode === "add-template" ? "1" : null,
    brand: brandId,
    main: parentId,
    sub: data.id,
  });
}

function imageDisplaySettingsValue(formData: FormData) {
  const fit = textValue(formData, "image_fit");

  return {
    fit: imageFits.has(fit) ? fit : "contain",
    zoom: numberInRange(formData, "image_zoom", 1, 1, 3),
    positionX: numberInRange(formData, "image_position_x", 50, 0, 100),
    positionY: numberInRange(formData, "image_position_y", 50, 0, 100),
  };
}

function extraTemplateImagePathKey(field: string) {
  return `${field}_path`;
}

function normalizedImageSettingsValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function templateImageMetadataValue(formData: FormData) {
  const metadata: Record<string, ReturnType<typeof imageDisplaySettingsValue>> = {};

  for (const field of imageFields) {
    const rawValue = textValue(formData, `image_settings_${field}`);
    if (rawValue) {
      try {
        const parsed = JSON.parse(rawValue) as {
          fit?: string;
          zoom?: number;
          positionX?: number;
          positionY?: number;
        };

        metadata[field] = {
          fit: parsed.fit === "cover" ? "cover" : "contain",
          zoom: Math.min(Math.max(Number(parsed.zoom) || 1, 1), 3),
          positionX: Math.min(Math.max(Number(parsed.positionX) || 50, 0), 100),
          positionY: Math.min(Math.max(Number(parsed.positionY) || 50, 0), 100),
        };
      } catch {
        // Ignore malformed client-side display metadata.
      }
    }

  }

  return Object.keys(metadata).length ? metadata : undefined;
}

function deskingSizePricingValue(formData: FormData) {
  const rawValue = textValue(formData, "desking_size_pricing");
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((row, index) => {
        const label = typeof row.label === "string" ? row.label.trim() : "";
        const parsedDimensions = label
          .split(/\s*x\s*/i)
          .map((part) => Number(part.trim()))
          .filter((value) => Number.isFinite(value));
        const length = parsedDimensions[0] ?? Number(row.length);
        const depth = parsedDimensions[1] ?? Number(row.depth);
        const height = parsedDimensions[2] ?? Number(row.height);
        const defaultPrice = Number(row.default_price);
        const additionalPrice = Number(row.additional_price);
        const baseSupplierPriceListCode =
          typeof row.base_supplier_price_list_code === "string" && row.base_supplier_price_list_code.trim()
            ? row.base_supplier_price_list_code.trim()
            : typeof row.supplier_price_list_code === "string"
              ? row.supplier_price_list_code.trim()
              : "";
        const additionalSupplierPriceListCode =
          typeof row.additional_supplier_price_list_code === "string"
            ? row.additional_supplier_price_list_code.trim()
            : "";

        return {
          id: typeof row.id === "string" && row.id ? row.id : `size-${index}`,
          label: label
              ? label
              : Number.isFinite(length) && Number.isFinite(depth) && Number.isFinite(height)
                ? `${length} x ${depth} x ${height}`
                : "",
          supplier_price_list_code: baseSupplierPriceListCode,
          base_supplier_price_list_code: baseSupplierPriceListCode,
          length: Number.isFinite(length) ? length : 0,
          depth: Number.isFinite(depth) ? depth : 0,
          height: Number.isFinite(height) ? height : 0,
          dimension_unit:
            typeof row.dimension_unit === "string" && row.dimension_unit.trim()
              ? row.dimension_unit.trim()
              : "cm",
          layout_type:
            row.layout_type === "Cluster" || row.layout_type === "Both"
              ? row.layout_type
              : "Linear",
          default_price: Number.isFinite(defaultPrice) ? defaultPrice : 0,
          additional_price: Number.isFinite(additionalPrice) ? additionalPrice : 0,
          additional_supplier_price_list_code: additionalSupplierPriceListCode,
          currency: normalizeCurrency(
            typeof row.currency === "string" ? row.currency : defaultCurrency,
          ),
          specification: typeof row.specification === "string" ? row.specification.trim() : "",
          default_dimension:
            typeof row.default_dimension === "string" ? row.default_dimension.trim() : "",
          sort_order: Number.isFinite(Number(row.sort_order))
            ? Number(row.sort_order)
            : index,
          is_active: row.is_active !== false,
        };
      })
      .filter(
        (row) =>
          row.label ||
          row.length > 0 ||
          row.depth > 0 ||
          row.height > 0 ||
          row.default_price > 0 ||
          row.additional_price > 0 ||
          row.supplier_price_list_code ||
          row.additional_supplier_price_list_code ||
          row.specification ||
          row.default_dimension,
      );
  } catch {
    return [];
  }
}

function variantPricingValue(formData: FormData) {
  const rawValue = textValue(formData, "variant_pricing");
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((row, index) => ({
        id: typeof row.id === "string" && row.id ? row.id : `variant-${index}`,
        variant_name: typeof row.variant_name === "string" ? row.variant_name.trim() : "",
        display_name: typeof row.display_name === "string" ? row.display_name.trim() : "",
        supplier_price_list_code: typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "",
        dimension: typeof row.dimension === "string" ? row.dimension.trim() : "",
        price: Number.isFinite(Number(row.price)) ? Number(row.price) : 0,
        currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
        specification: typeof row.specification === "string" ? row.specification.trim() : "",
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
        is_active: row.is_active !== false,
      }))
      .filter((row) => row.variant_name || row.display_name || row.supplier_price_list_code || row.dimension || row.price > 0 || row.specification);
  } catch {
    return [];
  }
}

function categoryPricingValue(formData: FormData) {
  const rawValue = textValue(formData, "category_pricing");
  const modularRawValue = textValue(formData, "modular_item_pricing");
  const modularDefaultsRawValue = textValue(formData, "modular_item_pricing_defaults");
  if (!rawValue && !modularRawValue && !modularDefaultsRawValue) return [];

  try {
    const parsed = rawValue ? JSON.parse(rawValue) as Array<Record<string, unknown>> : [];
    const parsedModular = modularRawValue ? JSON.parse(modularRawValue) as Array<Record<string, unknown>> : [];
    const modularDefaults = modularDefaultsRawValue
      ? JSON.parse(modularDefaultsRawValue) as Record<string, unknown>
      : {};
    const sourceRows = [
      ...(Array.isArray(parsed) ? parsed : []),
      ...(Array.isArray(parsedModular) ? parsedModular.filter((row) => row?.pricing_type !== MODULAR_GROUP_PRICING_TYPE) : []),
    ];

    const normalizeCategoryRow = (row: Record<string, unknown>, index: number) => {
      const prices = typeof row.prices === "object" && row.prices !== null
        ? row.prices as Record<string, unknown>
        : {};
      const normalizedPrices = new Map<string, number>([
        ["Cat A", 0],
        ["Cat B", 0],
        ["Cat C", 0],
        ["Cat D", 0],
      ]);

      Object.entries(prices).forEach(([key, value]) => {
        const label = normalizeCategoryPriceLabel(key);
        if (!label) {
          return;
        }

        normalizedPrices.set(label, Number.isFinite(Number(value)) ? Number(value) : 0);
      });

      return {
        id: typeof row.id === "string" && row.id ? row.id : `category-${index}`,
        pricing_type:
          typeof row.pricing_type === "string" && row.pricing_type.trim()
            ? row.pricing_type.trim()
            : null,
        pricing_category_id:
          typeof row.pricing_category_id === "string" && row.pricing_category_id.trim()
            ? row.pricing_category_id.trim()
            : null,
        pricing_category_name:
          typeof row.pricing_category_name === "string" && row.pricing_category_name.trim()
            ? row.pricing_category_name.trim()
            : null,
        variant_name: typeof row.variant_name === "string" ? row.variant_name.trim() : "",
        display_name: typeof row.display_name === "string" ? row.display_name.trim() : "",
        supplier_price_list_code: typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "",
        dimension: typeof row.dimension === "string" ? row.dimension.trim() : "",
        currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
        prices: Object.fromEntries(normalizedPrices.entries()),
        specification: typeof row.specification === "string" ? row.specification.trim() : "",
        modular_default_dimension:
          typeof row.modular_default_dimension === "string" && row.modular_default_dimension.trim()
            ? row.modular_default_dimension.trim()
            : null,
        modular_default_specification:
          typeof row.modular_default_specification === "string" && row.modular_default_specification.trim()
            ? row.modular_default_specification.trim()
            : null,
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
        is_active: row.is_active !== false,
      };
    };

    const standardGroups = groupedStandardCategoryPricingRows(
      (Array.isArray(parsed) ? parsed : []) as Array<Record<string, unknown>>,
    ).map((group, groupIndex) => ({
      id: typeof group.id === "string" && group.id ? group.id : `category-group-${groupIndex}`,
      group_name: typeof group.group_name === "string" && group.group_name.trim()
        ? group.group_name.trim()
        : "Finish Category Pricing",
      sort_order: Number.isFinite(Number(group.sort_order)) ? Number(group.sort_order) : groupIndex,
      is_active: group.is_active !== false,
      price_categories: Array.from(new Set((group.price_categories ?? []).map(normalizeCategoryPriceLabel).filter(Boolean))),
      items: (group.items ?? [])
        .map((item, itemIndex) => normalizeCategoryRow(item as Record<string, unknown>, itemIndex))
        .filter((row) =>
          row.variant_name || row.display_name || row.supplier_price_list_code || row.dimension || Object.values(row.prices).some((price) => price > 0) || row.specification,
        ),
    })).filter((group) => group.items.length || group.group_name);

    const modularGroups = (Array.isArray(parsedModular) ? parsedModular : [])
      .filter((row) => row?.pricing_type === MODULAR_GROUP_PRICING_TYPE)
      .map((group, groupIndex) => ({
        id: typeof group.id === "string" && group.id ? group.id : `modular-group-${groupIndex}`,
        pricing_type: MODULAR_GROUP_PRICING_TYPE,
        group_name: typeof group.group_name === "string" && group.group_name.trim()
          ? group.group_name.trim()
          : "Modular Items",
        sort_order: Number.isFinite(Number(group.sort_order)) ? Number(group.sort_order) : groupIndex,
        is_active: group.is_active !== false,
        items: (Array.isArray(group.items) ? group.items : [])
          .map((item, itemIndex) => normalizeCategoryRow(item as Record<string, unknown>, itemIndex))
          .map((item) => ({ ...item, pricing_type: MODULAR_ITEM_PRICING_TYPE }))
          .filter((row) =>
            row.variant_name || row.display_name || row.supplier_price_list_code || row.dimension || Object.values(row.prices).some((price) => price > 0) || row.specification,
          ),
      }))
      .filter((group) => (group.items?.length ?? 0) > 0 || group.group_name);

    const rows = sourceRows
      .map((row, index) => {
        return normalizeCategoryRow(row, index);
      })
      .filter((row) => row.pricing_type === MODULAR_ITEM_PRICING_TYPE || row.pricing_type === MODULAR_META_PRICING_TYPE)
      .filter((row) =>
        row.pricing_type === MODULAR_ITEM_PRICING_TYPE
          ? row.variant_name || row.display_name || row.supplier_price_list_code || row.dimension || Object.values(row.prices).some((price) => price > 0) || row.specification
          : row.variant_name || row.display_name || row.supplier_price_list_code || row.dimension || Object.values(row.prices).some((price) => price > 0) || row.specification,
      );

    const modularDefaultSpecification =
      typeof modularDefaults.modular_default_specification === "string" && modularDefaults.modular_default_specification.trim()
        ? modularDefaults.modular_default_specification.trim()
        : null;
    const modularDefaultDimension =
      typeof modularDefaults.modular_default_dimension === "string" && modularDefaults.modular_default_dimension.trim()
        ? modularDefaults.modular_default_dimension.trim()
        : null;

    if (modularDefaultSpecification || modularDefaultDimension) {
      rows.unshift({
        id: "modular-meta",
        pricing_type: MODULAR_META_PRICING_TYPE,
        pricing_category_id: null,
        pricing_category_name: null,
        variant_name: "",
        display_name: "",
        supplier_price_list_code: "",
        dimension: "",
        currency: defaultCurrency,
        prices: Object.fromEntries([["Cat A", 0], ["Cat B", 0], ["Cat C", 0], ["Cat D", 0]]),
        specification: "",
        modular_default_dimension: modularDefaultDimension,
        modular_default_specification: modularDefaultSpecification,
        sort_order: -1,
        is_active: true,
      });
    }

    return [...standardGroups, ...modularGroups, ...rows];
  } catch {
    return [];
  }
}

function accessoryPricingValue(formData: FormData) {
  const rawValue = textValue(formData, "accessory_pricing");
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];

    const normalizeItem = (row: Record<string, unknown>, index: number) => ({
      id: typeof row.id === "string" && row.id ? row.id : `add-on-${index}`,
      item_name: typeof row.item_name === "string" ? row.item_name.trim() : "",
      supplier_price_list_code: typeof row.supplier_price_list_code === "string" ? row.supplier_price_list_code.trim() : "",
      price: Number.isFinite(Number(row.price)) ? Number(row.price) : 0,
      currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
      specification: typeof row.specification === "string" ? row.specification.trim() : "",
      sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
      is_active: row.is_active !== false,
    });

    const groupedRows = parsed.filter((row) => row.group_name || row.items);
    const flatRows = parsed.filter((row) => !row.group_name && !row.items);
    const groups = groupedRows
      .map((row, index) => {
        const items = Array.isArray(row.items)
          ? row.items
              .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
              .map(normalizeItem)
              .filter((item) => item.item_name || item.supplier_price_list_code || item.price > 0 || item.specification)
          : [];

        return {
          id: typeof row.id === "string" && row.id ? row.id : `add-on-group-${index}`,
          group_name: typeof row.group_name === "string" && row.group_name.trim()
            ? row.group_name.trim()
            : "Accessories",
          group_is_required: row.group_is_required === true,
          sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
          is_active: row.is_active !== false,
          items,
        };
      })
      .filter((group) => group.group_name || group.items.length);

    if (flatRows.length) {
      groups.push({
        id: "accessories",
        group_name: "Accessories",
        group_is_required: false,
        sort_order: groups.length,
        is_active: true,
        items: flatRows
          .map(normalizeItem)
          .filter((item) => item.item_name || item.supplier_price_list_code || item.price > 0 || item.specification),
      });
    }

    return groups.filter((group) => group.items.length);
  } catch {
    return [];
  }
}

async function normalizeTemplateImagePayload<
  T extends {
    default_image_url?: string | null;
    reference_image_url?: string | null;
  } & Partial<Record<(typeof imageFields)[number], string | null>>,
>(
  payload: T,
  templateId: string,
) {
  const supabase = await createClient();
  const copiedImagePaths = new Map<string, string | null>();

  const resolveImageValue = async (value: string | null | undefined) => {
    const reference = parseProductLibraryImageReference(value ?? null);

    if (reference.kind === "empty") return null;
    if (reference.kind === "direct") return reference.value;
    if (reference.kind === "product") return reference.path;

    if (copiedImagePaths.has(reference.path)) {
      return copiedImagePaths.get(reference.path) ?? reference.path;
    }

    try {
      const copiedPath = await copyQuoteImageToProductImages({
        sourcePath: reference.path,
        supabase,
        templateId,
      });
      copiedImagePaths.set(reference.path, copiedPath);
      return copiedPath;
    } catch (error) {
      console.error(
        "PRODUCT TEMPLATE IMAGE COPY ERROR",
        error instanceof Error ? error.message : error,
      );
      copiedImagePaths.set(reference.path, reference.path);
      return reference.path;
    }
  };

  const normalizedEntries = await Promise.all(
    imageFields.map(async (field) => [field, await resolveImageValue(payload[field] ?? null)] as const),
  );
  const normalizedImages = Object.fromEntries(normalizedEntries) as Partial<Record<(typeof imageFields)[number], string | null>>;

  return {
    ...payload,
    ...normalizedImages,
    default_image_url: normalizedImages.proposed_image_url_1 ?? null,
    reference_image_url: await resolveImageValue(payload.reference_image_url ?? null),
  };
}

function templatePayload(formData: FormData, userId?: string) {
  const proposedImageValues = Object.fromEntries(
    imageFields.map((field) => [field, optionalTextValue(formData, field)]),
  ) as Record<(typeof imageFields)[number], string | null>;

  const payload = {
    brand_id: textValue(formData, "brand_id"),
    main_category_id: optionalTextValue(formData, "main_category_id"),
    sub_category_id: optionalTextValue(formData, "sub_category_id"),
    template_code: optionalTextValue(formData, "template_code"),
    template_name: textValue(formData, "template_name"),
    internal_selection_name: optionalTextValue(formData, "internal_selection_name"),
    item_code: optionalTextValue(formData, "item_code"),
    description: optionalTextValue(formData, "description"),
    default_specification: optionalTextValue(formData, "default_specification"),
    origin: optionalTextValue(formData, "origin"),
    supplier_name: optionalTextValue(formData, "supplier_name"),
    default_image_url: proposedImageValues.proposed_image_url_1,
    ...proposedImageValues,
    reference_image_url: optionalTextValue(formData, "reference_image_url"),
    desking_size_pricing: deskingSizePricingValue(formData),
    variant_pricing: variantPricingValue(formData),
    category_pricing: categoryPricingValue(formData),
    accessory_pricing: accessoryPricingValue(formData),
    unit_label: textValue(formData, "unit_label") || "Pc",
    currency: normalizeCurrency(textValue(formData, "currency") || defaultCurrency),
    default_unit_price: numberValue(formData, "default_unit_price", 0),
    price_notes: optionalTextValue(formData, "price_notes"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}

function createTemplatePayload(formData: FormData, userId: string) {
  const id = optionalTextValue(formData, "id");
  const imageSettings = templateImageMetadataValue(formData);
  const payload = {
    ...templatePayload(formData, userId),
    ...(imageSettings ? { image_settings: normalizedImageSettingsValue(imageSettings) } : {}),
  };

  return id ? { ...payload, id } : payload;
}

function calculationDataValue(formData: FormData) {
  const role = textValue(formData, "desking_role") || "none";

  if (!deskingRoles.has(role) || role === "none") {
    return {};
  }

  const calculationData: Record<string, boolean | string | number> = {
    desking_role: role,
  };
  const numericFields = [
    "base_cluster_seats",
    "module_length",
    "depth",
    "height",
    "seats_per_cluster",
    "modules_per_cluster",
  ];

  for (const field of numericFields) {
    const value = optionalNumberValue(formData, field);
    if (value !== undefined) {
      calculationData[field] = value;
    }
  }

  const dimensionUnit = textValue(formData, "dimension_unit");
  if (dimensionUnit) {
    calculationData.dimension_unit = dimensionUnit;
  }

  if (textValue(formData, "price_role")) {
    calculationData.price_role = textValue(formData, "price_role");
  }

  if (textValue(formData, "desking_label")) {
    calculationData.label = textValue(formData, "desking_label");
  }

  calculationData.allow_manual_quantity = boolValue(formData, "allow_manual_quantity");

  return calculationData;
}

function componentPayload(formData: FormData, userId?: string) {
  const payload = {
    template_id: textValue(formData, "template_id"),
    option_type: textValue(formData, "option_type"),
    component_group: textValue(formData, "component_group"),
    component_code: optionalTextValue(formData, "component_code"),
    component_name: textValue(formData, "component_name"),
    description: optionalTextValue(formData, "description"),
    qty: numberValue(formData, "qty", 1),
    unit_label: textValue(formData, "unit_label") || "Pc",
    unit_price: numberValue(formData, "unit_price", 0),
    currency: normalizeCurrency(textValue(formData, "currency") || defaultCurrency),
    is_optional: boolValue(formData, "is_optional"),
    is_default_selected: boolValue(formData, "is_default_selected"),
    sort_order: Math.trunc(numberValue(formData, "sort_order", 0)),
    is_active: boolValue(formData, "is_active"),
    price_notes: optionalTextValue(formData, "price_notes"),
    calculation_data: calculationDataValue(formData),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}

export async function createProductTemplate(formData: FormData) {
  const { user, displayName } = await requireProductLibraryManager();
  const initialPayload = createTemplatePayload(formData, user.id);
  const templateId = textValue(formData, "id");
  const redirectPath = returnPath(formData, "/products/templates?addTemplate=1");

  if (!initialPayload.brand_id || !initialPayload.template_name) {
    redirectWithMessageToPath(
      redirectPath,
      "Brand and item name/template name are required.",
    );
  }

  await validateProductTemplateCategories({
    brandId: initialPayload.brand_id,
    mainCategoryId: initialPayload.main_category_id,
    redirectPath,
    subCategoryId: initialPayload.sub_category_id,
  });
  const payload = await normalizeTemplateImagePayload(initialPayload, templateId);

  const supabase = await createClient();
  const { data: template, error } = await supabase
    .from("product_templates")
    .insert(payload)
    .select("id,brand_id,template_name")
    .single<{ id: string; brand_id: string; template_name: string }>();

  if (error || !template) {
    logServerActionError("PRODUCT TEMPLATE CREATE ERROR", error, {
      action: "createProductTemplate",
      recordId: templateId || null,
      table: "product_templates",
    });
    redirectWithMessageToPath(
      redirectPath,
      actionErrorMessage("Product template could not be saved", error),
    );
  }

  await createAuditLog(supabase, {
    entityType: "product_template",
    entityId: template.id,
    action: "created",
    title: `${safeTemplateLabel(template.template_name)} created`,
    description: "Product template created.",
    metadata: {
      brandId: template.brand_id,
      templateName: template.template_name,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/products/templates");
  redirectWithMessageToPath(
    `/products/templates?manage=1&panelBrand=${template.brand_id}&template=${template.id}&editTemplate=${template.id}#template-${template.id}-materials`,
    "Product template created. Add material groups below.",
  );
}

export async function updateProductTemplate(formData: FormData) {
  const { user, displayName } = await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const initialPayload = templatePayload(formData);
  const submittedImageSettings = templateImageMetadataValue(formData);
  const redirectPath = returnPath(formData);

  if (!id || !initialPayload.brand_id || !initialPayload.template_name) {
    redirectWithMessageToPath(redirectPath, "Template id, brand, and template name are required.");
  }

  await validateProductTemplateCategories({
    brandId: initialPayload.brand_id,
    mainCategoryId: initialPayload.main_category_id,
    redirectPath,
    subCategoryId: initialPayload.sub_category_id,
  });
  const payload = await normalizeTemplateImagePayload(initialPayload, id);

  const supabase = await createClient();
  const { data: currentTemplate, error: currentTemplateError } = await supabase
    .from("product_templates")
    .select("id,brand_id,template_name,image_settings")
    .eq("id", id)
    .maybeSingle<{ id: string; brand_id: string; template_name: string; image_settings: Record<string, unknown> | null }>();

  if (currentTemplateError || !currentTemplate) {
    logServerActionError("PRODUCT TEMPLATE UPDATE READ ERROR", currentTemplateError, {
      action: "updateProductTemplate",
      recordId: id,
      table: "product_templates",
    });
    redirectWithMessageToPath(redirectPath, actionErrorMessage("Product template could not be loaded", currentTemplateError));
  }

  const nextImageSettings = { ...normalizedImageSettingsValue(currentTemplate.image_settings) };
  const clearedImageSlots: string[] = [];
  for (const field of imageFields) {
    delete nextImageSettings[extraTemplateImagePathKey(field)];

    if (payload[field]) {
      const nextFieldSettings = submittedImageSettings?.[field];
      if (nextFieldSettings) {
        nextImageSettings[field] = nextFieldSettings;
      }
    } else {
      delete nextImageSettings[field];
      clearedImageSlots.push(field);
    }
  }

  const safeImageSettings = normalizedImageSettingsValue(nextImageSettings);

  const { error } = await supabase
    .from("product_templates")
    .update({
      ...payload,
      image_settings: safeImageSettings,
    })
    .eq("id", id);

  if (error) {
    logServerActionError("PRODUCT TEMPLATE UPDATE ERROR", error, {
      action: "updateProductTemplate",
      imageSettingsNormalized: true,
      imageSlotsCleared: clearedImageSlots,
      recordId: id,
      table: "product_templates",
    });
    redirectWithMessageToPath(redirectPath, actionErrorMessage("Product template could not be updated", error));
  }

  await createAuditLog(supabase, {
    entityType: "product_template",
    entityId: currentTemplate.id,
    action: "updated",
    title: `${safeTemplateLabel(payload.template_name)} updated`,
    description: "Product template details updated.",
    metadata: {
      brandId: payload.brand_id,
      templateName: payload.template_name,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/products/templates");
  redirectWithMessageToPath(redirectPath, "Product template updated.");
}

export async function updateProductTemplateForQuotationModal(formData: FormData): Promise<ProductTemplateModalActionResult> {
  try {
    const { user, displayName } = await requireProductLibraryManager();
    const id = textValue(formData, "id");
    const initialPayload = templatePayload(formData);
    const submittedImageSettings = templateImageMetadataValue(formData);
    const shouldMarkPriceCheckedAfterSave = textValue(formData, "price_check_mode") === "review_on_save";

    if (!id || !initialPayload.brand_id || !initialPayload.template_name) {
      return { ok: false, message: "Template id, brand, and template name are required." };
    }

    await validateProductTemplateCategories({
      brandId: initialPayload.brand_id,
      mainCategoryId: initialPayload.main_category_id,
      subCategoryId: initialPayload.sub_category_id,
    });
    const payload = await normalizeTemplateImagePayload(initialPayload, id);

    const supabase = await createClient();
    const { data: currentTemplate, error: currentTemplateError } = await supabase
      .from("product_templates")
      .select("id,brand_id,template_name,image_settings")
      .eq("id", id)
      .maybeSingle<{ id: string; brand_id: string; template_name: string; image_settings: Record<string, unknown> | null }>();

    if (currentTemplateError || !currentTemplate) {
      logServerActionError("PRODUCT TEMPLATE UPDATE READ ERROR", currentTemplateError, {
        action: "updateProductTemplateForQuotationModal",
        recordId: id,
        table: "product_templates",
      });
      return {
        ok: false,
        message: actionErrorMessage("Product template could not be loaded", currentTemplateError),
      };
    }

    const nextImageSettings = { ...normalizedImageSettingsValue(currentTemplate.image_settings) };
    for (const field of imageFields) {
      delete nextImageSettings[extraTemplateImagePathKey(field)];

      if (payload[field]) {
        const nextFieldSettings = submittedImageSettings?.[field];
        if (nextFieldSettings) {
          nextImageSettings[field] = nextFieldSettings;
        }
      } else {
        delete nextImageSettings[field];
      }
    }

    const { error } = await supabase
      .from("product_templates")
      .update({
        ...payload,
        image_settings: normalizedImageSettingsValue(nextImageSettings),
      })
      .eq("id", id);

    if (error) {
      logServerActionError("PRODUCT TEMPLATE UPDATE ERROR", error, {
        action: "updateProductTemplateForQuotationModal",
        recordId: id,
        table: "product_templates",
      });
      return {
        ok: false,
        message: actionErrorMessage("Product template could not be updated", error),
      };
    }

    await createAuditLog(supabase, {
      entityType: "product_template",
      entityId: currentTemplate.id,
      action: "updated",
      title: `${safeTemplateLabel(payload.template_name)} updated`,
      description: "Product template details updated.",
      metadata: {
        brandId: payload.brand_id,
        templateName: payload.template_name,
      },
      actorName: displayName,
      createdBy: user.id,
    });

    if (shouldMarkPriceCheckedAfterSave) {
      try {
        await markTemplatePriceCheckedRecord({
          actorName: displayName,
          createdBy: user.id,
          note: optionalTextValue(formData, "price_check_note"),
          supabase,
          templateId: id,
        });
      } catch (error) {
        logServerActionError("PRODUCT TEMPLATE MODAL PRICE CHECK ERROR", error, {
          action: "updateProductTemplateForQuotationModal",
          recordId: id,
          table: "product_templates",
        });
        return {
          ok: false,
          message: actionErrorMessage("Template price check could not be saved", error),
        };
      }
    }

    revalidatePath("/products/templates");
    return {
      ok: true,
      message: shouldMarkPriceCheckedAfterSave
        ? "Product template updated and price checked."
        : "Product template updated.",
      template: await fetchProductLibraryTemplateForClient(supabase, id),
    };
  } catch (error) {
    logServerActionError("PRODUCT TEMPLATE MODAL UPDATE UNEXPECTED ERROR", error, {
      action: "updateProductTemplateForQuotationModal",
    });
    return {
      ok: false,
      message: actionErrorMessage("Product template could not be updated", error),
    };
  }
}

export async function createProductTemplateForQuotationModal(formData: FormData): Promise<ProductTemplateModalActionResult> {
  try {
    const { user, displayName } = await requireProductLibraryManager();
    const initialPayload = createTemplatePayload(formData, user.id);
    const templateId = textValue(formData, "id");

    if (!initialPayload.brand_id || !initialPayload.template_name) {
      return { ok: false, message: "Brand and item name/template name are required." };
    }

    await validateProductTemplateCategories({
      brandId: initialPayload.brand_id,
      mainCategoryId: initialPayload.main_category_id,
      subCategoryId: initialPayload.sub_category_id,
    });
    const payload = await normalizeTemplateImagePayload(initialPayload, templateId);

    const supabase = await createClient();
    const { data: template, error } = await supabase
      .from("product_templates")
      .insert(payload)
      .select("id,brand_id,template_name")
      .single<{ id: string; brand_id: string; template_name: string }>();

    if (error || !template) {
      logServerActionError("PRODUCT TEMPLATE MODAL CREATE ERROR", error, {
        action: "createProductTemplateForQuotationModal",
        recordId: templateId || null,
        table: "product_templates",
      });
      return {
        ok: false,
        message: actionErrorMessage("Product template could not be saved", error),
      };
    }

    await createAuditLog(supabase, {
      entityType: "product_template",
      entityId: template.id,
      action: "created",
      title: `${safeTemplateLabel(template.template_name)} created`,
      description: "Product template created.",
      metadata: {
        brandId: template.brand_id,
        templateName: template.template_name,
      },
      actorName: displayName,
      createdBy: user.id,
    });

    revalidatePath("/products/templates");
    return {
      ok: true,
      message: "Product template created.",
      template: await fetchProductLibraryTemplateForClient(supabase, template.id),
    };
  } catch (error) {
    logServerActionError("PRODUCT TEMPLATE MODAL CREATE UNEXPECTED ERROR", error, {
      action: "createProductTemplateForQuotationModal",
    });
    return {
      ok: false,
      message: actionErrorMessage("Product template could not be created", error),
    };
  }
}

export async function updateProductTemplateDefaultPrice(formData: FormData) {
  const { user, displayName } = await requireProductLibraryManager();
  const redirectPath = returnPath(formData);
  const productTemplateId = textValue(formData, "product_template_id");
  const newDefaultUnitPrice = numberValue(formData, "new_default_unit_price", Number.NaN);
  const currency = normalizeCurrency(textValue(formData, "currency") || defaultCurrency);
  const brandPriceListUpdateId = optionalTextValue(formData, "brand_price_list_update_id");
  const effectiveFrom = optionalTextValue(formData, "effective_from");
  const note = optionalTextValue(formData, "note");

  if (!productTemplateId || !Number.isFinite(newDefaultUnitPrice) || newDefaultUnitPrice < 0) {
    redirectWithMessageToPath(redirectPath, "Template and valid new price are required.");
  }

  const supabase = await createClient();
  const { data: template, error: templateError } = await supabase
    .from("product_templates")
    .select("id,brand_id,default_unit_price,currency")
    .eq("id", productTemplateId)
    .single<{
      id: string;
      brand_id: string;
      default_unit_price: number;
      currency: string;
    }>();

  if (templateError || !template) {
    console.error("PRODUCT TEMPLATE PRICE UPDATE READ ERROR", templateError?.message);
    redirectWithMessageToPath(redirectPath, "Product template could not be loaded.");
  }

  if (brandPriceListUpdateId) {
    const { data: priceListUpdate, error: priceListError } = await supabase
      .from("brand_price_list_updates")
      .select("id")
      .eq("id", brandPriceListUpdateId)
      .eq("brand_id", template.brand_id)
      .maybeSingle<{ id: string }>();

    if (priceListError || !priceListUpdate) {
      console.error("PRODUCT TEMPLATE PRICE LIST UPDATE LOOKUP ERROR", priceListError?.message);
      redirectWithMessageToPath(redirectPath, "Selected brand price list update could not be loaded.");
    }
  }

  const { error: historyError } = await supabase.from("product_template_price_history").insert({
    product_template_id: template.id,
    brand_id: template.brand_id,
    brand_price_list_update_id: brandPriceListUpdateId,
    old_default_unit_price: template.default_unit_price,
    new_default_unit_price: newDefaultUnitPrice,
    currency,
    effective_from: effectiveFrom,
    note,
    changed_by: user.id,
  });

  if (historyError) {
    console.error("PRODUCT TEMPLATE PRICE HISTORY ERROR", historyError.message);
    redirectWithMessageToPath(redirectPath, "Product template price history could not be saved.");
  }

  const { error: updateError } = await supabase
    .from("product_templates")
    .update({
      default_unit_price: newDefaultUnitPrice,
      currency,
      last_price_checked_at: new Date().toISOString(),
      last_price_checked_by: user.id,
      ...(note ? { price_check_note: note } : {}),
    })
    .eq("id", template.id);

  if (updateError) {
    console.error("PRODUCT TEMPLATE PRICE UPDATE ERROR", updateError.message);
    redirectWithMessageToPath(redirectPath, "Product template source price could not be updated.");
  }

  await createAuditLog(supabase, {
    entityType: "product_template_price",
    entityId: template.id,
    parentEntityType: "product_template",
    parentEntityId: template.id,
    action: "price_updated",
    title: "Source price updated",
    description: `${normalizeCurrency(currency)} ${template.default_unit_price} -> ${newDefaultUnitPrice}`,
    metadata: {
      brandId: template.brand_id,
      brandPriceListUpdateId,
      currency: normalizeCurrency(currency),
      effectiveFrom,
      newDefaultUnitPrice,
      note,
      oldDefaultUnitPrice: template.default_unit_price,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/products/templates");
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessageToPath(redirectPath, "Product template source price updated.");
}

export async function updateProductTemplateDetailPrice(formData: FormData) {
  const { user, displayName } = await requireProductLibraryManager();
  const redirectPath = returnPath(formData);
  const productTemplateId = textValue(formData, "product_template_id");
  const sourceTable = detailPriceSourceValue(textValue(formData, "source_table"));
  const sourceRecordId = textValue(formData, "source_record_id");
  const priceField = textValue(formData, "price_field");
  const newPrice = numberValue(formData, "new_price", Number.NaN);
  const currency = optionalTextValue(formData, "currency");
  const brandPriceListUpdateId = optionalTextValue(formData, "brand_price_list_update_id");
  const effectiveFrom = optionalTextValue(formData, "effective_from");
  const note = optionalTextValue(formData, "note");

  if (
    !productTemplateId ||
    !sourceTable ||
    !sourceRecordId ||
    !detailPriceFieldIsAllowed(sourceTable, priceField) ||
    !Number.isFinite(newPrice) ||
    newPrice < 0
  ) {
    redirectWithMessageToPath(redirectPath, "Template, source row, price field, and valid new price are required.");
  }

  const normalizedCurrency = currency ? normalizeCurrency(currency) : null;
  const supabase = await createClient();
  const { data: template, error: templateError } = await supabase
    .from("product_templates")
    .select("id,brand_id,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing")
    .eq("id", productTemplateId)
    .single<{
      id: string;
      brand_id: string;
      desking_size_pricing: JsonPriceRow[] | null;
      variant_pricing: JsonPriceRow[] | null;
      category_pricing: JsonPriceRow[] | null;
      accessory_pricing: JsonPriceRow[] | null;
    }>();

  if (templateError || !template) {
    console.error("DETAIL PRICE TEMPLATE READ ERROR", templateError?.message);
    redirectWithMessageToPath(redirectPath, "Product template could not be loaded.");
  }

  if (brandPriceListUpdateId) {
    const { data: priceListUpdate, error: priceListError } = await supabase
      .from("brand_price_list_updates")
      .select("id")
      .eq("id", brandPriceListUpdateId)
      .eq("brand_id", template.brand_id)
      .neq("status", "archived")
      .maybeSingle<{ id: string }>();

    if (priceListError || !priceListUpdate) {
      console.error("DETAIL PRICE LIST UPDATE LOOKUP ERROR", priceListError?.message);
      redirectWithMessageToPath(redirectPath, "Selected brand price list update could not be loaded.");
    }
  }

  let oldPrice: number | null = null;
  let updatePayload: Record<string, unknown> = {};
  let componentSourceId: string | null = null;

  if (sourceTable === "product_components") {
    const { data: component, error: componentError } = await supabase
      .from("product_components")
      .select("id,template_id,unit_price,currency")
      .eq("id", sourceRecordId)
      .single<{
        id: string;
        template_id: string;
        unit_price: number;
        currency: string;
      }>();

    if (componentError || !component || component.template_id !== template.id) {
      console.error("DETAIL PRICE COMPONENT READ ERROR", componentError?.message);
      redirectWithMessageToPath(redirectPath, "Component price source could not be loaded.");
    }

    oldPrice = component.unit_price;
    componentSourceId = component.id;
    updatePayload = {
      unit_price: newPrice,
      ...(normalizedCurrency ? { currency: normalizedCurrency } : {}),
    };
  } else {
    const jsonColumn = sourceTable.replace("product_templates.", "") as
      | "desking_size_pricing"
      | "variant_pricing"
      | "category_pricing"
      | "accessory_pricing";
    const updated = updateJsonPriceRows({
      currency: normalizedCurrency,
      priceField,
      rows: jsonArrayValue(template[jsonColumn]),
      sourceRecordId,
      sourceTable,
      newPrice,
    });

    if (!updated.matched) {
      redirectWithMessageToPath(redirectPath, "Template price row could not be found.");
    }

    oldPrice = updated.oldPrice;
    updatePayload = { [jsonColumn]: updated.rows };
  }

  const { error: historyError } = await supabase.from("product_template_detail_price_history").insert({
    product_template_id: template.id,
    brand_id: template.brand_id,
    brand_price_list_update_id: brandPriceListUpdateId,
    source_table: sourceTable,
    source_record_id: sourceRecordId,
    price_field: priceField,
    old_price: oldPrice,
    new_price: newPrice,
    currency: normalizedCurrency,
    effective_from: effectiveFrom,
    note,
    changed_by: user.id,
  });

  if (historyError) {
    console.error("DETAIL PRICE HISTORY ERROR", historyError.message);
    redirectWithMessageToPath(redirectPath, "Detail price history could not be saved.");
  }

  if (sourceTable === "product_components") {
    const { error: componentUpdateError } = await supabase
      .from("product_components")
      .update(updatePayload)
      .eq("id", componentSourceId);

    if (componentUpdateError) {
      console.error("DETAIL PRICE COMPONENT UPDATE ERROR", componentUpdateError.message);
      redirectWithMessageToPath(redirectPath, "Component source price could not be updated.");
    }
  } else {
    const { error: jsonUpdateError } = await supabase
      .from("product_templates")
      .update(updatePayload)
      .eq("id", template.id);

    if (jsonUpdateError) {
      console.error("DETAIL PRICE JSON UPDATE ERROR", jsonUpdateError.message);
      redirectWithMessageToPath(redirectPath, "Template detail source price could not be updated.");
    }
  }

  await createAuditLog(supabase, {
    entityType: "product_template_detail_price",
    entityId: componentSourceId ?? sourceRecordId,
    parentEntityType: "product_template",
    parentEntityId: template.id,
    action: "detail_price_updated",
    title: "Variant price updated",
    description: `${normalizeCurrency(normalizedCurrency ?? defaultCurrency)} ${oldPrice ?? 0} -> ${newPrice}`,
    metadata: {
      brandId: template.brand_id,
      brandPriceListUpdateId,
      currency: normalizeCurrency(normalizedCurrency ?? defaultCurrency),
      effectiveFrom,
      newPrice,
      note,
      oldPrice,
      priceField,
      sourceRecordId,
      sourceTable,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/products/templates");
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessageToPath(redirectPath, "Detail source price updated.");
}

export async function archiveProductTemplate(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Product template id is required.");
  }

  await updateProductTemplateLifecycle({
    actionLabel: "ARCHIVE",
    id,
    message: "Product template could not be moved to Archive.",
    status: "archived",
  });

  revalidatePath("/products/templates");
  redirectWithMessage("Product template moved to Archive.");
}

export async function markProductTemplateDiscontinued(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Product template id is required.");
  }

  await updateProductTemplateLifecycle({
    actionLabel: "DISCONTINUE",
    id,
    message: "Product template could not be marked as discontinued.",
    status: "discontinued",
  });

  revalidatePath("/products/templates");
  redirectWithMessage("Product template marked as discontinued.");
}

export async function restoreProductTemplate(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Product template id is required.");
  }

  await updateProductTemplateLifecycle({
    actionLabel: "RESTORE",
    id,
    message: "Product template could not be restored.",
    status: "active",
  });

  revalidatePath("/products/templates");
  redirectWithMessage("Product template restored.");
}

export async function permanentlyDeleteProductTemplate(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Product template id is required.");
  }

  const supabase = await createClient();
  const { data: template, error: templateError } = await supabase
    .from("product_templates")
    .select("id,is_active,lifecycle_status")
    .eq("id", id)
    .maybeSingle<{ id: string; is_active: boolean; lifecycle_status: ProductTemplateLifecycleStatus }>();
  const { count: quotationItemCount, error: quotationItemError } = await supabase
    .from("quotation_items")
    .select("id", { count: "exact", head: true })
    .eq("source_template_id", id);
  const { count: linkedFamilyCount, error: linkedFamilyError } = await supabase
    .from("product_template_linked_families")
    .select("id", { count: "exact", head: true })
    .or(`parent_template_id.eq.${id},linked_template_id.eq.${id}`);

  if (templateError || !template || quotationItemError || linkedFamilyError) {
    console.error(
      "PRODUCT TEMPLATE DEPENDENCY CHECK ERROR",
      templateError?.message ?? quotationItemError?.message ?? linkedFamilyError?.message,
    );
    redirectWithMessage("Product template dependencies could not be checked.");
  }

  if (template.is_active || template.lifecycle_status === "active") {
    redirectWithMessage("Archive or discontinue this product before deleting it permanently.");
  }

  if ((quotationItemCount ?? 0) > 0 || (linkedFamilyCount ?? 0) > 0) {
    redirectWithMessage(
      "This product is used in existing quotations. It cannot be permanently deleted because quotation history must be preserved.",
    );
  }

  const { error } = await supabase.from("product_templates").delete().eq("id", id);

  if (error) {
    console.error("PRODUCT TEMPLATE PERMANENT DELETE ERROR", error.message);
    redirectWithMessage("Product template could not be permanently deleted.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Product template permanently deleted.");
}

export async function deactivateProductTemplate(formData: FormData) {
  return archiveProductTemplate(formData);
}

export async function createLinkedProductFamily(formData: FormData) {
  await requireProductLibraryManager();
  const parentTemplateId = textValue(formData, "parent_template_id");
  const linkedTemplateId = textValue(formData, "linked_template_id");
  const payload = {
    parent_template_id: parentTemplateId,
    linked_template_id: linkedTemplateId,
    label: optionalTextValue(formData, "label"),
    is_required: boolValue(formData, "is_required"),
    allow_multiple: boolValue(formData, "allow_multiple"),
    add_to_parent_price: boolValue(formData, "add_to_parent_price"),
    append_to_specification: boolValue(formData, "append_to_specification"),
    default_qty: numberValue(formData, "default_qty", 0),
    sort_order: Math.trunc(numberValue(formData, "sort_order", 0)),
    is_active: boolValue(formData, "is_active"),
  };

  if (!parentTemplateId || !linkedTemplateId || parentTemplateId === linkedTemplateId) {
    redirectWithMessage("Select a parent template and a different linked product family.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_template_linked_families")
    .upsert(payload, { onConflict: "parent_template_id,linked_template_id" });

  if (error) {
    console.error("LINKED PRODUCT FAMILY CREATE ERROR", error.message);
    redirectWithMessage("Linked product family could not be saved.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Linked product family saved.");
}

export async function updateLinkedProductFamily(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const payload = {
    label: optionalTextValue(formData, "label"),
    is_required: boolValue(formData, "is_required"),
    allow_multiple: boolValue(formData, "allow_multiple"),
    add_to_parent_price: boolValue(formData, "add_to_parent_price"),
    append_to_specification: boolValue(formData, "append_to_specification"),
    default_qty: numberValue(formData, "default_qty", 0),
    sort_order: Math.trunc(numberValue(formData, "sort_order", 0)),
    is_active: boolValue(formData, "is_active"),
  };

  if (!id) {
    redirectWithMessage("Linked product family id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_template_linked_families")
    .update(payload)
    .eq("id", id);

  if (error) {
    console.error("LINKED PRODUCT FAMILY UPDATE ERROR", error.message);
    redirectWithMessage("Linked product family could not be updated.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Linked product family updated.");
}

export async function deactivateLinkedProductFamily(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Linked product family id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_template_linked_families")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("LINKED PRODUCT FAMILY DEACTIVATE ERROR", error.message);
    redirectWithMessage("Linked product family could not be removed.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Linked product family removed.");
}

export async function restoreLinkedProductFamily(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Linked product family id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_template_linked_families")
    .update({ is_active: true })
    .eq("id", id);

  if (error) {
    console.error("LINKED PRODUCT FAMILY RESTORE ERROR", error.message);
    redirectWithMessage("Linked product family could not be restored.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Linked product family restored.");
}

export async function permanentlyDeleteLinkedProductFamily(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Linked product family id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_template_linked_families")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("LINKED PRODUCT FAMILY PERMANENT DELETE ERROR", error.message);
    redirectWithMessage("Linked product family could not be permanently deleted.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Linked product family permanently deleted.");
}

export async function createProductTemplateMaterialGroup(formData: FormData) {
  await requireProductLibraryManager();
  const redirectPath = returnPath(formData);
  const productTemplateId = textValue(formData, "product_template_id");
  const materialGroupId = textValue(formData, "material_group_id");
  const selectionMode = selectionModeValue(formData);
  const selectedMaterialIds = selectedMaterialIdsValue(formData);
  const selectedMaterialCategories = selectedMaterialCategoriesValue(formData);
  const payload = {
    product_template_id: productTemplateId,
    material_group_id: materialGroupId,
    selection_mode: selectionMode,
    label_override: optionalTextValue(formData, "label_override"),
    is_required: boolValue(formData, "is_required"),
    allow_multiple: true,
    show_in_specification: boolValue(formData, "show_in_specification"),
    show_in_quotation: boolValue(formData, "show_in_quotation"),
    sort_order: Math.trunc(numberValue(formData, "sort_order", 0)),
    is_active: true,
  };

  if (!productTemplateId || !materialGroupId) {
    redirectWithMessageToPath(redirectPath, "Select a product template and material group.");
  }

  const supabase = await createClient();
  if (selectionMode === "selected_items" && selectedMaterialIds.length === 0) {
    redirectWithMessageToPath(redirectPath, "Select at least one finish for selected finishes only.");
  }
  if (selectionMode === "selected_categories" && selectedMaterialCategories.length === 0) {
    redirectWithMessageToPath(redirectPath, "Select at least one category for Select by category.");
  }

  const { data: existingLink, error: existingLinkError } = await supabase
    .from("product_template_material_groups")
    .select("id,is_active")
    .eq("product_template_id", productTemplateId)
    .eq("material_group_id", materialGroupId)
    .maybeSingle();

  if (existingLinkError) {
    console.error("TEMPLATE MATERIAL GROUP EXISTING LOOKUP ERROR", existingLinkError.message);
    redirectWithMessageToPath(redirectPath, "Material group link could not be checked.");
  }

  if (existingLink?.id && existingLink.is_active) {
    redirectWithMessageToPath(
      redirectPath,
      "This material group is already linked. Edit the existing linked group card instead of adding it again.",
    );
  }

  const { data: link, error } = existingLink?.id
    ? await supabase
      .from("product_template_material_groups")
      .update(payload)
      .eq("id", existingLink.id)
      .select("id")
      .single()
    : await supabase
      .from("product_template_material_groups")
      .insert(payload)
      .select("id")
      .single();

  if (error) {
    console.error("TEMPLATE MATERIAL GROUP CREATE ERROR", error.message);
    redirectWithMessageToPath(redirectPath, "Material group could not be linked.");
  }

  if (link?.id) {
    const { error: deleteError } = await supabase
      .from("product_template_material_group_items")
      .delete()
      .eq("product_template_material_group_id", link.id);

    if (deleteError) {
      console.error("TEMPLATE MATERIAL GROUP ITEMS CLEAR ERROR", deleteError.message);
      redirectWithMessageToPath(redirectPath, "Material group finishes could not be saved.");
    }

    if (selectionMode !== "full_group") {
      const { data: groupMaterials, error: materialsError } = await supabase
        .from("brand_materials")
        .select("id,material_category,material_collection")
        .eq("material_group_id", materialGroupId)
        .eq("is_active", true);

      if (materialsError) {
        console.error("TEMPLATE MATERIAL GROUP ITEMS VALIDATE ERROR", materialsError.message);
        redirectWithMessageToPath(redirectPath, "Selected finishes could not be validated.");
      }

      const rows = (groupMaterials ?? [])
        .filter((material) => {
          if (selectionMode === "selected_categories") {
            return selectedMaterialCategories.includes(materialCategoryLabel(material));
          }

          return selectedMaterialIds.includes(material.id);
        })
        .map((material, index) => ({
          product_template_material_group_id: link.id,
          brand_material_id: material.id,
          sort_order: index,
          is_active: true,
        }));

      if (!rows.length) {
        redirectWithMessageToPath(
          redirectPath,
          selectionMode === "selected_categories"
            ? "Select at least one active finish category from the chosen group."
            : "Select at least one active finish from the chosen group.",
        );
      }

      const { error: itemsError } = await supabase
        .from("product_template_material_group_items")
        .insert(rows);

      if (itemsError) {
        console.error("TEMPLATE MATERIAL GROUP ITEMS CREATE ERROR", itemsError.message);
        redirectWithMessageToPath(redirectPath, "Selected finishes could not be saved.");
      }
    }
  }

  revalidatePath("/products/templates");
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessageToPath(redirectPath, "Material group linked.");
}

export async function updateProductTemplateMaterialGroup(formData: FormData) {
  await requireProductLibraryManager();
  const redirectPath = returnPath(formData);
  const id = textValue(formData, "id");
  const selectionMode = selectionModeValue(formData);
  const selectedMaterialIds = selectedMaterialIdsValue(formData);
  const selectedMaterialCategories = selectedMaterialCategoriesValue(formData);
  const payload = {
    selection_mode: selectionMode,
    label_override: optionalTextValue(formData, "label_override"),
    is_required: boolValue(formData, "is_required"),
    allow_multiple: true,
    show_in_specification: boolValue(formData, "show_in_specification"),
    show_in_quotation: boolValue(formData, "show_in_quotation"),
    sort_order: Math.trunc(numberValue(formData, "sort_order", 0)),
    is_active: boolValue(formData, "is_active"),
  };

  if (!id) {
    redirectWithMessageToPath(redirectPath, "Material group link id is required.");
  }

  const supabase = await createClient();
  if (selectionMode === "selected_items" && selectedMaterialIds.length === 0) {
    redirectWithMessageToPath(redirectPath, "Select at least one finish for selected finishes only.");
  }
  if (selectionMode === "selected_categories" && selectedMaterialCategories.length === 0) {
    redirectWithMessageToPath(redirectPath, "Select at least one category for Select by category.");
  }

  const { data: existingLink, error: linkError } = await supabase
    .from("product_template_material_groups")
    .select("material_group_id")
    .eq("id", id)
    .single();

  if (linkError || !existingLink) {
    console.error("TEMPLATE MATERIAL GROUP LOOKUP ERROR", linkError?.message ?? "Missing material group link.");
    redirectWithMessageToPath(redirectPath, "Material group link could not be loaded.");
  }

  const { error } = await supabase
    .from("product_template_material_groups")
    .update(payload)
    .eq("id", id);

  if (error) {
    console.error("TEMPLATE MATERIAL GROUP UPDATE ERROR", error.message);
    redirectWithMessageToPath(redirectPath, "Material group link could not be updated.");
  }

  const { error: deleteError } = await supabase
    .from("product_template_material_group_items")
    .delete()
    .eq("product_template_material_group_id", id);

  if (deleteError) {
    console.error("TEMPLATE MATERIAL GROUP ITEMS CLEAR ERROR", deleteError.message);
    redirectWithMessageToPath(redirectPath, "Material group finishes could not be saved.");
  }

  if (selectionMode !== "full_group") {
    const { data: groupMaterials, error: materialsError } = await supabase
      .from("brand_materials")
      .select("id,material_category,material_collection")
      .eq("material_group_id", existingLink.material_group_id)
      .eq("is_active", true);

    if (materialsError) {
      console.error("TEMPLATE MATERIAL GROUP ITEMS VALIDATE ERROR", materialsError.message);
      redirectWithMessageToPath(redirectPath, "Selected finishes could not be validated.");
    }

    const rows = (groupMaterials ?? [])
      .filter((material) => {
        if (selectionMode === "selected_categories") {
          return selectedMaterialCategories.includes(materialCategoryLabel(material));
        }

        return selectedMaterialIds.includes(material.id);
      })
      .map((material, index) => ({
        product_template_material_group_id: id,
        brand_material_id: material.id,
        sort_order: index,
        is_active: true,
      }));

    if (!rows.length) {
      redirectWithMessageToPath(
        redirectPath,
        selectionMode === "selected_categories"
          ? "Select at least one active finish category from this group."
          : "Select at least one active finish from this group.",
      );
    }

    const { error: itemsError } = await supabase
      .from("product_template_material_group_items")
      .insert(rows);

    if (itemsError) {
      console.error("TEMPLATE MATERIAL GROUP ITEMS UPDATE ERROR", itemsError.message);
      redirectWithMessageToPath(redirectPath, "Selected finishes could not be saved.");
    }
  }

  revalidatePath("/products/templates");
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessageToPath(redirectPath, "Material group link updated.");
}

export async function deactivateProductTemplateMaterialGroup(formData: FormData) {
  await requireProductLibraryManager();
  const redirectPath = returnPath(formData);
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessageToPath(redirectPath, "Material group link id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_template_material_groups")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("TEMPLATE MATERIAL GROUP DEACTIVATE ERROR", error.message);
    redirectWithMessageToPath(redirectPath, "Material group link could not be removed.");
  }

  revalidatePath("/products/templates");
  revalidatePath(splitRelativePath(redirectPath).pathname);
  redirectWithMessageToPath(redirectPath, "Material group link removed.");
}

export async function updateProductTemplateImage(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const field = textValue(formData, "image_field");
  const path = optionalTextValue(formData, "image_path");

  if (!id || !imageFieldSet.has(field as (typeof imageFields)[number])) {
    return { ok: false, message: "Template id and image field are required." };
  }

  const supabase = await createClient();
  const { data: currentTemplate, error: readError } = await supabase
    .from("product_templates")
    .select("image_settings")
    .eq("id", id)
    .single<{ image_settings: Record<string, unknown> | null }>();

  if (readError || !currentTemplate) {
    logServerActionError("PRODUCT TEMPLATE IMAGE READ ERROR", readError, {
      action: "updateProductTemplateImage",
      field,
      recordId: id,
      table: "product_templates",
    });
    return { ok: false, message: actionErrorMessage(`${imageSlotLabel(field)} could not be loaded`, readError) };
  }

  const nextImageSettings = { ...normalizedImageSettingsValue(currentTemplate.image_settings) };
  delete nextImageSettings[extraTemplateImagePathKey(field)];
  delete nextImageSettings[field];
  const safeImageSettings = normalizedImageSettingsValue(nextImageSettings);

  const response = await supabase
    .from("product_templates")
    .update({
      [field]: path,
      ...(field === "proposed_image_url_1" ? { default_image_url: path } : {}),
      image_settings: safeImageSettings,
    })
    .eq("id", id);

  const error = response.error;

  if (error) {
    logServerActionError("PRODUCT TEMPLATE IMAGE UPDATE ERROR", error, {
      action: "updateProductTemplateImage",
      field,
      imageSettingsNormalized: true,
      imageSlotsCleared: path ? [] : [field],
      imagePath: path,
      recordId: id,
      table: "product_templates",
    });
    return {
      ok: false,
      message: actionErrorMessage(
        path ? `${imageSlotLabel(field)} could not be saved` : `${imageSlotLabel(field)} could not be cleared`,
        error,
      ),
    };
  }

  revalidatePath("/products/templates");
  return { ok: true };
}

export async function updateProductTemplateImageSettings(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const field = textValue(formData, "image_field");

  if (!id || !imageFieldSet.has(field as (typeof imageFields)[number])) {
    return { ok: false, message: "Template id and image field are required." };
  }

  const supabase = await createClient();
  const { data: currentTemplate, error: readError } = await supabase
    .from("product_templates")
    .select("image_settings")
    .eq("id", id)
    .single<{ image_settings: Record<string, unknown> | null }>();

  if (readError || !currentTemplate) {
    logServerActionError("PRODUCT TEMPLATE IMAGE SETTINGS READ ERROR", readError, {
      action: "updateProductTemplateImageSettings",
      field,
      recordId: id,
      table: "product_templates",
    });
    return { ok: false, message: actionErrorMessage("Product image settings could not be loaded", readError) };
  }

  const { error } = await supabase
    .from("product_templates")
    .update({
      image_settings: {
        ...normalizedImageSettingsValue(currentTemplate.image_settings),
        [field]: imageDisplaySettingsValue(formData),
      },
    })
    .eq("id", id);

  if (error) {
    logServerActionError("PRODUCT TEMPLATE IMAGE SETTINGS UPDATE ERROR", error, {
      action: "updateProductTemplateImageSettings",
      field,
      recordId: id,
      table: "product_templates",
    });
    return { ok: false, message: actionErrorMessage("Product image settings could not be saved", error) };
  }

  revalidatePath("/products/templates");
  return { ok: true };
}

export async function createProductComponent(formData: FormData) {
  const { user } = await requireProductLibraryManager();
  const payload = componentPayload(formData, user.id);

  if (
    !payload.template_id ||
    !payload.option_type ||
    !payload.component_group ||
    !payload.component_name
  ) {
    redirectWithMessage(
      "Template, option type, option group, and option name are required.",
    );
  }

  if (!allowedOptionTypes.has(payload.option_type)) {
    redirectWithMessage("Select a valid option type.");
  }

  const supabase = await createClient();
  const { data: template, error: templateError } = await supabase
    .from("product_templates")
    .select("id")
    .eq("id", payload.template_id)
    .maybeSingle();

  if (templateError) {
    console.error("CREATE PRODUCT COMPONENT ERROR", templateError.message);
    redirectWithMessage("Template option could not be created.");
  }

  if (!template) {
    redirectWithMessage("Template was not found.");
  }

  const { error } = await supabase.from("product_components").insert(payload);

  if (error) {
    console.error("CREATE PRODUCT COMPONENT ERROR", error.message);
    redirectWithMessage("Template option could not be created.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Template option created.");
}

export async function updateProductComponent(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const payload = componentPayload(formData);

  if (
    !id ||
    !payload.template_id ||
    !payload.option_type ||
    !payload.component_group ||
    !payload.component_name
  ) {
    redirectWithMessage(
      "Option id, template, option type, option group, and option name are required.",
    );
  }

  if (!allowedOptionTypes.has(payload.option_type)) {
    redirectWithMessage("Select a valid option type.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_components")
    .update(payload)
    .eq("id", id);

  if (error) {
    console.error("PRODUCT COMPONENT UPDATE ERROR", error.message);
    redirectWithMessage("Template option could not be updated.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Template option updated.");
}

export async function deactivateProductComponent(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Option id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_components")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("PRODUCT COMPONENT DEACTIVATE ERROR", error.message);
    redirectWithMessage("Template option could not be deactivated.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Template option deactivated.");
}

export async function deactivateProductComponentGroup(formData: FormData) {
  await requireProductLibraryManager();
  const templateId = textValue(formData, "template_id");
  const optionType = textValue(formData, "option_type");
  const componentGroup = textValue(formData, "component_group");

  if (!templateId || !optionType || !componentGroup) {
    redirectWithMessage("Template, option type, and option group are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_components")
    .update({ is_active: false })
    .eq("template_id", templateId)
    .eq("option_type", optionType)
    .eq("component_group", componentGroup)
    .eq("is_active", true);

  if (error) {
    console.error("PRODUCT COMPONENT GROUP DEACTIVATE ERROR", error.message);
    redirectWithMessage("Template option group could not be deactivated.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Template option group deactivated.");
}

export async function markProductTemplatePriceChecked(
  templateId: string,
  note?: string | null,
  redirectPath = "/products/templates",
) {
  const { user, displayName } = await requireProductLibraryManager();

  if (!templateId) {
    redirectWithMessageToPath(redirectPath, "Template id is required.");
  }

  const supabase = await createClient();
  try {
    await markTemplatePriceCheckedRecord({
      actorName: displayName,
      createdBy: user.id,
      note,
      supabase,
      templateId,
    });
  } catch (error) {
    logServerActionError("TEMPLATE PRICE CHECK ERROR", error, {
      action: "markProductTemplatePriceChecked",
      recordId: templateId,
      table: "product_templates",
    });
    redirectWithMessageToPath(redirectPath, actionErrorMessage("Template price check could not be saved", error));
  }

  revalidatePath("/products/templates");
  redirectWithMessageToPath(redirectPath, "Template price check saved.");
}

export async function markTemplatePriceChecked(formData: FormData) {
  await markProductTemplatePriceChecked(
    textValue(formData, "id"),
    optionalTextValue(formData, "price_check_note"),
    returnPath(formData),
  );
}

export async function markTemplatePriceCheckedForQuotationModal(formData: FormData): Promise<ProductTemplateModalActionResult> {
  const templateId = textValue(formData, "id");
  const note = optionalTextValue(formData, "price_check_note");

  try {
    const { user, displayName } = await requireProductLibraryManager();

    if (!templateId) {
      return { ok: false, message: "Template id is required." };
    }

    const supabase = await createClient();
    await markTemplatePriceCheckedRecord({
      actorName: displayName,
      createdBy: user.id,
      note,
      supabase,
      templateId,
    });

    revalidatePath("/products/templates");
    return {
      ok: true,
      message: "Template price check saved.",
      template: await fetchProductLibraryTemplateForClient(supabase, templateId),
    };
  } catch (error) {
    logServerActionError("TEMPLATE PRICE CHECK MODAL UNEXPECTED ERROR", error, {
      action: "markTemplatePriceCheckedForQuotationModal",
      recordId: templateId,
      table: "product_templates",
    });
    return {
      ok: false,
      message: actionErrorMessage("Template price check could not be saved", error),
    };
  }
}

export async function markVisibleProductTemplatesPriceChecked(formData: FormData) {
  const { user, displayName } = await requireProductLibraryManager();
  const ids = Array.from(new Set(
    formData
      .getAll("template_id[]")
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean),
  ));

  if (!ids.length) {
    redirectWithMessage("No visible templates selected for price check.");
  }

  const supabase = await createClient();
  const { data: templates, error: templatesError } = await supabase
    .from("product_templates")
    .select("id,brand_id,template_name")
    .in("id", ids)
    .returns<Array<{ id: string; brand_id: string; template_name: string }>>();

  if (templatesError) {
    console.error("VISIBLE TEMPLATE PRICE CHECK READ ERROR", templatesError.message);
    redirectWithMessage("Visible template price checks could not be saved.");
  }

  const { error } = await supabase
    .from("product_templates")
    .update({
      last_price_checked_at: new Date().toISOString(),
      last_price_checked_by: user.id,
    })
    .in("id", ids);

  if (error) {
    console.error("VISIBLE TEMPLATE PRICE CHECK ERROR", error.message);
    redirectWithMessage("Visible template price checks could not be saved.");
  }

  for (const template of templates ?? []) {
    await createAuditLog(supabase, {
      entityType: "product_template",
      entityId: template.id,
      action: "price_checked",
      title: `${safeTemplateLabel(template.template_name)} price checked`,
      description: "Product template marked as price checked from the current filtered list.",
      metadata: {
        brandId: template.brand_id,
        source: "visible_templates_bulk_check",
      },
      actorName: displayName,
      createdBy: user.id,
    });
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Visible templates marked as price checked.");
}

export async function markBrandPriceListChecked(brandId: string, note?: string | null) {
  const { user, displayName } = await requireProductLibraryManager();

  if (!brandId) {
    redirectWithMessage("Brand id is required.");
  }

  const payload = {
    last_price_list_checked_at: new Date().toISOString(),
    last_price_list_checked_by: user.id,
    ...(note?.trim() ? { price_list_check_note: note.trim() } : {}),
  };
  const supabase = await createClient();
  const { data: brand, error: brandReadError } = await supabase
    .from("brands")
    .select("id,name")
    .eq("id", brandId)
    .maybeSingle<{ id: string; name: string }>();

  if (brandReadError || !brand) {
    console.error("BRAND PRICE LIST CHECK READ ERROR", brandReadError?.message);
    redirectWithMessage("Brand price list check could not be saved.");
  }

  const { error } = await supabase
    .from("brands")
    .update(payload)
    .eq("id", brandId);

  if (error) {
    console.error("BRAND PRICE LIST CHECK ERROR", error.message);
    redirectWithMessage("Brand price list check could not be saved.");
  }

  await createAuditLog(supabase, {
    entityType: "brand",
    entityId: brand.id,
    action: "price_checked",
    title: `${safeBrandLabel(brand.name)} price list checked`,
    description: "Brand price list marked as checked.",
    metadata: {
      note: note?.trim() || null,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/products/templates");
  redirectWithMessage("Brand price list check saved.");
}

export async function markBrandPriceListCheckedAction(formData: FormData) {
  await markBrandPriceListChecked(
    textValue(formData, "brand_id"),
    optionalTextValue(formData, "price_list_check_note"),
  );
}

export async function markBrandTemplatesPriceChecked(formData: FormData) {
  const { user, displayName } = await requireProductLibraryManager();
  const brandId = textValue(formData, "brand_id");

  if (!brandId) {
    redirectWithMessage("Brand id is required.");
  }

  const supabase = await createClient();
  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id,name")
    .eq("id", brandId)
    .maybeSingle<{ id: string; name: string }>();
  const { data: templates, error: templatesError } = await supabase
    .from("product_templates")
    .select("id,template_name")
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .returns<Array<{ id: string; template_name: string }>>();

  if (brandError || !brand || templatesError) {
    console.error("BRAND TEMPLATE PRICE CHECK READ ERROR", brandError?.message ?? templatesError?.message);
    redirectWithMessage("Brand templates could not be marked as checked.");
  }

  const { error } = await supabase
    .from("product_templates")
    .update({
      last_price_checked_at: new Date().toISOString(),
      last_price_checked_by: user.id,
    })
    .eq("brand_id", brandId)
    .eq("is_active", true);

  if (error) {
    console.error("BRAND TEMPLATE PRICE CHECK ERROR", error.message);
    redirectWithMessage("Brand templates could not be marked as checked.");
  }

  await createAuditLog(supabase, {
    entityType: "brand",
    entityId: brand.id,
    action: "price_checked",
    title: `${safeBrandLabel(brand.name)} templates marked checked`,
    description: "All active brand templates were marked as price checked.",
    metadata: {
      templateCount: (templates ?? []).length,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  for (const template of templates ?? []) {
    await createAuditLog(supabase, {
      entityType: "product_template",
      entityId: template.id,
      parentEntityType: "brand",
      parentEntityId: brand.id,
      action: "price_checked",
      title: `${safeTemplateLabel(template.template_name)} price checked`,
      description: "Product template marked as price checked from brand bulk action.",
      metadata: {
        source: "brand_templates_bulk_check",
      },
      actorName: displayName,
      createdBy: user.id,
    });
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Brand templates marked as price checked.");
}

export async function createBrandPriceListUpdate(formData: FormData) {
  const { user, displayName } = await requireProductLibraryManager();
  const brandId = textValue(formData, "brand_id");
  const title = textValue(formData, "title");

  if (!brandId || !title) {
    redirectWithMessage("Brand and price list title are required.");
  }

  const supabase = await createClient();
  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id")
    .eq("id", brandId)
    .eq("is_active", true)
    .maybeSingle<{ id: string }>();

  if (brandError || !brand) {
    console.error("BRAND PRICE LIST BRAND LOOKUP ERROR", brandError?.message);
    redirectWithMessage("Brand could not be loaded.");
  }

  const updatePayload = {
    brand_id: brandId,
    title,
    reference_no: optionalTextValue(formData, "reference_no"),
    currency: optionalTextValue(formData, "currency"),
    effective_from: optionalTextValue(formData, "effective_from"),
    received_at: optionalTextValue(formData, "received_at"),
    status: priceListUpdateStatusValue(formData),
    notes: optionalTextValue(formData, "notes"),
    attachment_url: optionalTextValue(formData, "attachment_url"),
    created_by: user.id,
  };
  const { data: createdUpdate, error } = await supabase
    .from("brand_price_list_updates")
    .insert(updatePayload)
    .select("id,brand_id,title,status")
    .single<{ id: string; brand_id: string; title: string; status: string }>();

  if (error || !createdUpdate) {
    console.error("BRAND PRICE LIST UPDATE CREATE ERROR", error?.message);
    redirectWithMessage("Brand price list update could not be saved.");
  }

  await createAuditLog(supabase, {
    entityType: "brand_price_list_update",
    entityId: createdUpdate.id,
    parentEntityType: "brand",
    parentEntityId: createdUpdate.brand_id,
    action: "created",
    title: `${createdUpdate.title} added`,
    description: "Brand price list update added.",
    metadata: {
      status: createdUpdate.status,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/products/templates");
  redirectWithMessage("Brand price list update saved.");
}

export async function updateBrandPriceListUpdate(formData: FormData) {
  const { user, displayName } = await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const title = textValue(formData, "title");

  if (!id || !title) {
    redirectWithMessage("Price list update id and title are required.");
  }

  const supabase = await createClient();
  const { data: currentUpdate, error: currentUpdateError } = await supabase
    .from("brand_price_list_updates")
    .select("id,brand_id,title,status")
    .eq("id", id)
    .maybeSingle<{ id: string; brand_id: string; title: string; status: string }>();

  if (currentUpdateError || !currentUpdate) {
    console.error("BRAND PRICE LIST UPDATE READ ERROR", currentUpdateError?.message);
    redirectWithMessage("Brand price list update could not be updated.");
  }

  const { error } = await supabase
    .from("brand_price_list_updates")
    .update({
      title,
      reference_no: optionalTextValue(formData, "reference_no"),
      currency: optionalTextValue(formData, "currency"),
      effective_from: optionalTextValue(formData, "effective_from"),
      received_at: optionalTextValue(formData, "received_at"),
      status: priceListUpdateStatusValue(formData),
      notes: optionalTextValue(formData, "notes"),
      attachment_url: optionalTextValue(formData, "attachment_url"),
    })
    .eq("id", id);

  if (error) {
    console.error("BRAND PRICE LIST UPDATE UPDATE ERROR", error.message);
    redirectWithMessage("Brand price list update could not be updated.");
  }

  await createAuditLog(supabase, {
    entityType: "brand_price_list_update",
    entityId: currentUpdate.id,
    parentEntityType: "brand",
    parentEntityId: currentUpdate.brand_id,
    action: "updated",
    title: `${title} updated`,
    description: "Brand price list update edited.",
    metadata: {
      previousStatus: currentUpdate.status,
      title,
    },
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/products/templates");
  redirectWithMessage("Brand price list update updated.");
}

export async function archiveBrandPriceListUpdate(formData: FormData) {
  const { user, displayName } = await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Price list update id is required.");
  }

  const supabase = await createClient();
  const { data: currentUpdate, error: currentUpdateError } = await supabase
    .from("brand_price_list_updates")
    .select("id,brand_id,title")
    .eq("id", id)
    .maybeSingle<{ id: string; brand_id: string; title: string }>();

  if (currentUpdateError || !currentUpdate) {
    console.error("BRAND PRICE LIST UPDATE ARCHIVE READ ERROR", currentUpdateError?.message);
    redirectWithMessage("Brand price list update could not be archived.");
  }

  const { error } = await supabase
    .from("brand_price_list_updates")
    .update({ status: "archived" })
    .eq("id", id);

  if (error) {
    console.error("BRAND PRICE LIST UPDATE ARCHIVE ERROR", error.message);
    redirectWithMessage("Brand price list update could not be archived.");
  }

  await createAuditLog(supabase, {
    entityType: "brand_price_list_update",
    entityId: currentUpdate.id,
    parentEntityType: "brand",
    parentEntityId: currentUpdate.brand_id,
    action: "archived",
    title: `${currentUpdate.title} archived`,
    description: "Brand price list update archived.",
    actorName: displayName,
    createdBy: user.id,
  });

  revalidatePath("/products/templates");
  redirectWithMessage("Brand price list update archived.");
}

export async function markComponentPriceChecked(formData: FormData) {
  const { user } = await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Option id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_components")
    .update({
      last_price_checked_at: new Date().toISOString(),
      last_price_checked_by: user.id,
    })
    .eq("id", id);

  if (error) {
    console.error("COMPONENT PRICE CHECK ERROR", error.message);
    redirectWithMessage("Option price check could not be saved.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Option price check saved.");
}
