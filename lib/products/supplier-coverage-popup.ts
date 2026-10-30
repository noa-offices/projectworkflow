import type { SupplierSourceDefinitionSummary } from "./supplier-price-contracts";

export type CoverageChoice = { id: string; name: string; detail: string };

/** Active definitions only, by name. The user always chooses; one definition is not pre-selected for them. */
export function coverageChoices(definitions: SupplierSourceDefinitionSummary[]): CoverageChoice[] {
  return definitions
    .filter((definition) => definition.isActive)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((definition) => ({
      id: definition.id,
      name: definition.name,
      detail: `${definition.confirmedFamilyCount} ${definition.confirmedFamilyCount === 1 ? "product" : "products"} covered${definition.latestSource ? ` · ${definition.latestSource.title}` : " · no price list imported yet"}`,
    }));
}

/** Confirm is only possible for a choice that is in the offered list. */
export function canConfirmCoverage(choices: CoverageChoice[], selectedId: string, busy: boolean) {
  return !busy && choices.some((choice) => choice.id === selectedId);
}
