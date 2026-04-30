"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSettingsManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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

function numberValue(formData: FormData, name: string) {
  const value = Number.parseInt(textValue(formData, name), 10);
  return Number.isFinite(value) ? value : 0;
}

function redirectWithMessage(message: string): never {
  redirect(`/products/brands?message=${encodeURIComponent(message)}`);
}

export async function createBrand(formData: FormData) {
  const { user } = await requireSettingsManager();
  const name = textValue(formData, "name");

  if (!name) {
    redirectWithMessage("Brand name is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("brands").insert({
    name,
    code: optionalTextValue(formData, "code"),
    description: optionalTextValue(formData, "description"),
    website: optionalTextValue(formData, "website"),
    logo_url: optionalTextValue(formData, "logo_url"),
    is_active: boolValue(formData, "is_active"),
    created_by: user.id,
  });

  if (error) {
    console.error("BRAND CREATE ERROR", error.message);
    redirectWithMessage("Brand could not be created.");
  }

  revalidatePath("/products/brands");
  redirectWithMessage("Brand created.");
}

export async function updateBrand(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");
  const name = textValue(formData, "name");

  if (!id || !name) {
    redirectWithMessage("Brand id and name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("brands")
    .update({
      name,
      code: optionalTextValue(formData, "code"),
      description: optionalTextValue(formData, "description"),
      website: optionalTextValue(formData, "website"),
      logo_url: optionalTextValue(formData, "logo_url"),
      is_active: boolValue(formData, "is_active"),
    })
    .eq("id", id);

  if (error) {
    console.error("BRAND UPDATE ERROR", error.message);
    redirectWithMessage("Brand could not be updated.");
  }

  revalidatePath("/products/brands");
  redirectWithMessage("Brand updated.");
}

export async function createCategory(formData: FormData) {
  const { user } = await requireSettingsManager();
  const brandId = textValue(formData, "brand_id");
  const parentId = optionalTextValue(formData, "parent_id");
  const name = textValue(formData, "name");

  if (!brandId || !name) {
    redirectWithMessage("Category brand and name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("product_categories").insert({
    brand_id: brandId,
    parent_id: parentId,
    name,
    code: optionalTextValue(formData, "code"),
    description: optionalTextValue(formData, "description"),
    is_active: boolValue(formData, "is_active"),
    sort_order: numberValue(formData, "sort_order"),
    created_by: user.id,
  });

  if (error) {
    console.error("CATEGORY CREATE ERROR", error.message);
    redirectWithMessage("Category could not be created.");
  }

  revalidatePath("/products/brands");
  redirectWithMessage("Category created.");
}

export async function updateCategory(formData: FormData) {
  await requireSettingsManager();
  const id = textValue(formData, "id");
  const brandId = textValue(formData, "brand_id");
  const parentId = optionalTextValue(formData, "parent_id");
  const name = textValue(formData, "name");

  if (!id || !brandId || !name) {
    redirectWithMessage("Category id, brand, and name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_categories")
    .update({
      brand_id: brandId,
      parent_id: parentId,
      name,
      code: optionalTextValue(formData, "code"),
      description: optionalTextValue(formData, "description"),
      is_active: boolValue(formData, "is_active"),
      sort_order: numberValue(formData, "sort_order"),
    })
    .eq("id", id);

  if (error) {
    console.error("CATEGORY UPDATE ERROR", error.message);
    redirectWithMessage("Category could not be updated.");
  }

  revalidatePath("/products/brands");
  redirectWithMessage("Category updated.");
}
