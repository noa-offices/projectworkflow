import { SPEC_ENRICHMENT_SPECIFICATION_MAX } from "./specification-enrichment-contract";
import type { BatchSpecificationSuggestion } from "./specification-enrichment-batch";

export type EditableBatchSpecificationSuggestion = {
  targetId: string;
  value: string;
  selected: boolean;
};

export function initializeEditableBatchSpecificationSuggestions(suggestions: BatchSpecificationSuggestion[]): EditableBatchSpecificationSuggestion[] {
  return suggestions.flatMap((suggestion) => suggestion.specificationSuggestion === null ? [] : [{
    targetId: suggestion.targetId,
    value: suggestion.specificationSuggestion,
    selected: true,
  }]);
}

export function updateEditableBatchSpecificationSuggestion(items: EditableBatchSpecificationSuggestion[], targetId: string, patch: Partial<Pick<EditableBatchSpecificationSuggestion, "value" | "selected">>) {
  return items.map((item) => item.targetId === targetId ? { ...item, ...patch } : item);
}

export function selectedBatchSpecificationSuggestions(items: EditableBatchSpecificationSuggestion[]): BatchSpecificationSuggestion[] {
  return items.flatMap((item) => {
    const value = item.value.trim();
    return item.selected && value.length > 0 && value.length <= SPEC_ENRICHMENT_SPECIFICATION_MAX
      ? [{ targetId: item.targetId, specificationSuggestion: value }]
      : [];
  });
}
