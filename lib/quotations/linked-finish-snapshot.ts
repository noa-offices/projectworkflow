import type { FinishMaterial, FinishMaterialGroup, ProductTemplateMaterialGroupLink } from "@/components/quotations/finish-selections-editor";
import type { LinkedFinishChoice } from "@/lib/products/saved-setups/recipe";

type Screen = {
  instanceKey: string;
  instance: { label: string };
  link: { label?: string | null };
  childTemplate: { id: string; template_name: string };
  qty: number;
};

type Swatch = [code: string, name: string, image: string | null];
type Group = [label: string, specification: boolean, quotation: boolean, swatches: number[]];
type ScreenEntry = [key: string, label: string, groups: Group[]];

export function blockLinkedFinishServerAdd(local: boolean, reconfiguring: boolean, screens: Pick<Screen, "instanceKey">[], choices: Record<string, LinkedFinishChoice[]>) {
  return !local && !reconfiguring && screens.some((screen) => choices[screen.instanceKey]?.length);
}

// The arrays preserve display order, including after a JSONB round trip.
// A swatch shared by several screens is stored once.
export function buildLinkedFinishSnapshot(
  screens: Screen[], choices: Record<string, LinkedFinishChoice[]>,
  links: ProductTemplateMaterialGroupLink[], groups: FinishMaterialGroup[], materials: Map<string, FinishMaterial>,
) {
  const swatches: Swatch[] = [];
  const entries: ScreenEntry[] = [];
  const swatchIndices = new Map<string, number>();
  for (const [index, screen] of screens.entries()) {
    if (screen.qty <= 0 || !choices[screen.instanceKey]?.length) continue;
    const selectedGroups: Group[] = [];
    for (const link of links.filter((link) => link.product_template_id === screen.childTemplate.id).sort((a, b) => a.sort_order - b.sort_order)) {
      const selected: number[] = [];
      for (const [linkId, materialId] of choices[screen.instanceKey]) {
        if (linkId !== link.id) continue;
        const material = materials.get(materialId);
        if (!material || material.material_group_id !== link.material_group_id) continue;
        let swatch = swatchIndices.get(materialId);
        if (swatch === undefined) {
          swatch = swatches.length;
          swatches.push([material.material_code ?? "", material.material_name, material.image_url]);
          swatchIndices.set(materialId, swatch);
        }
        selected.push(swatch);
      }
      if (selected.length) {
        const label = link.label_override?.trim() || groups.find((group) => group.id === link.material_group_id)?.group_name || "Finish";
        selectedGroups.push([label, link.show_in_specification, link.show_in_quotation, selected]);
      }
    }
    if (selectedGroups.length) {
      const position = screen.instance.label.trim() || screen.link.label?.trim() || `Screen ${index + 1}`;
      const name = screen.childTemplate.template_name;
      entries.push([screen.instanceKey, position === name ? name : `${name} - ${position}`, selectedGroups]);
    }
  }
  return entries.length ? [swatches, entries] as const : undefined;
}

export function documentFinishRows(parent: unknown, snapshot: unknown, parseParent: (value: unknown) => Record<string, unknown>[]) {
  if (!Array.isArray(snapshot)) return parent;
  const [swatches, screens] = snapshot;
  if (!Array.isArray(swatches) || !Array.isArray(screens)) return parent;
  const rows = [...parseParent(parent)];
  const labels = new Set<string>();
  for (const screen of screens) {
    if (!Array.isArray(screen)) continue;
    const [key, label, groups] = screen;
    if (typeof key !== "string" || typeof label !== "string" || !Array.isArray(groups)) continue;
    let heading = label;
    for (let copy = 2; labels.has(heading); copy++) heading = `${label} (${copy})`;
    labels.add(heading);
    for (const [groupIndex, group] of groups.entries()) {
      if (!Array.isArray(group)) continue;
      const [groupLabel, visible, , indices] = group;
      if (visible !== true || typeof groupLabel !== "string" || !Array.isArray(indices)) continue;
      for (const [index, swatchIndex] of indices.entries()) {
        if (!Number.isInteger(swatchIndex)) continue;
        const swatch = swatches[swatchIndex];
        if (!Array.isArray(swatch) || typeof swatch[1] !== "string") continue;
        rows.push({ id: `linked-finish:${key}:${groupIndex}:${index}`, group_label: `${heading} / ${groupLabel}`,
          finish_code: swatch[0], finish_name: swatch[1], finish_image_url: swatch[2], sort_order: rows.length,
          show_in_specification: true });
      }
    }
  }
  return rows;
}
