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

function numberInRange(formData: FormData, name: string, fallback: number, min: number, max: number) {
  const value = numberValue(formData, name, fallback);

  return Math.min(Math.max(value, min), max);
}

function redirectWithMessage(message: string): never {
  redirect(`/products/templates?message=${encodeURIComponent(message)}`);
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

export async function markTemplatePriceChecked(formData: FormData) {
  const { user } = await requireSettingsManager();
  const id = textValue(formData, "id");

  if (!id) {
    redirectWithMessage("Template id is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_templates")
    .update({
      last_price_checked_at: new Date().toISOString(),
      last_price_checked_by: user.id,
    })
    .eq("id", id);

  if (error) {
    console.error("TEMPLATE PRICE CHECK ERROR", error.message);
    redirectWithMessage("Template price check could not be saved.");
  }

  revalidatePath("/products/templates");
  redirectWithMessage("Template price check saved.");
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
