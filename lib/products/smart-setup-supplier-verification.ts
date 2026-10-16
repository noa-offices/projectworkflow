import type { ProductTemplateDraft } from "./product-template-draft";
import { SMART_SETUP_CHECK_MAX_CELLS, type SmartSetupSupplierCheckResult, type SmartSetupSupplierCheckStatus } from "./smart-setup-supplier-check";
import { projectDraftPricing, type SmartSetupPriceCell, type SmartSetupUnsupportedCell } from "./smart-setup-supplier-targets";

export const statusLabels: Record<SmartSetupSupplierCheckStatus, string> = { MATCHED: "MATCHED", MISMATCH: "MISMATCH", NOT_FOUND: "NOT FOUND", NEEDS_REVIEW: "NEEDS REVIEW" };
export const reasonLabels: Record<SmartSetupSupplierCheckResult["reason"], string> = {
  same_price: "Same price as the supplier list.", price_differs: "Price differs from the supplier list.", no_source_candidate: "Code not found in this supplier price list.",
  missing_draft_price: "The imported price is empty, so it cannot be compared.", currency_mismatch: "Currency differs from the supplier list.", basis_mismatch: "Price basis differs from the supplier list.",
  ambiguous_source_contexts: "The supplier list has several prices for this code and context; one is not chosen automatically.", shared_price_unconfirmed: "The code is shared by several rows; the shared price is not confirmed.",
  shared_price_baseline_drift: "Rows sharing this code carry different prices.", needs_dimension_mapping: "The supplier category/size is not mapped to this column.",
  invalid_source_evidence: "The supplier price for this code is not usable.", companion_reference: "The supplier list only references this code as a companion.",
};
const statusOrder: Record<SmartSetupSupplierCheckStatus, number> = { MISMATCH: 0, NEEDS_REVIEW: 1, NOT_FOUND: 2, MATCHED: 3 };

/** Stable 32-bit FNV-1a over a string, with its length: cheap, deterministic, and independent of any dirty flag. */
export function smartSetupFingerprint(parts: unknown): string {
  const text = JSON.stringify(parts) ?? ""; let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `${text.length}:${hash.toString(16)}`;
}
/** Everything a check result depends on: the whole priced draft, routing, brand and the exact source version. */
export function checkFingerprint(input: { draft: ProductTemplateDraft; routingPlan: unknown; brandId: string; definitionId: string; versionId: string }) {
  const { draft } = input;
  return smartSetupFingerprint({ p: draft.pricing, o: draft.optionGroups, c: draft.defaultCurrency, r: input.routingPlan, b: input.brandId, d: input.definitionId, v: input.versionId });
}

export type SmartSetupCheckRequest = { ok: true; cells: SmartSetupPriceCell[]; unsupported: SmartSetupUnsupportedCell[] } | { ok: false; message: string };
/** The exact projection sent to the service. Over the limit is an error: a partial check is never sent. */
export function buildSmartSetupCheckRequest(draft: ProductTemplateDraft): SmartSetupCheckRequest {
  const { cells, unsupported } = projectDraftPricing(draft);
  if (cells.length > SMART_SETUP_CHECK_MAX_CELLS) return { ok: false, message: `This draft has ${cells.length} priced cells. At most ${SMART_SETUP_CHECK_MAX_CELLS} can be checked at once; split the draft or verify in smaller imports.` };
  if (!cells.length) return { ok: false, message: unsupported.length ? "No priced row has a single supplier code, so there is nothing to check." : "The draft has no priced rows to check." };
  return { ok: true, cells, unsupported };
}
export function summarizeCheckResults(results: SmartSetupSupplierCheckResult[]) {
  const counts: Record<SmartSetupSupplierCheckStatus, number> = { MATCHED: 0, MISMATCH: 0, NOT_FOUND: 0, NEEDS_REVIEW: 0 };
  results.forEach((r) => { counts[r.status]++; });
  return { counts, discrepancies: counts.MISMATCH + counts.NEEDS_REVIEW };
}
/** Mismatch and Needs Review first (stable within a status); Matched and Not Found on request. */
export function visibleCheckResults(results: SmartSetupSupplierCheckResult[], showAll: boolean) {
  return results.map((r, i) => ({ r, i })).filter(({ r }) => showAll || r.status === "MISMATCH" || r.status === "NEEDS_REVIEW")
    .sort((a, b) => statusOrder[a.r.status] - statusOrder[b.r.status] || a.i - b.i).map(({ r }) => r);
}
/** A supplier price is shown only when the service established one; ambiguous or unresolved rows never show a supplier value. */
export function referencePriceText(r: SmartSetupSupplierCheckResult) {
  return (r.status === "MATCHED" || r.status === "MISMATCH") && r.referencePrice !== null ? `${r.referenceCurrency ?? ""} ${r.referencePrice}`.trim() : "—";
}
export const importedPriceText = (r: SmartSetupSupplierCheckResult) => (r.importedPrice === null ? "—" : `${r.importedCurrency} ${r.importedPrice}`);
export function evidenceText(r: SmartSetupSupplierCheckResult) {
  return r.evidence ? `${r.evidence.sheet ? `${r.evidence.sheet}, ` : ""}row ${r.evidence.rowNumber}` : "";
}
export function sourceOptionLabel(o: { name: string; versionTitle: string; effectiveFrom: string | null; currency: string; basis: string }) {
  return `${o.name} — ${o.versionTitle}${o.effectiveFrom ? `, effective ${o.effectiveFrom}` : ""} · ${o.currency} · ${o.basis} price`;
}
