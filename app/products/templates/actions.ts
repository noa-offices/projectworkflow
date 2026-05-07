"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSettingsManager } from "@/lib/auth";
import { defaultCurrency, normalizeCurrency } from "@/lib/currencies";
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
const imageFields = new Set([
  "proposed_image_url_1",
  "proposed_image_url_2",
  "proposed_image_url_3",
]);
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
  return textValue(formData, "selection_mode") === "selected_items" ? "selected_items" : "full_group";
}

function selectedMaterialIdsValue(formData: FormData) {
  return Array.from(new Set(
    formData
      .getAll("brand_material_id[]")
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean),
  ));
}

function priceListUpdateStatusValue(formData: FormData) {
  const status = textValue(formData, "status") || "draft";

  return priceListUpdateStatuses.has(status) ? status : "draft";
}

function detailPriceSourceValue(value: string): DetailPriceSourceTable | null {
  return value in detailPriceFieldsBySource ? value as DetailPriceSourceTable : null;
}

function detailPriceFieldIsAllowed(sourceTable: DetailPriceSourceTable, priceField: string) {
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

  if (sourceTable === "product_templates.accessory_pricing") {
    const nextRows = rows.map((group) => ({
      ...group,
      items: jsonArrayValue(group.items).map(updateRow),
    }));

    return { matched, oldPrice, rows: nextRows };
  }

  const nextRows = rows.map(updateRow);
  return { matched, oldPrice, rows: nextRows };
}

function numberInRange(formData: FormData, name: string, fallback: number, min: number, max: number) {
  const value = numberValue(formData, name, fallback);

  return Math.min(Math.max(value, min), max);
}

function redirectWithMessage(message: string): never {
  redirect(`/products/templates?message=${encodeURIComponent(message)}`);
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
  const { user } = await requireSettingsManager();
  const brandId = textValue(formData, "brand_id");
  const name = textValue(formData, "name");
  const returnMode = textValue(formData, "return_mode");

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
      code: optionalTextValue(formData, "code"),
      description: optionalTextValue(formData, "description"),
      is_active: boolValue(formData, "is_active"),
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
  const { user } = await requireSettingsManager();
  const brandId = textValue(formData, "brand_id");
  const parentId = textValue(formData, "parent_id");
  const name = textValue(formData, "name");
  const returnMode = textValue(formData, "return_mode");

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
      code: optionalTextValue(formData, "code"),
      description: optionalTextValue(formData, "description"),
      is_active: boolValue(formData, "is_active"),
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

function imageSettingsValue(formData: FormData) {
  const settings: Record<string, ReturnType<typeof imageDisplaySettingsValue>> = {};

  for (const field of imageFields) {
    const rawValue = textValue(formData, `image_settings_${field}`);
    if (!rawValue) continue;

    try {
      const parsed = JSON.parse(rawValue) as {
        fit?: string;
        zoom?: number;
        positionX?: number;
        positionY?: number;
      };

      settings[field] = {
        fit: parsed.fit === "cover" ? "cover" : "contain",
        zoom: Math.min(Math.max(Number(parsed.zoom) || 1, 1), 3),
        positionX: Math.min(Math.max(Number(parsed.positionX) || 50, 0), 100),
        positionY: Math.min(Math.max(Number(parsed.positionY) || 50, 0), 100),
      };
    } catch {
      // Ignore malformed client-side display metadata.
    }
  }

  return Object.keys(settings).length ? settings : undefined;
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

        return {
          id: typeof row.id === "string" && row.id ? row.id : `size-${index}`,
          label: label
              ? label
              : Number.isFinite(length) && Number.isFinite(depth) && Number.isFinite(height)
                ? `${length} x ${depth} x ${height}`
                : "",
          length: Number.isFinite(length) ? length : 0,
          depth: Number.isFinite(depth) ? depth : 0,
          height: Number.isFinite(height) ? height : 0,
          dimension_unit:
            typeof row.dimension_unit === "string" && row.dimension_unit.trim()
              ? row.dimension_unit.trim()
              : "cm",
          default_price: Number.isFinite(defaultPrice) ? defaultPrice : 0,
          additional_price: Number.isFinite(additionalPrice) ? additionalPrice : 0,
          currency: normalizeCurrency(
            typeof row.currency === "string" ? row.currency : defaultCurrency,
          ),
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
          row.additional_price > 0,
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
        dimension: typeof row.dimension === "string" ? row.dimension.trim() : "",
        price: Number.isFinite(Number(row.price)) ? Number(row.price) : 0,
        currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
        specification: typeof row.specification === "string" ? row.specification.trim() : "",
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
        is_active: row.is_active !== false,
      }))
      .filter((row) => row.variant_name || row.dimension || row.price > 0 || row.specification);
  } catch {
    return [];
  }
}

function categoryPricingValue(formData: FormData) {
  const rawValue = textValue(formData, "category_pricing");
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((row, index) => {
        const prices = typeof row.prices === "object" && row.prices !== null
          ? row.prices as Record<string, unknown>
          : {};

        return {
          id: typeof row.id === "string" && row.id ? row.id : `category-${index}`,
          variant_name: typeof row.variant_name === "string" ? row.variant_name.trim() : "",
          dimension: typeof row.dimension === "string" ? row.dimension.trim() : "",
          currency: normalizeCurrency(typeof row.currency === "string" ? row.currency : defaultCurrency),
          prices: {
            "Cat A": Number.isFinite(Number(prices["Cat A"])) ? Number(prices["Cat A"]) : 0,
            "Cat B": Number.isFinite(Number(prices["Cat B"])) ? Number(prices["Cat B"]) : 0,
            "Cat C": Number.isFinite(Number(prices["Cat C"])) ? Number(prices["Cat C"]) : 0,
            "Cat D": Number.isFinite(Number(prices["Cat D"])) ? Number(prices["Cat D"]) : 0,
          },
          specification: typeof row.specification === "string" ? row.specification.trim() : "",
          sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
          is_active: row.is_active !== false,
        };
      })
      .filter((row) => row.variant_name || row.dimension || Object.values(row.prices).some((price) => price > 0) || row.specification);
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
              .filter((item) => item.item_name || item.price > 0 || item.specification)
          : [];

        return {
          id: typeof row.id === "string" && row.id ? row.id : `add-on-group-${index}`,
          group_name: typeof row.group_name === "string" && row.group_name.trim()
            ? row.group_name.trim()
            : "Accessories",
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
        sort_order: groups.length,
        is_active: true,
        items: flatRows
          .map(normalizeItem)
          .filter((item) => item.item_name || item.price > 0 || item.specification),
      });
    }

    return groups.filter((group) => group.items.length);
  } catch {
    return [];
  }
}

function templatePayload(formData: FormData, userId?: string) {
  const payload = {
    brand_id: textValue(formData, "brand_id"),
    main_category_id: optionalTextValue(formData, "main_category_id"),
    sub_category_id: optionalTextValue(formData, "sub_category_id"),
    template_code: optionalTextValue(formData, "template_code"),
    template_name: textValue(formData, "template_name"),
    item_code: optionalTextValue(formData, "item_code"),
    description: optionalTextValue(formData, "description"),
    default_specification: optionalTextValue(formData, "default_specification"),
    origin: optionalTextValue(formData, "origin"),
    supplier_name: optionalTextValue(formData, "supplier_name"),
    default_image_url: optionalTextValue(formData, "proposed_image_url_1"),
    proposed_image_url_1: optionalTextValue(formData, "proposed_image_url_1"),
    proposed_image_url_2: optionalTextValue(formData, "proposed_image_url_2"),
    proposed_image_url_3: optionalTextValue(formData, "proposed_image_url_3"),
    reference_image_url: optionalTextValue(formData, "reference_image_url"),
    desking_size_pricing: deskingSizePricingValue(formData),
    variant_pricing: variantPricingValue(formData),
    category_pricing: categoryPricingValue(formData),
    accessory_pricing: accessoryPricingValue(formData),
    unit_label: textValue(formData, "unit_label") || "Pc",
    currency: normalizeCurrency(textValue(formData, "currency") || defaultCurrency),
    default_unit_price: numberValue(formData, "default_unit_price", 0),
    is_active: boolValue(formData, "is_active"),
    price_notes: optionalTextValue(formData, "price_notes"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}

function createTemplatePayload(formData: FormData, userId: string) {
  const id = optionalTextValue(formData, "id");
  const imageSettings = imageSettingsValue(formData);
  const payload = {
    ...templatePayload(formData, userId),
    ...(imageSettings ? { image_settings: imageSettings } : {}),
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
  const { user } = await requireSettingsManager();
  const payload = createTemplatePayload(formData, user.id);

  if (!payload.brand_id || !payload.template_name) {
    redirectWithMessage("Brand and template name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("product_templates").insert(payload);

  if (error) {
    console.error("PRODUCT TEMPLATE CREATE ERROR", error.message);
    redirectWithMessage("Product template could not be created.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Product template created.");
}

export async function updateProductTemplate(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");
  const payload = templatePayload(formData);

  if (!id || !payload.brand_id || !payload.template_name) {
    redirectWithMessage("Template id, brand, and template name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_templates")
    .update(payload)
    .eq("id", id);

  if (error) {
    console.error("PRODUCT TEMPLATE UPDATE ERROR", error.message);
    redirectWithMessage("Product template could not be updated.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Product template updated.");
}

export async function updateProductTemplateDefaultPrice(formData: FormData) {
  const { user } = await requireSettingsManager();
  const productTemplateId = textValue(formData, "product_template_id");
  const newDefaultUnitPrice = numberValue(formData, "new_default_unit_price", Number.NaN);
  const currency = normalizeCurrency(textValue(formData, "currency") || defaultCurrency);
  const brandPriceListUpdateId = optionalTextValue(formData, "brand_price_list_update_id");
  const effectiveFrom = optionalTextValue(formData, "effective_from");
  const note = optionalTextValue(formData, "note");

  if (!productTemplateId || !Number.isFinite(newDefaultUnitPrice) || newDefaultUnitPrice < 0) {
    redirectWithMessage("Template and valid new price are required.");
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
    redirectWithMessage("Product template could not be loaded.");
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
      redirectWithMessage("Selected brand price list update could not be loaded.");
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
    redirectWithMessage("Product template price history could not be saved.");
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
    redirectWithMessage("Product template source price could not be updated.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Product template source price updated.");
}

export async function updateProductTemplateDetailPrice(formData: FormData) {
  const { user } = await requireSettingsManager();
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
    redirectWithMessage("Template, source row, price field, and valid new price are required.");
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
    redirectWithMessage("Product template could not be loaded.");
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
      redirectWithMessage("Selected brand price list update could not be loaded.");
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
      redirectWithMessage("Component price source could not be loaded.");
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
      redirectWithMessage("Template price row could not be found.");
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
    redirectWithMessage("Detail price history could not be saved.");
  }

  if (sourceTable === "product_components") {
    const { error: componentUpdateError } = await supabase
      .from("product_components")
      .update(updatePayload)
      .eq("id", componentSourceId);

    if (componentUpdateError) {
      console.error("DETAIL PRICE COMPONENT UPDATE ERROR", componentUpdateError.message);
      redirectWithMessage("Component source price could not be updated.");
    }
  } else {
    const { error: jsonUpdateError } = await supabase
      .from("product_templates")
      .update(updatePayload)
      .eq("id", template.id);

    if (jsonUpdateError) {
      console.error("DETAIL PRICE JSON UPDATE ERROR", jsonUpdateError.message);
      redirectWithMessage("Template detail source price could not be updated.");
    }
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Detail source price updated.");
}

export async function deactivateProductTemplate(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Product template id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_templates")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("PRODUCT TEMPLATE ARCHIVE ERROR", error.message);
    redirectWithMessage("Product template could not be moved to Archive.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Product template moved to Archive.");
}

export async function restoreProductTemplate(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Product template id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_templates")
    .update({ is_active: true })
    .eq("id", id);

  if (error) {
    console.error("PRODUCT TEMPLATE RESTORE ERROR", error.message);
    redirectWithMessage("Product template could not be restored.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Product template restored.");
}

export async function permanentlyDeleteProductTemplate(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Product template id is required.");
  }

  const supabase = await createClient();
  const { count: quotationItemCount, error: quotationItemError } = await supabase
    .from("quotation_items")
    .select("id", { count: "exact", head: true })
    .eq("source_template_id", id);
  const { count: linkedFamilyCount, error: linkedFamilyError } = await supabase
    .from("product_template_linked_families")
    .select("id", { count: "exact", head: true })
    .or(`parent_template_id.eq.${id},linked_template_id.eq.${id}`);

  if (quotationItemError || linkedFamilyError) {
    console.error(
      "PRODUCT TEMPLATE DEPENDENCY CHECK ERROR",
      quotationItemError?.message ?? linkedFamilyError?.message,
    );
    redirectWithMessage("Product template dependencies could not be checked.");
  }

  if ((quotationItemCount ?? 0) > 0 || (linkedFamilyCount ?? 0) > 0) {
    redirectWithMessage(
      "This product template is used in quotations or linked product families. Keep it archived.",
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

export async function createLinkedProductFamily(formData: FormData) {
  await requireSettingsManager();
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
  await requireSettingsManager();
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
  await requireSettingsManager();
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
  await requireSettingsManager();
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
  await requireSettingsManager();
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
  await requireSettingsManager();
  const productTemplateId = textValue(formData, "product_template_id");
  const materialGroupId = textValue(formData, "material_group_id");
  const selectionMode = selectionModeValue(formData);
  const selectedMaterialIds = selectedMaterialIdsValue(formData);
  const payload = {
    product_template_id: productTemplateId,
    material_group_id: materialGroupId,
    selection_mode: selectionMode,
    label_override: optionalTextValue(formData, "label_override"),
    is_required: boolValue(formData, "is_required"),
    allow_multiple: boolValue(formData, "allow_multiple"),
    show_in_specification: boolValue(formData, "show_in_specification"),
    show_in_quotation: boolValue(formData, "show_in_quotation"),
    sort_order: Math.trunc(numberValue(formData, "sort_order", 0)),
    is_active: true,
  };

  if (!productTemplateId || !materialGroupId) {
    redirectWithMessage("Select a product template and material group.");
  }

  const supabase = await createClient();
  if (selectionMode === "selected_items" && selectedMaterialIds.length === 0) {
    redirectWithMessage("Select at least one finish for selected finishes only.");
  }

  const { data: link, error } = await supabase
    .from("product_template_material_groups")
    .upsert(payload, { onConflict: "product_template_id,material_group_id" })
    .select("id")
    .single();

  if (error) {
    console.error("TEMPLATE MATERIAL GROUP CREATE ERROR", error.message);
    redirectWithMessage("Material group could not be linked.");
  }

  if (link?.id) {
    const { error: deleteError } = await supabase
      .from("product_template_material_group_items")
      .delete()
      .eq("product_template_material_group_id", link.id);

    if (deleteError) {
      console.error("TEMPLATE MATERIAL GROUP ITEMS CLEAR ERROR", deleteError.message);
      redirectWithMessage("Material group finishes could not be saved.");
    }

    if (selectionMode === "selected_items") {
      const { data: allowedMaterials, error: materialsError } = await supabase
        .from("brand_materials")
        .select("id")
        .eq("material_group_id", materialGroupId)
        .eq("is_active", true)
        .in("id", selectedMaterialIds);

      if (materialsError) {
        console.error("TEMPLATE MATERIAL GROUP ITEMS VALIDATE ERROR", materialsError.message);
        redirectWithMessage("Selected finishes could not be validated.");
      }

      const allowedIds = new Set((allowedMaterials ?? []).map((material) => material.id as string));
      const rows = selectedMaterialIds
        .filter((id) => allowedIds.has(id))
        .map((brandMaterialId, index) => ({
          product_template_material_group_id: link.id,
          brand_material_id: brandMaterialId,
          sort_order: index,
          is_active: true,
        }));

      if (!rows.length) {
        redirectWithMessage("Select at least one active finish from the chosen group.");
      }

      const { error: itemsError } = await supabase
        .from("product_template_material_group_items")
        .insert(rows);

      if (itemsError) {
        console.error("TEMPLATE MATERIAL GROUP ITEMS CREATE ERROR", itemsError.message);
        redirectWithMessage("Selected finishes could not be saved.");
      }
    }
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Material group linked.");
}

export async function updateProductTemplateMaterialGroup(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");
  const selectionMode = selectionModeValue(formData);
  const selectedMaterialIds = selectedMaterialIdsValue(formData);
  const payload = {
    selection_mode: selectionMode,
    label_override: optionalTextValue(formData, "label_override"),
    is_required: boolValue(formData, "is_required"),
    allow_multiple: boolValue(formData, "allow_multiple"),
    show_in_specification: boolValue(formData, "show_in_specification"),
    show_in_quotation: boolValue(formData, "show_in_quotation"),
    sort_order: Math.trunc(numberValue(formData, "sort_order", 0)),
    is_active: boolValue(formData, "is_active"),
  };

  if (!id) {
    redirectWithMessage("Material group link id is required.");
  }

  const supabase = await createClient();
  if (selectionMode === "selected_items" && selectedMaterialIds.length === 0) {
    redirectWithMessage("Select at least one finish for selected finishes only.");
  }

  const { data: existingLink, error: linkError } = await supabase
    .from("product_template_material_groups")
    .select("material_group_id")
    .eq("id", id)
    .single();

  if (linkError || !existingLink) {
    console.error("TEMPLATE MATERIAL GROUP LOOKUP ERROR", linkError?.message ?? "Missing material group link.");
    redirectWithMessage("Material group link could not be loaded.");
  }

  const { error } = await supabase
    .from("product_template_material_groups")
    .update(payload)
    .eq("id", id);

  if (error) {
    console.error("TEMPLATE MATERIAL GROUP UPDATE ERROR", error.message);
    redirectWithMessage("Material group link could not be updated.");
  }

  const { error: deleteError } = await supabase
    .from("product_template_material_group_items")
    .delete()
    .eq("product_template_material_group_id", id);

  if (deleteError) {
    console.error("TEMPLATE MATERIAL GROUP ITEMS CLEAR ERROR", deleteError.message);
    redirectWithMessage("Material group finishes could not be saved.");
  }

  if (selectionMode === "selected_items") {
    const { data: allowedMaterials, error: materialsError } = await supabase
      .from("brand_materials")
      .select("id")
      .eq("material_group_id", existingLink.material_group_id)
      .eq("is_active", true)
      .in("id", selectedMaterialIds);

    if (materialsError) {
      console.error("TEMPLATE MATERIAL GROUP ITEMS VALIDATE ERROR", materialsError.message);
      redirectWithMessage("Selected finishes could not be validated.");
    }

    const allowedIds = new Set((allowedMaterials ?? []).map((material) => material.id as string));
    const rows = selectedMaterialIds
      .filter((brandMaterialId) => allowedIds.has(brandMaterialId))
      .map((brandMaterialId, index) => ({
        product_template_material_group_id: id,
        brand_material_id: brandMaterialId,
        sort_order: index,
        is_active: true,
      }));

    if (!rows.length) {
      redirectWithMessage("Select at least one active finish from this group.");
    }

    const { error: itemsError } = await supabase
      .from("product_template_material_group_items")
      .insert(rows);

    if (itemsError) {
      console.error("TEMPLATE MATERIAL GROUP ITEMS UPDATE ERROR", itemsError.message);
      redirectWithMessage("Selected finishes could not be saved.");
    }
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Material group link updated.");
}

export async function deactivateProductTemplateMaterialGroup(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Material group link id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_template_material_groups")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("TEMPLATE MATERIAL GROUP DEACTIVATE ERROR", error.message);
    redirectWithMessage("Material group link could not be removed.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Material group link removed.");
}

export async function updateProductTemplateImage(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");
  const field = textValue(formData, "image_field");
  const path = optionalTextValue(formData, "image_path");

  if (!id || !imageFields.has(field)) {
    return { ok: false, message: "Template id and image field are required." };
  }

  const supabase = await createClient();
  const updates = {
    [field]: path,
    ...(field === "proposed_image_url_1" ? { default_image_url: path } : {}),
  };
  const { error } = await supabase
    .from("product_templates")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("PRODUCT TEMPLATE IMAGE UPDATE ERROR", error.message);
    return { ok: false, message: "Product template image could not be saved." };
  }

  revalidatePath("/products/templates");
  return { ok: true };
}

export async function updateProductTemplateImageSettings(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");
  const field = textValue(formData, "image_field");

  if (!id || !imageFields.has(field)) {
    return { ok: false, message: "Template id and image field are required." };
  }

  const supabase = await createClient();
  const { data: currentTemplate, error: readError } = await supabase
    .from("product_templates")
    .select("image_settings")
    .eq("id", id)
    .single<{ image_settings: Record<string, unknown> | null }>();

  if (readError || !currentTemplate) {
    console.error("PRODUCT TEMPLATE IMAGE SETTINGS READ ERROR", readError?.message);
    return { ok: false, message: "Product image settings could not be loaded." };
  }

  const { error } = await supabase
    .from("product_templates")
    .update({
      image_settings: {
        ...(currentTemplate.image_settings ?? {}),
        [field]: imageDisplaySettingsValue(formData),
      },
    })
    .eq("id", id);

  if (error) {
    console.error("PRODUCT TEMPLATE IMAGE SETTINGS UPDATE ERROR", error.message);
    return { ok: false, message: "Product image settings could not be saved." };
  }

  revalidatePath("/products/templates");
  return { ok: true };
}

export async function createProductComponent(formData: FormData) {
  const { user } = await requireSettingsManager();
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
  await requireSettingsManager();
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
  await requireSettingsManager();
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
  await requireSettingsManager();
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

export async function markProductTemplatePriceChecked(templateId: string, note?: string | null) {
  const { user } = await requireSettingsManager();

  if (!templateId) {
    redirectWithMessage("Template id is required.");
  }

  const payload = {
    last_price_checked_at: new Date().toISOString(),
    last_price_checked_by: user.id,
    ...(note?.trim() ? { price_check_note: note.trim() } : {}),
  };
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_templates")
    .update(payload)
    .eq("id", templateId);

  if (error) {
    console.error("TEMPLATE PRICE CHECK ERROR", error.message);
    redirectWithMessage("Template price check could not be saved.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Template price check saved.");
}

export async function markTemplatePriceChecked(formData: FormData) {
  await markProductTemplatePriceChecked(
    textValue(formData, "id"),
    optionalTextValue(formData, "price_check_note"),
  );
}

export async function markVisibleProductTemplatesPriceChecked(formData: FormData) {
  const { user } = await requireSettingsManager();
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

  revalidatePath("/products/templates");
  redirectWithMessage("Visible templates marked as price checked.");
}

export async function markBrandPriceListChecked(brandId: string, note?: string | null) {
  const { user } = await requireSettingsManager();

  if (!brandId) {
    redirectWithMessage("Brand id is required.");
  }

  const payload = {
    last_price_list_checked_at: new Date().toISOString(),
    last_price_list_checked_by: user.id,
    ...(note?.trim() ? { price_list_check_note: note.trim() } : {}),
  };
  const supabase = await createClient();
  const { error } = await supabase
    .from("brands")
    .update(payload)
    .eq("id", brandId);

  if (error) {
    console.error("BRAND PRICE LIST CHECK ERROR", error.message);
    redirectWithMessage("Brand price list check could not be saved.");
  }

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
  const { user } = await requireSettingsManager();
  const brandId = textValue(formData, "brand_id");

  if (!brandId) {
    redirectWithMessage("Brand id is required.");
  }

  const supabase = await createClient();
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

  revalidatePath("/products/templates");
  redirectWithMessage("Brand templates marked as price checked.");
}

export async function createBrandPriceListUpdate(formData: FormData) {
  const { user } = await requireSettingsManager();
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

  const { error } = await supabase.from("brand_price_list_updates").insert({
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
  });

  if (error) {
    console.error("BRAND PRICE LIST UPDATE CREATE ERROR", error.message);
    redirectWithMessage("Brand price list update could not be saved.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Brand price list update saved.");
}

export async function updateBrandPriceListUpdate(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");
  const title = textValue(formData, "title");

  if (!id || !title) {
    redirectWithMessage("Price list update id and title are required.");
  }

  const supabase = await createClient();
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

  revalidatePath("/products/templates");
  redirectWithMessage("Brand price list update updated.");
}

export async function archiveBrandPriceListUpdate(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Price list update id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_price_list_updates")
    .update({ status: "archived" })
    .eq("id", id);

  if (error) {
    console.error("BRAND PRICE LIST UPDATE ARCHIVE ERROR", error.message);
    redirectWithMessage("Brand price list update could not be archived.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Brand price list update archived.");
}

export async function markComponentPriceChecked(formData: FormData) {
  const { user } = await requireSettingsManager();
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
