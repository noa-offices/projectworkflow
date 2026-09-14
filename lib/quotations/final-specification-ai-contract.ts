export const FINAL_SPECIFICATION_MAX_LENGTH = 1500;

export type FinalSpecificationRequest = {
  currentSpecification: string | null;
  productName: string;
  selectedModel: string | null;
  selectedDimensions: string | null;
  selectedFinishLabels: string[];
  selectedOptionLabels: string[];
  selectedAccessoryLabels: string[];
  selectedCompanionLabels: string[];
  selectedRowFacts: string[];
};

export type FinalSpecificationResult = {
  specificationSuggestion: string | null;
};

export type FinalSpecificationActionResult =
  | { ok: true; result: FinalSpecificationResult }
  | { ok: false; code: "invalid_request" | "not_configured" | "provider_failed"; message: string };

const requestKeys = new Set([
  "currentSpecification",
  "productName",
  "selectedModel",
  "selectedDimensions",
  "selectedFinishLabels",
  "selectedOptionLabels",
  "selectedAccessoryLabels",
  "selectedCompanionLabels",
  "selectedRowFacts",
]);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableText(value: unknown, maximum: number): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maximum ? trimmed : undefined;
}

function textList(value: unknown, maximumItems: number, maximumLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const items: string[] = [];
  for (const entry of value) {
    const parsed = nullableText(entry, maximumLength);
    if (parsed === undefined) return null;
    if (parsed && !items.includes(parsed)) items.push(parsed);
  }
  return items;
}

export function parseFinalSpecificationRequest(value: unknown): FinalSpecificationRequest | null {
  if (!record(value) || Object.keys(value).some((key) => !requestKeys.has(key))) return null;
  const currentSpecification = nullableText(value.currentSpecification, 6000);
  const productName = nullableText(value.productName, 300);
  const selectedModel = nullableText(value.selectedModel, 300);
  const selectedDimensions = nullableText(value.selectedDimensions, 300);
  const selectedFinishLabels = textList(value.selectedFinishLabels, 120, 300);
  const selectedOptionLabels = textList(value.selectedOptionLabels, 120, 300);
  const selectedAccessoryLabels = textList(value.selectedAccessoryLabels, 120, 300);
  const selectedCompanionLabels = textList(value.selectedCompanionLabels, 120, 300);
  const selectedRowFacts = textList(value.selectedRowFacts, 120, 1500);

  if (
    currentSpecification === undefined || !productName || selectedModel === undefined ||
    selectedDimensions === undefined || !selectedFinishLabels || !selectedOptionLabels ||
    !selectedAccessoryLabels || !selectedCompanionLabels || !selectedRowFacts
  ) return null;

  return {
    currentSpecification,
    productName,
    selectedModel,
    selectedDimensions,
    selectedFinishLabels,
    selectedOptionLabels,
    selectedAccessoryLabels,
    selectedCompanionLabels,
    selectedRowFacts,
  };
}

export function parseFinalSpecificationResult(value: unknown): FinalSpecificationResult | null {
  if (!record(value)) return null;
  const specificationSuggestion = nullableText(value.specificationSuggestion, FINAL_SPECIFICATION_MAX_LENGTH);
  return specificationSuggestion === undefined ? null : { specificationSuggestion };
}
