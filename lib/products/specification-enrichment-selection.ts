import type { SpecificationEnrichmentContext, SpecificationEnrichmentRow } from "./specification-enrichment-contract";

export function specificationEnrichmentFingerprint(
  row: SpecificationEnrichmentRow,
  context: SpecificationEnrichmentContext,
) {
  return JSON.stringify({ row, context });
}

export function specificationEnrichmentFieldPatch(
  field: "displayName" | "specification",
  value: string,
): Pick<SpecificationEnrichmentRow, "displayName"> | Pick<SpecificationEnrichmentRow, "specification"> {
  return field === "displayName" ? { displayName: value } : { specification: value };
}

export function applySpecificationEnrichmentField(
  row: SpecificationEnrichmentRow,
  field: "displayName" | "specification",
  value: string,
) {
  return { ...row, ...specificationEnrichmentFieldPatch(field, value) };
}
