type GroupableItem = {
  brand_name_snapshot: string | null;
  supplier_name_snapshot: string | null;
};

export type DocumentGroupType = "Supplier" | "Brand" | "Unassigned Supplier";

export type DocumentGroupInfo = {
  key: string;
  label: string;
  type: DocumentGroupType;
};

export type EffectiveDocumentGroup<TItem extends GroupableItem> = {
  dedupeKey: string;
  displayLabel: string;
  displayType: DocumentGroupType;
  keys: string[];
  items: TItem[];
};

export function normalizeDocumentGroupName(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9]/g, "")
    .trim()
    .toLowerCase();
}

export function documentItemGroupInfo(item: GroupableItem): DocumentGroupInfo {
  const supplier = item.supplier_name_snapshot?.trim();
  if (supplier) {
    return { key: `supplier:${supplier}`, label: supplier, type: "Supplier" };
  }

  const brand = item.brand_name_snapshot?.trim();
  if (brand) {
    return { key: `brand:${brand}`, label: brand, type: "Brand" };
  }

  return { key: "unassigned", label: "Unassigned Supplier", type: "Unassigned Supplier" };
}

export function buildEffectiveDocumentGroups<TItem extends GroupableItem>(items: TItem[]) {
  const rawGroups = Array.from(
    items.reduce((map, item) => {
      const group = documentItemGroupInfo(item);
      const existing = map.get(group.key);

      if (existing) {
        existing.items.push(item);
        return map;
      }

      map.set(group.key, { ...group, items: [item] });
      return map;
    }, new Map<string, { key: string; label: string; type: DocumentGroupType; items: TItem[] }>()),
  ).map(([, group]) => group);

  const effectiveMap = new Map<string, EffectiveDocumentGroup<TItem>>();

  for (const group of rawGroups) {
    const normalizedLabel = normalizeDocumentGroupName(group.label) || group.key;
    const dedupeKey = normalizedLabel === "unassignedsupplier"
      ? "unassigned"
      : normalizedLabel;
    const existing = effectiveMap.get(dedupeKey);

    if (existing) {
      existing.keys.push(group.key);
      existing.items.push(...group.items);
      if (existing.displayType !== "Supplier" && group.type === "Supplier") {
        existing.displayType = "Supplier";
        existing.displayLabel = group.label;
      }
      continue;
    }

    effectiveMap.set(dedupeKey, {
      dedupeKey,
      displayLabel: group.label,
      displayType: group.type,
      keys: [group.key],
      items: [...group.items],
    });
  }

  return Array.from(effectiveMap.values());
}

export function findEffectiveDocumentGroup<TItem extends GroupableItem>(
  items: TItem[],
  selectedKey: string,
) {
  const groups = buildEffectiveDocumentGroups(items);
  const group = groups.find((entry) => entry.dedupeKey === selectedKey) ?? null;
  return { group, groups };
}
