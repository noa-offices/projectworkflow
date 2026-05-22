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

function compactText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function sentenceWithPeriod(value: string) {
  const trimmed = value.trim().replace(/[.,;:\s]+$/g, "");
  return trimmed ? `${trimmed}.` : "";
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
