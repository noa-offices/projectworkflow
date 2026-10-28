import {
  FINAL_SPECIFICATION_MAX_LENGTH,
  parseFinalSpecificationRequest,
  type FinalSpecificationRequest,
} from "./final-specification-ai-contract";

export type FinalSpecificationSelectionEntry = {
  label?: unknown;
  selected?: boolean;
  quantity?: unknown;
};

export type FinalSpecificationSelectionInput = {
  currentSpecification?: unknown;
  productName?: unknown;
  selectedModel?: unknown;
  selectedDimensions?: unknown;
  finishes?: readonly FinalSpecificationSelectionEntry[];
  options?: readonly FinalSpecificationSelectionEntry[];
  accessories?: readonly FinalSpecificationSelectionEntry[];
  companions?: readonly FinalSpecificationSelectionEntry[];
  selectedRowFacts?: readonly unknown[];
};

function selectedLabels(entries: readonly FinalSpecificationSelectionEntry[] = [], quantityRequired = false) {
  return entries.flatMap((entry) => {
    if (entry.selected === false) return [];
    if (quantityRequired && (!Number.isFinite(Number(entry.quantity)) || Number(entry.quantity) <= 0)) return [];
    return typeof entry.label === "string" && entry.label.trim() ? [entry.label.trim()] : [];
  });
}

export function buildFinalSpecificationRequest(input: FinalSpecificationSelectionInput): FinalSpecificationRequest {
  const request = parseFinalSpecificationRequest({
    currentSpecification: input.currentSpecification ?? null,
    productName: input.productName,
    selectedModel: input.selectedModel ?? null,
    selectedDimensions: input.selectedDimensions ?? null,
    selectedFinishLabels: selectedLabels(input.finishes),
    selectedOptionLabels: selectedLabels(input.options),
    selectedAccessoryLabels: selectedLabels(input.accessories, true),
    selectedCompanionLabels: selectedLabels(input.companions, true),
    selectedRowFacts: (input.selectedRowFacts ?? []).filter((fact): fact is string => typeof fact === "string"),
  });
  if (!request) throw new Error("Final specification selection is invalid.");
  return request;
}

export function finalSpecificationRequestFingerprint(request: FinalSpecificationRequest) {
  return JSON.stringify(request);
}

export function acceptedFinalSpecificationSuggestion(value: string) {
  const trimmed = value.trim();
  return trimmed && trimmed.length <= FINAL_SPECIFICATION_MAX_LENGTH ? trimmed : null;
}

const lineKey = (value: string) => value.toLowerCase().replace(/[–—-]+/g, "-").replace(/\s+/g, " ").trim();
/**
 * The copy of the specification text that is sent to the AI: without the "Dimension:" line and without a line that is only the
 * selected brand, the origin, or "brand - origin". The on-screen and saved text are not changed by this.
 */
export function specificationForAi(text: string | null, { brand, origin }: { brand?: string | null; origin?: string | null }): string | null {
  if (text === null) return null;
  const brandKey = lineKey(brand ?? ""), originKey = lineKey(origin ?? "");
  const blocked = new Set([brandKey, originKey, brandKey && originKey ? `${brandKey} - ${originKey}` : "", brandKey && originKey ? `${originKey} - ${brandKey}` : ""].filter(Boolean));
  return text.split("\n").filter((line) => !/^\s*dimension\s*:/i.test(line) && !blocked.has(lineKey(line))).join("\n").trim();
}
