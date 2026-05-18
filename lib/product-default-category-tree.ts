import type { SupabaseClient } from "@supabase/supabase-js";

type DefaultCategoryNode = {
  name: string;
  children?: string[];
};

const defaultCategoryTree: DefaultCategoryNode[] = [
  {
    name: "Desk",
    children: [
      "Executive Desk",
      "Managerial Desk",
      "Workstation",
      "Meeting Table",
      "Conference Table",
      "Reception Desk",
    ],
  },
  {
    name: "Chair",
    children: [
      "Task Chair",
      "Executive Chair",
      "Managerial Chair",
      "Visitor Chair",
      "Meeting Chair",
    ],
  },
  {
    name: "Sofa",
    children: [
      "Executive Sofa",
      "Managerial Sofa",
      "Lounge Sofa",
      "Reception Sofa",
    ],
  },
  {
    name: "Lounge Chair",
    children: ["Lounge Chair"],
  },
  {
    name: "Other Chairs",
    children: ["Pantry Chair", "Training Chair", "Bar Stool"],
  },
  {
    name: "Coffee Table",
    children: ["Coffee Table"],
  },
  {
    name: "Nesting Table",
  },
  {
    name: "Storage",
    children: [
      "Cabinet",
      "Filing Cabinet",
      "Mobile Pedestal",
      "Credenza",
      "Locker",
      "Bookshelf",
    ],
  },
  {
    name: "Screens & Add-ons",
    children: [
      "Screen",
      "Cable Tray",
      "Power Module",
      "Monitor Arm",
      "Keyboard Tray",
      "Modesty Panel",
      "Others",
    ],
  },
  {
    name: "Accessories",
    children: [
      "Headrest",
      "Armrest",
      "Castors",
      "Glides",
      "Stirrups",
      "Connector",
      "Bracket",
      "Desk Pad",
      "Others",
    ],
  },
];

type CategoryRow = {
  id: string;
  brand_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number | null;
};

function normalizeCategoryName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function ensureDefaultProductCategoryTree({
  supabase,
  brandIds,
  userId,
}: {
  supabase: SupabaseClient;
  brandIds?: string[];
  userId?: string | null;
}) {
  const targetBrandIds = Array.from(new Set((brandIds ?? []).filter(Boolean)));
  let resolvedBrandIds = targetBrandIds;

  if (!resolvedBrandIds.length) {
    const { data: brands, error: brandsError } = await supabase
      .from("brands")
      .select("id")
      .returns<Array<{ id: string }>>();

    if (brandsError) {
      throw new Error(brandsError.message || "Brands could not be loaded.");
    }

    resolvedBrandIds = (brands ?? []).map((brand) => brand.id);
  }

  if (!resolvedBrandIds.length) {
    return;
  }

  const { data: existingCategories, error: categoriesError } = await supabase
    .from("product_categories")
    .select("id,brand_id,parent_id,name,sort_order")
    .in("brand_id", resolvedBrandIds)
    .returns<CategoryRow[]>();

  if (categoriesError) {
    throw new Error(categoriesError.message || "Product categories could not be loaded.");
  }

  const categoriesByBrand = new Map<string, CategoryRow[]>();
  for (const category of existingCategories ?? []) {
    categoriesByBrand.set(category.brand_id, [
      ...(categoriesByBrand.get(category.brand_id) ?? []),
      category,
    ]);
  }

  for (const brandId of resolvedBrandIds) {
    const brandCategories = categoriesByBrand.get(brandId) ?? [];
    const mainCategoryByName = new Map(
      brandCategories
        .filter((category) => !category.parent_id)
        .map((category) => [normalizeCategoryName(category.name), category] as const),
    );

    for (const [index, node] of defaultCategoryTree.entries()) {
      const normalizedName = normalizeCategoryName(node.name);
      let mainCategory = mainCategoryByName.get(normalizedName) ?? null;

      if (!mainCategory) {
        const { data: insertedMainCategory, error: insertMainCategoryError } = await supabase
          .from("product_categories")
          .insert({
            brand_id: brandId,
            parent_id: null,
            name: node.name,
            code: null,
            description: null,
            is_active: true,
            sort_order: index,
            ...(userId ? { created_by: userId } : {}),
          })
          .select("id,brand_id,parent_id,name,sort_order")
          .single<CategoryRow>();

        if (insertMainCategoryError || !insertedMainCategory) {
          throw new Error(insertMainCategoryError?.message || `Category ${node.name} could not be created.`);
        }

        mainCategory = insertedMainCategory;
        mainCategoryByName.set(normalizedName, mainCategory);
        brandCategories.push(mainCategory);
      }

      if (!node.children?.length) {
        continue;
      }

      const subcategoryByName = new Map(
        brandCategories
          .filter((category) => category.parent_id === mainCategory.id)
          .map((category) => [normalizeCategoryName(category.name), category] as const),
      );

      for (const [childIndex, childName] of node.children.entries()) {
        const normalizedChildName = normalizeCategoryName(childName);
        if (subcategoryByName.has(normalizedChildName)) {
          continue;
        }

        const { data: insertedSubcategory, error: insertSubcategoryError } = await supabase
          .from("product_categories")
          .insert({
            brand_id: brandId,
            parent_id: mainCategory.id,
            name: childName,
            code: null,
            description: null,
            is_active: true,
            sort_order: childIndex,
            ...(userId ? { created_by: userId } : {}),
          })
          .select("id,brand_id,parent_id,name,sort_order")
          .single<CategoryRow>();

        if (insertSubcategoryError || !insertedSubcategory) {
          throw new Error(insertSubcategoryError?.message || `Subcategory ${childName} could not be created.`);
        }

        subcategoryByName.set(normalizedChildName, insertedSubcategory);
        brandCategories.push(insertedSubcategory);
      }
    }
  }
}

export { defaultCategoryTree };
