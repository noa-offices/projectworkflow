// Pure grouping for the collapsible material sections in the finish selector. Display only: it never changes what is selected.
export type GroupableMaterial = {
  id: string;
  material_group_id: string;
  material_category?: string | null;
  material_collection?: string | null;
  material_code?: string | null;
  material_name: string;
  sort_order: number;
};
export type MaterialSection<T extends GroupableMaterial> = {
  key: string;
  label: string;
  category: string;
  collection: string;
  materials: T[];
  total: number;
  selected: number;
};
export type MaterialGroupNode<T extends GroupableMaterial> = { groupId: string; total: number; selected: number; sections: MaterialSection<T>[] };

export const OTHER_MATERIAL_SECTION_LABEL = "Other";
const clean = (value?: string | null) => value?.trim() ?? "";
const bySortOrder = (left: GroupableMaterial, right: GroupableMaterial) =>
  left.sort_order - right.sort_order || (left.material_code ?? "").localeCompare(right.material_code ?? "") || left.material_name.localeCompare(right.material_name);

/**
 * Sections of one material group: one per category and collection, headed "category · collection" (just the category when no
 * material has a collection). Materials with neither go to "Other", which always sorts last. Counts include the selected ones.
 */
export function groupMaterialsIntoSections<T extends GroupableMaterial>(materials: readonly T[], selectedIds: ReadonlySet<string>): MaterialSection<T>[] {
  const sections = new Map<string, MaterialSection<T>>();
  for (const material of [...materials].sort(bySortOrder)) {
    const category = clean(material.material_category), collection = clean(material.material_collection);
    const key = `${category}\u0000${collection}`;
    const section = sections.get(key) ?? { key, label: `${category || OTHER_MATERIAL_SECTION_LABEL}${collection ? ` · ${collection}` : ""}`, category, collection, materials: [], total: 0, selected: 0 };
    section.materials.push(material); section.total += 1; section.selected += selectedIds.has(material.id) ? 1 : 0;
    sections.set(key, section);
  }
  return [...sections.values()].sort((left, right) =>
    Number(!left.category) - Number(!right.category) || left.category.localeCompare(right.category) ||
    Number(!left.collection) - Number(!right.collection) || left.collection.localeCompare(right.collection));
}

/** Material group -> sections, in the order the groups first appear. */
export function groupMaterialsByGroup<T extends GroupableMaterial>(materials: readonly T[], selectedIds: ReadonlySet<string>): MaterialGroupNode<T>[] {
  const byGroup = new Map<string, T[]>();
  for (const material of materials) byGroup.set(material.material_group_id, [...(byGroup.get(material.material_group_id) ?? []), material]);
  return [...byGroup.entries()].map(([groupId, items]) => {
    const sections = groupMaterialsIntoSections(items, selectedIds);
    return { groupId, total: items.length, selected: sections.reduce((sum, section) => sum + section.selected, 0), sections };
  });
}
