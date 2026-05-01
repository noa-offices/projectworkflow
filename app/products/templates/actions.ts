"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSettingsManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const allowedOptionTypes = new Set([
  "material_finish",
  "fabric_category",
  "size_variant",
  "cluster_preset",
  "linked_addon",
  "other",
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

function redirectWithMessage(message: string): never {
  redirect(`/products/templates?message=${encodeURIComponent(message)}`);
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
    default_image_url: optionalTextValue(formData, "default_image_url"),
    reference_image_url: optionalTextValue(formData, "reference_image_url"),
    unit_label: textValue(formData, "unit_label") || "Pc",
    currency: textValue(formData, "currency") || "AED",
    default_unit_price: numberValue(formData, "default_unit_price", 0),
    is_active: boolValue(formData, "is_active"),
    price_notes: optionalTextValue(formData, "price_notes"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
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
    currency: textValue(formData, "currency") || "AED",
    is_optional: boolValue(formData, "is_optional"),
    is_default_selected: boolValue(formData, "is_default_selected"),
    sort_order: Math.trunc(numberValue(formData, "sort_order", 0)),
    is_active: boolValue(formData, "is_active"),
    price_notes: optionalTextValue(formData, "price_notes"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}

export async function createProductTemplate(formData: FormData) {
  const { user } = await requireSettingsManager();
  const payload = templatePayload(formData, user.id);

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
    console.error("CREATE PRODUCT COMPONENT ERROR", templateError);
    redirectWithMessage("Template option could not be created.");
  }

  if (!template) {
    redirectWithMessage("Template was not found.");
  }

  const { error } = await supabase.from("product_components").insert(payload);

  if (error) {
    console.error("CREATE PRODUCT COMPONENT ERROR", error);
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
