"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProductLibraryManager } from "@/lib/auth";
import { defaultCurrency, normalizeCurrency } from "@/lib/currencies";
import { ensureDefaultProductCategoryTree } from "@/lib/product-default-category-tree";
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

function redirectToBrands(message: string, params: Record<string, string> = {}): never {
  const query = new URLSearchParams(params);
  query.set("message", message);
  redirect(`/products/brands?${query.toString()}`);
}

export async function createBrand(formData: FormData) {
  const { user } = await requireProductLibraryManager();
  const name = textValue(formData, "name");

  if (!name) {
    redirectWithMessage("Brand name is required.");
  }

  const supabase = await createClient();
  const { data: brand, error } = await supabase
    .from("brands")
    .insert({
      name,
      code: optionalTextValue(formData, "code"),
      default_currency: normalizeCurrency(textValue(formData, "default_currency") || defaultCurrency),
      origin: optionalTextValue(formData, "origin"),
      description: optionalTextValue(formData, "description"),
      website: optionalTextValue(formData, "website"),
      logo_url: optionalTextValue(formData, "logo_url"),
      is_active: boolValue(formData, "is_active"),
      created_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !brand) {
    console.error("BRAND CREATE ERROR", error?.message);
    redirectWithMessage("Brand could not be created.");
  }

  try {
    await ensureDefaultProductCategoryTree({
      supabase,
      brandIds: [brand.id],
      userId: user.id,
    });
  } catch (seedError) {
    console.error("BRAND DEFAULT CATEGORY SEED ERROR", seedError);
    redirectWithMessage("Brand was created, but default categories could not be seeded.");
  }

  revalidatePath("/products/brands");
  redirectWithMessage("Brand created.");
}

export async function updateBrand(formData: FormData) {
  await requireProductLibraryManager();
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
      default_currency: normalizeCurrency(textValue(formData, "default_currency") || defaultCurrency),
      origin: optionalTextValue(formData, "origin"),
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

export async function archiveBrand(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) redirectWithMessage("Brand id is required.");

  const supabase = await createClient();
  const { error } = await supabase.from("brands").update({ is_active: false }).eq("id", id);

  if (error) {
    console.error("BRAND ARCHIVE ERROR", error.message);
    redirectWithMessage("Brand could not be moved to Archive.");
  }

  revalidatePath("/products/brands");
  redirectWithMessage("Brand moved to Archive.");
}

export async function restoreBrand(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) redirectToBrands("Brand id is required.", { status: "archive" });

  const supabase = await createClient();
  const { error } = await supabase.from("brands").update({ is_active: true }).eq("id", id);

  if (error) {
    console.error("BRAND RESTORE ERROR", error.message);
    redirectToBrands("Brand could not be restored.", { status: "archive" });
  }

  revalidatePath("/products/brands");
  redirectToBrands("Brand restored.", { status: "archive" });
}

export async function permanentlyDeleteBrand(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) redirectToBrands("Brand id is required.", { status: "archive" });

  const supabase = await createClient();
  const { count: categoryCount, error: categoryError } = await supabase
    .from("product_categories")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", id);
  const { count: templateCount, error: templateError } = await supabase
    .from("product_templates")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", id);

  if (categoryError || templateError) {
    console.error("BRAND DEPENDENCY CHECK ERROR", categoryError?.message ?? templateError?.message);
    redirectToBrands("Brand dependencies could not be checked.", { status: "archive" });
  }

  if ((categoryCount ?? 0) > 0 || (templateCount ?? 0) > 0) {
    redirectToBrands("This brand has categories or product templates. Keep it archived.", {
      status: "archive",
    });
  }

  const { error } = await supabase.from("brands").delete().eq("id", id);

  if (error) {
    console.error("BRAND PERMANENT DELETE ERROR", error.message);
    redirectToBrands("Brand could not be permanently deleted.", { status: "archive" });
  }

  revalidatePath("/products/brands");
  redirectToBrands("Brand permanently deleted.", { status: "archive" });
}

export async function createCategory(formData: FormData) {
  const { user } = await requireProductLibraryManager();
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
  await requireProductLibraryManager();
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

export async function archiveCategory(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) redirectWithMessage("Category id is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_categories")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("CATEGORY ARCHIVE ERROR", error.message);
    redirectWithMessage("Category could not be moved to Archive.");
  }

  revalidatePath("/products/brands");
  redirectWithMessage("Category moved to Archive.");
}

export async function restoreCategory(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) redirectToBrands("Category id is required.", { status: "archive" });

  const supabase = await createClient();
  const { data: category, error: readError } = await supabase
    .from("product_categories")
    .select("brand_id,parent_id")
    .eq("id", id)
    .single<{ brand_id: string; parent_id: string | null }>();

  if (readError || !category) {
    console.error("CATEGORY RESTORE READ ERROR", readError?.message);
    redirectToBrands("Category could not be loaded.", { status: "archive" });
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("is_active")
    .eq("id", category.brand_id)
    .single<{ is_active: boolean }>();

  if (!brand?.is_active) {
    redirectToBrands("Restore the parent brand/category first.", { status: "archive" });
  }

  if (category.parent_id) {
    const { data: parent } = await supabase
      .from("product_categories")
      .select("is_active")
      .eq("id", category.parent_id)
      .single<{ is_active: boolean }>();

    if (!parent?.is_active) {
      redirectToBrands("Restore the parent brand/category first.", { status: "archive" });
    }
  }

  const { error } = await supabase
    .from("product_categories")
    .update({ is_active: true })
    .eq("id", id);

  if (error) {
    console.error("CATEGORY RESTORE ERROR", error.message);
    redirectToBrands("Category could not be restored.", { status: "archive" });
  }

  revalidatePath("/products/brands");
  redirectToBrands("Category restored.", { status: "archive" });
}

export async function permanentlyDeleteCategory(formData: FormData) {
  await requireProductLibraryManager();
  const id = textValue(formData, "id");

  if (!id) redirectToBrands("Category id is required.", { status: "archive" });

  const supabase = await createClient();
  const { count: childCount, error: childError } = await supabase
    .from("product_categories")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", id);
  const { count: templateCount, error: templateError } = await supabase
    .from("product_templates")
    .select("id", { count: "exact", head: true })
    .or(`main_category_id.eq.${id},sub_category_id.eq.${id}`);

  if (childError || templateError) {
    console.error("CATEGORY DEPENDENCY CHECK ERROR", childError?.message ?? templateError?.message);
    redirectToBrands("Category dependencies could not be checked.", { status: "archive" });
  }

  if ((childCount ?? 0) > 0 || (templateCount ?? 0) > 0) {
    redirectToBrands("This category has subcategories or product templates. Keep it archived.", {
      status: "archive",
    });
  }

  const { error } = await supabase.from("product_categories").delete().eq("id", id);

  if (error) {
    console.error("CATEGORY PERMANENT DELETE ERROR", error.message);
    redirectToBrands("Category could not be permanently deleted.", { status: "archive" });
  }

  revalidatePath("/products/brands");
  redirectToBrands("Category permanently deleted.", { status: "archive" });
}
