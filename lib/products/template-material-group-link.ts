import type { ProductTemplateMaterialGroupItemLink, ProductTemplateMaterialGroupLink } from "@/components/quotations/finish-selections-editor";
import { materialDisplayCategoryLabel } from "@/lib/products/material-classification";
import type { createClient } from "@/lib/supabase/server";

export type TemplateMaterialGroupLinkInput = {
  productTemplateId: string;
  materialGroupId: string;
  selectionMode: "full_group" | "selected_categories" | "selected_items";
  selectedMaterialIds: string[];
  selectedMaterialCategories: string[];
  labelOverride: string | null;
  isRequired: boolean;
  showInSpecification: boolean;
  showInQuotation: boolean;
  sortOrder: number;
};

export type TemplateMaterialGroupLinkResult =
  | { ok: true; link: ProductTemplateMaterialGroupLink; items: ProductTemplateMaterialGroupItemLink[] }
  | { ok: false; message: string };

const failed = (message: string): TemplateMaterialGroupLinkResult => ({ ok: false, message });

// The one way a material group is linked to a product (Product Setup and the quotation popup).
// Takes the user-session client, so RLS decides who may write.
export async function saveTemplateMaterialGroupLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: TemplateMaterialGroupLinkInput,
): Promise<TemplateMaterialGroupLinkResult> {
  const { productTemplateId, materialGroupId, selectionMode, selectedMaterialIds, selectedMaterialCategories } = input;
  const payload = {
    product_template_id: productTemplateId,
    material_group_id: materialGroupId,
    selection_mode: selectionMode,
    label_override: input.labelOverride,
    is_required: input.isRequired,
    allow_multiple: true,
    show_in_specification: input.showInSpecification,
    show_in_quotation: input.showInQuotation,
    sort_order: input.sortOrder,
    is_active: true,
  };

  if (!productTemplateId || !materialGroupId) return failed("Select a product template and material group.");
  if (selectionMode === "selected_items" && selectedMaterialIds.length === 0) {
    return failed("Select at least one finish for selected finishes only.");
  }
  if (selectionMode === "selected_categories" && selectedMaterialCategories.length === 0) {
    return failed("Select at least one category for Select by category.");
  }

  const { data: existingLink, error: existingLinkError } = await supabase
    .from("product_template_material_groups")
    .select("id,is_active")
    .eq("product_template_id", productTemplateId)
    .eq("material_group_id", materialGroupId)
    .maybeSingle();

  if (existingLinkError) {
    console.error("TEMPLATE MATERIAL GROUP EXISTING LOOKUP ERROR", existingLinkError.message);
    return failed("Material group link could not be checked.");
  }

  if (existingLink?.id && existingLink.is_active) {
    return failed("This material group is already linked. Edit the existing linked group card instead of adding it again.");
  }

  // Checked before any write, so a bad selection leaves no half-made link.
  let selectedIds: string[] = [];
  if (selectionMode !== "full_group") {
    const { data: groupMaterials, error: materialsError } = await supabase
      .from("brand_materials")
      .select("id,material_category,material_collection")
      .eq("material_group_id", materialGroupId)
      .eq("is_active", true);

    if (materialsError) {
      console.error("TEMPLATE MATERIAL GROUP ITEMS VALIDATE ERROR", materialsError.message);
      return failed("Selected finishes could not be validated.");
    }

    selectedIds = (groupMaterials ?? [])
      .filter((material) => selectionMode === "selected_categories"
        ? selectedMaterialCategories.includes(materialDisplayCategoryLabel(material))
        : selectedMaterialIds.includes(material.id))
      .map((material) => material.id);

    if (!selectedIds.length) {
      return failed(selectionMode === "selected_categories"
        ? "Select at least one active finish category from the chosen group."
        : "Select at least one active finish from the chosen group.");
    }
  }

  const { data: link, error } = existingLink?.id
    ? await supabase.from("product_template_material_groups").update(payload).eq("id", existingLink.id).select("id").single()
    : await supabase.from("product_template_material_groups").insert(payload).select("id").single();

  if (error || !link?.id) {
    console.error("TEMPLATE MATERIAL GROUP CREATE ERROR", error?.message ?? "No row returned.");
    return failed("Material group could not be linked.");
  }

  // Managers have no delete policy on the link table, so a half-saved link is switched off instead.
  const undo = async (message: string) => {
    const { error: undoError } = await supabase.from("product_template_material_groups").update({ is_active: false }).eq("id", link.id);
    if (undoError) console.error("TEMPLATE MATERIAL GROUP UNDO ERROR", undoError.message);
    return failed(message);
  };

  const { error: deleteError } = await supabase
    .from("product_template_material_group_items")
    .delete()
    .eq("product_template_material_group_id", link.id);

  if (deleteError) {
    console.error("TEMPLATE MATERIAL GROUP ITEMS CLEAR ERROR", deleteError.message);
    return undo("Material group finishes could not be saved.");
  }

  const rows = selectedIds.map((brandMaterialId, index) => ({
    product_template_material_group_id: link.id as string,
    brand_material_id: brandMaterialId,
    sort_order: index,
    is_active: true,
  }));

  if (rows.length) {
    const { error: itemsError } = await supabase.from("product_template_material_group_items").insert(rows);

    if (itemsError) {
      console.error("TEMPLATE MATERIAL GROUP ITEMS CREATE ERROR", itemsError.message);
      return undo("Selected finishes could not be saved.");
    }
  }

  return {
    ok: true,
    link: { id: link.id as string, ...payload },
    items: rows.map((row) => ({ id: `${link.id}:${row.brand_material_id}`, ...row })),
  };
}
