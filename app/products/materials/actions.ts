"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProductLibraryManager } from "@/lib/auth";
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

function returnTo(formData: FormData) {
  const value = textValue(formData, "return_to");
  return value.startsWith("/products/materials") ? value : "/products/materials";
}

function redirectWithMessage(path: string, message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}message=${encodeURIComponent(message)}`);
}

function materialCategoryValue(formData: FormData) {
  return optionalTextValue(formData, "material_price_category") ?? optionalTextValue(formData, "material_category");
}

function materialCollectionValue(formData: FormData) {
  return optionalTextValue(formData, "material_collection");
}

function parseBatchRows(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code = "", ...nameParts] = line.split(/\s*[|,\t]\s*/);
      return {
        code: code.trim(),
        name: nameParts.join(" ").trim(),
      };
    })
    .filter((row) => row.code || row.name);
}

export async function createMaterialGroup(formData: FormData) {
  await requireProductLibraryManager();
  const brandId = textValue(formData, "brand_id");
  const groupName = textValue(formData, "group_name");
  const redirectPath = returnTo(formData);

  if (!brandId || !groupName) {
    redirectWithMessage(redirectPath, "Brand and group name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("brand_material_groups").insert({
    brand_id: brandId,
    group_name: groupName,
    description: optionalTextValue(formData, "description"),
    sort_order: numberValue(formData, "sort_order"),
    is_active: boolValue(formData, "is_active"),
  });

  if (error) {
    console.error("MATERIAL GROUP CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Material group could not be created.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, "Material group created.");
}

export async function updateMaterialGroup(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const brandId = textValue(formData, "brand_id");
  const groupName = textValue(formData, "group_name");
  const redirectPath = returnTo(formData);

  if (!id || !brandId || !groupName) {
    redirectWithMessage(redirectPath, "Group id, brand, and name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_material_groups")
    .update({
      brand_id: brandId,
      group_name: groupName,
      description: optionalTextValue(formData, "description"),
      sort_order: numberValue(formData, "sort_order"),
      is_active: boolValue(formData, "is_active"),
    })
    .eq("id", id);

  if (error) {
    console.error("MATERIAL GROUP UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Material group could not be updated.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, "Material group updated.");
}

export async function deactivateMaterialGroup(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const redirectPath = returnTo(formData);

  if (!id) redirectWithMessage(redirectPath, "Group id is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_material_groups")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("MATERIAL GROUP DEACTIVATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Material group could not be deactivated.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, "Material group deactivated.");
}

export async function createMaterial(formData: FormData) {
  await requireProductLibraryManager();
  const brandId = textValue(formData, "brand_id");
  const groupId = textValue(formData, "material_group_id");
  const materialName = textValue(formData, "material_name");
  const redirectPath = returnTo(formData);

  if (!brandId || !groupId || !materialName) {
    redirectWithMessage(redirectPath, "Brand, group, and material name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("brand_materials").insert({
    brand_id: brandId,
    material_group_id: groupId,
    material_category: materialCategoryValue(formData),
    material_collection: materialCollectionValue(formData),
    material_code: optionalTextValue(formData, "material_code"),
    material_name: materialName,
    color_family: optionalTextValue(formData, "color_family"),
    description: optionalTextValue(formData, "description"),
    image_url: optionalTextValue(formData, "image_url"),
    image_alt: optionalTextValue(formData, "image_alt"),
    sort_order: numberValue(formData, "sort_order"),
    is_active: boolValue(formData, "is_active"),
  });

  if (error) {
    console.error("MATERIAL CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Material could not be created.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, "Material created.");
}

export async function createMaterialsBatch(formData: FormData) {
  await requireProductLibraryManager();
  const brandId = textValue(formData, "brand_id");
  const groupId = textValue(formData, "material_group_id");
  const redirectPath = returnTo(formData);
  const rows = parseBatchRows(textValue(formData, "batch_material_rows"));

  if (!brandId || !groupId || rows.length === 0) {
    redirectWithMessage(redirectPath, "Brand, group, and at least one batch row are required.");
  }

  const invalidRows = rows.filter((row) => !row.code || !row.name);
  if (invalidRows.length) {
    redirectWithMessage(redirectPath, "Each batch row must include code and name, for example 503 | White.");
  }

  const normalizedCodes = rows.map((row) => row.code.toLowerCase());
  const duplicateRowCode = normalizedCodes.find((code, index) => normalizedCodes.indexOf(code) !== index);
  if (duplicateRowCode) {
    redirectWithMessage(redirectPath, `Duplicate batch code found: ${duplicateRowCode}.`);
  }

  const supabase = await createClient();
  const codes = rows.map((row) => row.code);
  const { data: existing, error: duplicateError } = await supabase
    .from("brand_materials")
    .select("material_code")
    .eq("brand_id", brandId)
    .eq("material_group_id", groupId)
    .in("material_code", codes);

  if (duplicateError) {
    console.error("MATERIAL BATCH DUPLICATE CHECK ERROR", duplicateError.message);
    redirectWithMessage(redirectPath, "Batch duplicates could not be checked.");
  }

  const duplicateCodes = Array.from(new Set((existing ?? []).map((row) => row.material_code).filter(Boolean)));
  if (duplicateCodes.length) {
    redirectWithMessage(redirectPath, `Duplicate material code already exists: ${duplicateCodes.join(", ")}.`);
  }

  const { error } = await supabase.from("brand_materials").insert(
    rows.map((row, index) => ({
      brand_id: brandId,
      material_group_id: groupId,
      material_category: materialCategoryValue(formData),
      material_collection: materialCollectionValue(formData),
      material_code: row.code,
      material_name: row.name,
      sort_order: index,
      is_active: boolValue(formData, "is_active"),
    })),
  );

  if (error) {
    console.error("MATERIAL BATCH CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Batch materials could not be created.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, `${rows.length} materials created.`);
}

export async function updateMaterial(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const brandId = textValue(formData, "brand_id");
  const groupId = textValue(formData, "material_group_id");
  const materialName = textValue(formData, "material_name");
  const redirectPath = returnTo(formData);

  if (!id || !brandId || !groupId || !materialName) {
    redirectWithMessage(redirectPath, "Material id, brand, group, and name are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_materials")
    .update({
      brand_id: brandId,
      material_group_id: groupId,
      material_category: materialCategoryValue(formData),
      material_collection: materialCollectionValue(formData),
      material_code: optionalTextValue(formData, "material_code"),
      material_name: materialName,
      color_family: optionalTextValue(formData, "color_family"),
      description: optionalTextValue(formData, "description"),
      image_url: optionalTextValue(formData, "image_url"),
      image_alt: optionalTextValue(formData, "image_alt"),
      sort_order: numberValue(formData, "sort_order"),
      is_active: boolValue(formData, "is_active"),
    })
    .eq("id", id);

  if (error) {
    console.error("MATERIAL UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Material could not be updated.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, "Material updated.");
}

export async function deactivateMaterial(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");
  const redirectPath = returnTo(formData);

  if (!id) redirectWithMessage(redirectPath, "Material id is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("brand_materials")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("MATERIAL DEACTIVATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Material could not be deactivated.");
  }

  revalidatePath("/products/materials");
  redirectWithMessage(redirectPath, "Material deactivated.");
}
