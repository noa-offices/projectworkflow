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
  itemName?: string | null;
  label?: string | null;
  quantity?: number | null;
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

export function buildModularCompositionSpecification({
  items,
  modularDefaultSpecification,
  selectedCategory,
  templateDefaultSpecification,
  templateDescription,
}: {
  items: ModularCompositionSpecificationItem[];
  modularDefaultSpecification?: string | null;
  selectedCategory?: string | null;
  templateDefaultSpecification?: string | null;
  templateDescription?: string | null;
}) {
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

  if (!selectedItems.length) return baseSpecification ? sentenceWithPeriod(baseSpecification) : null;
  if (selectedItems.length === 1 && selectedItems[0].quantity === 1) {
    const rowSpecification = compactText(selectedItems[0].specification);
    if (rowSpecification) return appendUpholsteryCategory(sentenceWithPeriod(rowSpecification), selectedCategory);
  }

  const quantities = selectedItems.map((item) => {
    const label = readableModularLabel(item.label);
    return `${item.quantity} ${item.quantity === 1 ? label : pluralizeModularLabel(label)}`;
  });
  const baseStem = compactText(baseSpecification)
    .replace(/[.,;:\s]+$/g, "")
    .replace(/\bcompris(?:e|es|ing)\b.*$/i, "")
    .replace(/[.,;:\s]+$/g, "") || "Modular lounge seating";
  const composition = `${baseStem} comprising ${naturalModularJoin(quantities)}.`;
  return appendUpholsteryCategory(composition, selectedCategory);
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
  linkedProductSnapshots,
  primarySpecification,
  selectedOptionSnapshots,
  selectedWorkstationVariant,
  template,
}: {
  accessorySnapshots: ProductSpecificationAccessoryInput[];
  linkedProductSnapshots: ProductSpecificationLinkedProductInput[];
  primarySpecification?: string | null;
  selectedOptionSnapshots: ProductSpecificationOptionInput[];
  selectedWorkstationVariant?: ProductSpecificationWorkstationVariantInput | null;
  template: ProductSpecificationTemplateInput;
}) {
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
    ...accessorySnapshots.map((snapshot) => compactText(snapshot.specification) || compactText(snapshot.item_name)),
    compactText(selectedWorkstationVariant?.specification) || compactText(selectedWorkstationVariant?.variant_name),
  ]);

  if (!baseSpecification) {
    return sentenceWithPeriod(naturalJoin(fragments)) || null;
  }

  const remainingFragments = fragments.filter(
    (fragment) => !baseSpecification.toLowerCase().includes(fragment.toLowerCase()),
  );

  if (!remainingFragments.length) {
    return sentenceWithPeriod(baseSpecification) || null;
  }

  return `${baseSpecification.replace(/[.,;:\s]+$/g, "")}, ${naturalJoin(remainingFragments)}.`;
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
