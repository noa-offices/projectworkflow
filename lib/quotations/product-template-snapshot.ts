export type ProductSpecificationTemplateInput = {
  default_specification?: string | null;
  description?: string | null;
};

export type ProductSpecificationOptionInput = {
  group?: string | null;
  item_type?: string | null;
  label?: string | null;
  specification?: string | null;
};

export type ProductSpecificationAccessoryInput = {
  item_name?: string | null;
  importantRequirements?: string[] | null;
  qty?: number | null;
  supplier_price_list_code?: string | null;
  specification?: string | null;
};

export type ProductSpecificationLinkedProductInput = {
  append_to_specification: boolean;
  label?: string | null;
  selected_category?: string | null;
  specification?: string | null;
  template_name?: string | null;
};

export type ProductSpecificationWorkstationVariantInput = {
  specification?: string | null;
  variant_name?: string | null;
};

export type ModularCompositionSpecificationItem = {
  dimension?: string | null;
  itemName?: string | null;
  label?: string | null;
  quantity?: number | null;
  importantRequirements?: string[] | null;
  specification?: string | null;
};

function compactText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function sentenceWithPeriod(value: string) {
  const trimmed = value.trim().replace(/[.,;:\s]+$/g, "");
  return trimmed ? `${trimmed}.` : "";
}

function readableModularLabel(value: string) {
  const normalized = compactText(value)
    .replace(/\s+[-–]\s+(?=\d+\s*[x×]\s*\d+)/gi, " ")
    .replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1×")
    .replace(/(\d)(cm|mm)\b/gi, "$1 $2");
  if (normalized === normalized.toUpperCase()) return normalized.toLowerCase();
  return normalized.replace(/\b[A-Z][a-z]+\b/g, (word) => word.toLowerCase());
}

function pluralizeModularLabel(value: string) {
  const words = value.split(" ");
  const dimensionIndex = words.findIndex((word) => /^\d/.test(word));
  const lastWordIndex = (dimensionIndex < 0 ? words.length : dimensionIndex) - 1;
  if (lastWordIndex < 0) return value;
  const phrase = words.slice(0, lastWordIndex + 1).join(" ");
  if (/\bchaise longue$/i.test(phrase)) {
    words.splice(lastWordIndex - 1, 2, "chaises", "longues");
    return words.join(" ");
  }
  const word = words[lastWordIndex];
  if (/s$/i.test(word)) return value;
  if (/[^aeiou]y$/i.test(word)) words[lastWordIndex] = `${word.slice(0, -1)}ies`;
  else if (/(?:s|x|z|ch|sh)$/i.test(word)) words[lastWordIndex] = `${word}es`;
  else words[lastWordIndex] = `${word}s`;
  return words.join(" ");
}

function appendUpholsteryCategory(specification: string | null, selectedCategory?: string | null) {
  if (!specification) return null;
  const category = compactText(selectedCategory);
  if (!category || specification.toLowerCase().includes(category.toLowerCase())) return specification;
  return `${sentenceWithPeriod(specification)} Upholstery: ${sentenceWithPeriod(category)}`;
}

function naturalModularJoin(parts: string[]) {
  if (parts.length < 3) return naturalJoin(parts);
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function normalizedClauseKey(value: string) {
  return compactText(value).replace(/[.,;:\s]+$/g, "").replace(/[-_]+/g, " ").toLowerCase();
}

function isCommercialAvailabilityNote(value: string | null | undefined) {
  const text = compactText(value);
  if (!text) return false;
  return /\b(?:item\s+)?available\s+while\s+(?:supplies|stocks?)\s+last(?:s)?\b/i.test(text) ||
    /\bwhile\s+stocks?\s+lasts?\b/i.test(text) ||
    /\bsubject\s+to\s+availability\b/i.test(text) ||
    /\buntil\s+stock(?:s)?\s+(?:last|lasts|run(?:s)?\s+out)\b/i.test(text) ||
    /\bstock\s+clearance\b/i.test(text);
}

function stripCommercialAvailabilityNotes(value: string | null | undefined) {
  const text = compactText(value);
  if (!text) return "";
  if (!isCommercialAvailabilityNote(text)) return text;
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !isCommercialAvailabilityNote(sentence))
    .join(" ")
    .trim();
}

function appendBrandOriginLine(text: string | null, brand?: string | null, origin?: string | null) {
  const brandText = compactText(brand);
  const originText = compactText(origin);
  const line = brandText && originText ? `${brandText} – ${originText}` : brandText || null;
  if (!line) return text;
  const stem = text ? sentenceWithPeriod(text) : "";
  return stem ? `${stem}\n${line}` : line;
}

function directAccessoryPhrase(accessory: ProductSpecificationAccessoryInput) {
  const quantity = Math.trunc(Number(accessory.qty));
  const itemName = compactText(accessory.item_name);
  if (!Number.isFinite(quantity) || quantity < 1 || !itemName) return "";
  const specification = compactText(accessory.specification).replace(/[.,;:\s]+$/g, "");
  const nameWithoutParenthetical = itemName.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const normalizedName = normalizedClauseKey(nameWithoutParenthetical);
  const normalizedSpecification = normalizedClauseKey(specification);
  const detail = normalizedSpecification.startsWith(`${normalizedName} with `)
    ? specification.slice(nameWithoutParenthetical.length).trim()
    : specification && !normalizedName.includes(normalizedSpecification)
      ? `with ${specification.charAt(0).toLowerCase()}${specification.slice(1)}`
      : "";
  return `Complete with ${quantity} ${nameWithoutParenthetical} ${quantity === 1 ? "unit" : "units"}${detail ? ` ${detail}` : ""}`;
}

function isRequirementRepresentedByAccessory(requirement: string, accessories: ProductSpecificationAccessoryInput[]) {
  const normalizedRequirement = normalizedClauseKey(requirement);
  return accessories.some((accessory) => {
    const quantity = Math.trunc(Number(accessory.qty));
    if (!Number.isFinite(quantity) || quantity < 1) return false;
    return [accessory.item_name, accessory.supplier_price_list_code]
      .map((value) => normalizedClauseKey(value ?? ""))
      .filter(Boolean)
      .some((identifier) => normalizedRequirement.includes(identifier));
  });
}

function formattedDirectDimension(value: string) {
  return compactText(value).replace(/\s*[x×]\s*/gi, " × ");
}

function directModuleLabel(value: string) {
  return compactText(value)
    .replace(/\s+Bench\s*-\s*/i, " ")
    .replace(/([A-Za-z])\s*(\d+\b)/g, "$1$2");
}

export function buildDirectModularDimensionSuggestion(items: ModularCompositionSpecificationItem[]) {
  const selectedItems = items.flatMap((item) => {
    const quantity = Math.trunc(Number(item.quantity));
    const label = compactText(item.itemName) || compactText(item.label);
    const dimension = formattedDirectDimension(item.dimension ?? "");
    return Number.isFinite(quantity) && quantity > 0 && label ? [{ label, quantity, dimension }] : [];
  }).filter((item) => item.dimension);
  if (!selectedItems.length) return null;
  const totalModules = selectedItems.reduce((total, item) => total + item.quantity, 0);
  if (selectedItems.length === 1 && totalModules === 1) return selectedItems[0].dimension;

  // Only collapse into a generic "N modules" phrase when every selected line is genuinely the same
  // module (same label repeated by quantity) — distinct roles such as Starter vs. Add-on must stay
  // visibly composed even when their dimensions happen to match, never merged into one anonymous count.
  const distinctLabels = new Set(selectedItems.map((item) => normalizedClauseKey(item.label)));
  const dimensions = Array.from(new Set(selectedItems.map((item) => normalizedClauseKey(item.dimension))));
  if (distinctLabels.size === 1 && dimensions.length === 1) return `${totalModules} modules · each ${selectedItems[0].dimension}`;

  const dimensionParts = selectedItems.map((item) => {
    const match = item.dimension.match(/^(?:W\s*)?([\d.,]+)\s*×\s*(D\s*[\d.,]+)\s*×\s*(H\s*[\d.,]+(?:\s*cm|\s*mm)?)/i);
    return match ? { ...item, width: match[1], depth: match[2], height: match[3] } : null;
  });
  if (dimensionParts.every(Boolean)) {
    const parts = dimensionParts as Array<{ label: string; quantity: number; dimension: string; width: string; depth: string; height: string }>;
    if (new Set(parts.map((item) => normalizedClauseKey(`${item.depth} ${item.height}`))).size === 1) {
      return `${parts.map((item) => `${directModuleLabel(item.label)} × ${item.quantity}`).join(" + ")} · ${parts[0].depth} × ${parts[0].height}`;
    }
  }
  return selectedItems.map((item) => `${directModuleLabel(item.label)}: ${item.dimension} × ${item.quantity}`).join(" · ");
}

export function buildModularCompositionSpecification({
  items,
  accessories = [],
  brand,
  modularDefaultSpecification,
  modularPricingMode,
  origin,
  selectedCategory,
  templateDefaultSpecification,
  templateDescription,
}: {
  items: ModularCompositionSpecificationItem[];
  accessories?: ProductSpecificationAccessoryInput[];
  brand?: string | null;
  modularDefaultSpecification?: string | null;
  modularPricingMode?: "direct" | "matrix" | null;
  origin?: string | null;
  selectedCategory?: string | null;
  templateDefaultSpecification?: string | null;
  templateDescription?: string | null;
}) {
  const withBrandOrigin = (text: string | null) => appendBrandOriginLine(text, brand, origin);
  const selectedItems = items.flatMap((item) => {
    const quantity = Math.trunc(Number(item.quantity));
    const label = compactText(item.itemName) || compactText(item.label);
    return Number.isFinite(quantity) && quantity > 0 && label ? [{ ...item, label, quantity }] : [];
  });
  const baseSpecification = firstNonEmptySnapshotText(
    modularDefaultSpecification,
    templateDefaultSpecification,
    templateDescription,
  );

  if (!selectedItems.length) return withBrandOrigin(baseSpecification ? sentenceWithPeriod(baseSpecification) : null);
  const directModular = modularPricingMode === "direct";
  if (!directModular && selectedItems.length === 1 && selectedItems[0].quantity === 1) {
    const rowSpecification = stripCommercialAvailabilityNotes(selectedItems[0].specification);
    if (rowSpecification) {
      return withBrandOrigin(appendUpholsteryCategory(sentenceWithPeriod(rowSpecification), selectedCategory));
    }
  }

  const quantities = selectedItems.map((item) => {
    const label = directModular
      ? compactText(item.label).replace(/([A-Za-z])\s*(\d+\b)/g, "$1 $2")
      : readableModularLabel(item.label);
    return `${item.quantity} ${item.quantity === 1 ? label : pluralizeModularLabel(label)}`;
  });
  const normalizedBaseStem = compactText(baseSpecification)
    .replace(/[.,;:\s]+$/g, "")
    .replace(/\bcompris(?:e|es|ing)\b.*$/i, "")
    .replace(/[.,;:\s]+$/g, "");
  const baseStem = directModular && /\bmodular lounge seating\b/i.test(normalizedBaseStem)
    ? "Composition"
    : normalizedBaseStem || (directModular ? "Composition" : "Modular lounge seating");
  const composition = `${baseStem} comprising ${naturalModularJoin(quantities)}.`;
  if (directModular) {
    const rowDetails = uniqueFragments([
      ...selectedItems.map((item) => stripCommercialAvailabilityNotes(item.specification)),
      ...selectedItems.flatMap((item) => (item.importantRequirements ?? []).filter((requirement) => !isRequirementRepresentedByAccessory(requirement, accessories))),
    ])
      .map((fragment) => fragment.replace(/[.,;:\s]+$/g, ""))
      .filter((fragment) => !composition.toLowerCase().includes(fragment.toLowerCase()));
    const accessoryDetails = uniqueFragments(
      accessories
        .map((accessory) => ({ ...accessory, specification: stripCommercialAvailabilityNotes(accessory.specification) || null }))
        .map(directAccessoryPhrase),
    );
    const details = [...rowDetails, ...accessoryDetails];
    return withBrandOrigin(
      details.length
        ? `${composition.replace(/[.,;:\s]+$/g, "")}, ${naturalJoin(details)}.`
        : composition,
    );
  }
  return withBrandOrigin(appendUpholsteryCategory(composition, selectedCategory));
}

export function resolveFinalProductSpecification({
  editedSpecification,
  generatedSpecification,
  wasEdited,
}: {
  editedSpecification?: string | null;
  generatedSpecification: string | null;
  wasEdited: boolean;
}) {
  return wasEdited ? editedSpecification ?? generatedSpecification : generatedSpecification;
}

function naturalJoin(parts: string[]) {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;

  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function uniqueFragments(parts: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const fragments: string[] = [];

  for (const value of parts) {
    const normalized = compactText(value);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    fragments.push(normalized);
  }

  return fragments;
}

function screenSpecificationPhrase(snapshot: ProductSpecificationLinkedProductInput) {
  const combined = [
    snapshot.label,
    snapshot.template_name,
    snapshot.selected_category,
    snapshot.specification,
  ]
    .map((value) => compactText(value))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (combined.includes("melamine")) return "melamine front screen";
  if (
    combined.includes("fabric") ||
    combined.includes("upholster") ||
    combined.includes("cat ") ||
    combined.includes("category")
  ) {
    return "front fabric screen";
  }

  return "front screen";
}

function componentSpecificationPhrase(snapshot: ProductSpecificationOptionInput) {
  const itemType = compactText(snapshot.item_type).toLowerCase();
  const specification = compactText(snapshot.specification);
  const label = compactText(snapshot.label);
  const group = compactText(snapshot.group).toLowerCase();
  const combined = [group, label, specification].filter(Boolean).join(" ").toLowerCase();

  if (itemType === "cluster_preset") return "";
  if (combined.includes("screen")) {
    if (combined.includes("melamine")) return "melamine front screen";
    if (
      combined.includes("fabric") ||
      combined.includes("upholster") ||
      combined.includes("cat ") ||
      combined.includes("category")
    ) {
      return "front fabric screen";
    }

    return "front screen";
  }

  return specification || label;
}

function linkedProductSpecificationPhrase(snapshot: ProductSpecificationLinkedProductInput) {
  if (!snapshot.append_to_specification) return "";

  const combined = [
    snapshot.label,
    snapshot.template_name,
    snapshot.selected_category,
    snapshot.specification,
  ]
    .map((value) => compactText(value))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (combined.includes("screen")) {
    return screenSpecificationPhrase(snapshot);
  }

  return compactText(snapshot.specification) || compactText(snapshot.label) || compactText(snapshot.template_name);
}

export function firstNonEmptySnapshotText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = compactText(value);
    if (normalized) return normalized;
  }

  return null;
}

export function buildCompanyStyleProductSpecification({
  accessorySnapshots,
  brand,
  linkedProductSnapshots,
  origin,
  primarySpecification,
  selectedOptionSnapshots,
  selectedWorkstationVariant,
  template,
}: {
  accessorySnapshots: ProductSpecificationAccessoryInput[];
  brand?: string | null;
  linkedProductSnapshots: ProductSpecificationLinkedProductInput[];
  origin?: string | null;
  primarySpecification?: string | null;
  selectedOptionSnapshots: ProductSpecificationOptionInput[];
  selectedWorkstationVariant?: ProductSpecificationWorkstationVariantInput | null;
  template: ProductSpecificationTemplateInput;
}) {
  const withBrandOrigin = (text: string | null) => appendBrandOriginLine(text, brand, origin);
  const baseSpecification = compactText(
    firstNonEmptySnapshotText(
      primarySpecification,
      template.default_specification,
      template.description,
    ) ?? "",
  );
  const fragments = uniqueFragments([
    ...selectedOptionSnapshots.map((snapshot) => componentSpecificationPhrase(snapshot)),
    ...linkedProductSnapshots.map((snapshot) => linkedProductSpecificationPhrase(snapshot)),
    ...accessorySnapshots.map((snapshot) => stripCommercialAvailabilityNotes(snapshot.specification) || compactText(snapshot.item_name)),
    compactText(selectedWorkstationVariant?.specification) || compactText(selectedWorkstationVariant?.variant_name),
  ].map((fragment) => stripCommercialAvailabilityNotes(fragment)));

  if (!baseSpecification) {
    return withBrandOrigin(sentenceWithPeriod(naturalJoin(fragments)) || null);
  }

  const remainingFragments = fragments.filter(
    (fragment) => !baseSpecification.toLowerCase().includes(fragment.toLowerCase()),
  );

  if (!remainingFragments.length) {
    return withBrandOrigin(sentenceWithPeriod(baseSpecification) || null);
  }

  return withBrandOrigin(`${baseSpecification.replace(/[.,;:\s]+$/g, "")}, ${naturalJoin(remainingFragments)}.`);
}

export function resolveProductSpecificationSnapshot({
  companyStyleSpecification,
  selectedCategorySpecification,
  selectedVariantSpecification,
  selectedWorkstationVariantSpecification,
  template,
}: {
  companyStyleSpecification: string | null;
  selectedCategorySpecification?: string | null;
  selectedVariantSpecification?: string | null;
  selectedWorkstationVariantSpecification?: string | null;
  template: ProductSpecificationTemplateInput;
}) {
  return firstNonEmptySnapshotText(
    companyStyleSpecification,
    selectedCategorySpecification,
    selectedVariantSpecification,
    selectedWorkstationVariantSpecification,
    template.default_specification,
    template.description,
  );
}

export function resolveProductDimensionSnapshot({
  derivedDeskingDimension,
  selectedSizeLabel,
  selectedCategoryDimension,
  selectedVariantDimension,
  selectedWorkstationVariantDimension,
  selectedSizeOptions,
}: {
  derivedDeskingDimension?: string | null;
  selectedSizeLabel?: string | null;
  selectedCategoryDimension?: string | null;
  selectedVariantDimension?: string | null;
  selectedWorkstationVariantDimension?: string | null;
  selectedSizeOptions?: string | null;
}) {
  return firstNonEmptySnapshotText(
    derivedDeskingDimension,
    selectedSizeLabel,
    selectedCategoryDimension,
    selectedVariantDimension,
    selectedWorkstationVariantDimension,
    selectedSizeOptions,
  );
}

export function resolveProductOriginSnapshot(templateOrigin?: string | null, brandOrigin?: string | null) {
  return firstNonEmptySnapshotText(templateOrigin, brandOrigin);
}
