import type { ReadRow } from "./types";
import { materialCollectionLabel, materialPriceCategoryLabel, UNCATEGORIZED_MATERIAL_LABEL } from "@/lib/products/material-classification";

type Brand = { id: string; name: string; code?: string | null; origin?: string | null; is_active: boolean };
type Category = { id: string; name?: string; brand_id?: string; parent_id?: string | null; is_active?: boolean };
type Template = { id: string; template_name: string; template_code?: string | null; item_code?: string | null; brand_id: string; main_category_id?: string | null; sub_category_id?: string | null; default_image_url?: string | null; is_active: boolean; lifecycle_status?: string | null };
type Group = { id: string; brand_id: string; group_name: string; sort_order: number; is_active: boolean };
type Material = { id: string; brand_id: string; material_group_id: string; material_name: string; material_code?: string | null; material_category?: string | null; material_collection?: string | null; image_url?: string | null; sort_order: number; is_active: boolean };

function orderedMaterials(materials: Material[]) {
  const sorted = [...materials].sort((a, b) => a.sort_order - b.sort_order ||
    (a.material_code ?? "").localeCompare(b.material_code ?? "") || a.material_name.localeCompare(b.material_name));
  const grades = new Map<string, Map<string, Material[]>>();
  const collectionOnly = new Map<string, Material[]>();
  const uncategorized: Material[] = [];
  for (const m of sorted) {
    const grade = materialPriceCategoryLabel(m), collection = materialCollectionLabel(m);
    if (grade) {
      const buckets = grades.get(grade) ?? new Map<string, Material[]>();
      const bucket = buckets.get(collection) ?? []; bucket.push(m); buckets.set(collection, bucket); grades.set(grade, buckets);
    } else if (collection) {
      const bucket = collectionOnly.get(collection) ?? []; bucket.push(m); collectionOnly.set(collection, bucket);
    } else uncategorized.push(m);
  }
  return [
    ...[...grades].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
      .flatMap(([, buckets]) => [...buckets].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, rows]) => rows)),
    ...[...collectionOnly].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, rows]) => rows),
    ...uncategorized,
  ];
}

export function managementRows(templates: Template[], brands: Brand[], categories: Category[]): ReadRow[] {
  const brandNames = new Map(brands.map(b => [b.id, b.name]));
  const categoryNames = new Map(categories.map(c => [c.id, c.name]));
  return templates.map(t => {
    const lifecycle = ["archived", "discontinued"].includes(t.lifecycle_status ?? "") ? t.lifecycle_status! : t.is_active ? "active" : "archived";
    return { id: t.id, title: t.template_name, code: t.item_code ?? t.template_code ?? "",
      subtitle: t.template_code && t.template_code !== t.item_code ? "Template code: " + t.template_code : "",
      status: lifecycle, archived: lifecycle !== "active", href: "/products/manage?template=" + t.id,
      brand: brandNames.get(t.brand_id) ?? "", category: [categoryNames.get(t.main_category_id ?? ""), categoryNames.get(t.sub_category_id ?? "")].filter(Boolean).join(" / "),
      thumbnail: t.default_image_url ?? "" };
  });
}
export function brandRows(brands: Brand[], categories: Category[]): ReadRow[] {
  const mainIds = new Set(categories.filter(c => c.is_active && !c.parent_id).map(c => c.id));
  const counts = new Map<string, { main: number; sub: number }>();
  for (const c of categories.filter(c => c.is_active)) {
    const count = counts.get(c.brand_id ?? "") ?? { main: 0, sub: 0 };
    if (!c.parent_id) count.main++;
    else if (mainIds.has(c.parent_id)) count.sub++;
    counts.set(c.brand_id ?? "", count);
  }
  return brands.map(b => { const n = counts.get(b.id) ?? { main: 0, sub: 0 }; return {
    id: b.id, title: b.name, code: b.code ?? "", subtitle: "Origin: " + (b.origin ?? "-"),
    category: n.main + " categories · " + n.sub + " subcategories",
    status: b.is_active ? "Active" : "Inactive", archived: !b.is_active, href: "/products/brands?brand=" + b.id,
  }; });
}
// Match the existing Materials group -> numeric grade -> collection -> item ordering.
export function materialRows(brands: Brand[], groups: Group[], materials: Material[]): ReadRow[] {
  const result: ReadRow[] = [];
  const byGroup = new Map<string, Material[]>();
  for (const m of materials) { const list = byGroup.get(m.material_group_id) ?? []; list.push(m); byGroup.set(m.material_group_id, list); }
  for (const brand of brands) {
    const orderedGroups = groups.filter(g => g.brand_id === brand.id).sort((a, b) => a.sort_order - b.sort_order || a.group_name.localeCompare(b.group_name));
    for (const group of orderedGroups) {
      const ordered = orderedMaterials(byGroup.get(group.id) ?? []);
      const base = { brand: brand.name, brandId: brand.id, group: group.group_name, groupId: group.id };
      if (!ordered.length) result.push({ ...base, id: "group:" + group.id, title: group.group_name,
        code: "", subtitle: "No saved materials in this group", status: group.is_active ? "Active" : "Inactive",
        archived: !group.is_active, href: "", groupOnly: true });
      for (const m of ordered) result.push({ ...base, id: m.id, title: m.material_name, code: m.material_code ?? "",
        subtitle: "", category: [materialPriceCategoryLabel(m), materialCollectionLabel(m)].filter(Boolean).join(" / ") || UNCATEGORIZED_MATERIAL_LABEL,
        status: m.is_active ? "Active" : "Inactive", archived: !m.is_active || !group.is_active,
        href: "/products/materials?brand=" + brand.id + "&group=" + group.id, thumbnail: m.image_url ?? "" });
    }
  }
  return result;
}
