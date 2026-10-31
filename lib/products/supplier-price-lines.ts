import type { DurableBinding, PriceMatch, SourceIdentity } from "./supplier-price-contracts";
import { comparisonCode, matchSupplierPrices, sharedBaselineDrift } from "./supplier-price-matching";
import { supplierDimensionFamily } from "./supplier-price-import";

export type PriceLineState = "same" | "changed" | "not_in_supplier_list" | "needs_mapping" | "ambiguous" | "shared";
/** Everything needed to save one alias mapping for a Needs-mapping line, plus what the line would become (computed in memory, no writes). */
export type LineMapping = { code: string; priceField: string; sourceDimension: string; tierLabel: string; targetKey: string; pricingVersion: string; targetPrice: number | null; targetCurrency: string; preview: PriceLineState };
/** "Use supplier price" for one changed single-target line. batchId is filled in by the server only when an open review holds this exact line. */
export type LineApply = { matchKey: string; targetKey: string; batchId: string | null };
/**
 * Everything needed to save ONE shared mapping for an unclear line whose supplier row is used by 2 or more price lines with the same
 * price, currency, tier and price field. The targets are exactly the matcher's targets; the user never picks them. Preview is in memory.
 */
export type LineShared = {
  code: string; priceField: string; sourceDimension: string; preview: PriceLineState;
  targets: Array<{ key: string; templateId: string; templateName: string; label: string; pricingVersion: string; price: number | null; currency: string }>;
};
export type PriceLine = {
  key: string; code: string; field: string; ourPrice: number | null; ourCurrency: string; supplierPrice: number | null; supplierCurrency: string | null;
  /** Supplier minus ours; only when both are known and in the same currency. */
  difference: number | null; state: PriceLineState;
  /** Present only when this line can safely be mapped here (one target, one supplier tier, no saved mapping yet). */
  mapping?: LineMapping;
  /** Present when a saved, confirmed mapping (binding) of the Brand is what matches this line. */
  binding?: { id: string; kind: string };
  apply?: LineApply;
  /** Present only when this unclear line can safely be mapped as shared (see LineShared). */
  shared?: LineShared;
  /** Why there is no button: the price is empty (set it by hand in Edit Template), or the open review no longer matches this line. */
  applyHint?: "set_by_hand" | "old_review";
  /** The list has families, this product has none saved, and this line carries a family: mapping waits until a family is chosen. */
  familyHint?: "choose_family";
};
export const priceLineLimit = 500;

const states: Partial<Record<string, PriceLineState>> = {
  unchanged: "same", increased: "changed", decreased: "changed", changed: "changed", target_not_represented: "not_in_supplier_list",
  needs_dimension_mapping: "needs_mapping", ambiguous: "ambiguous", baseline_drift: "ambiguous", shared: "shared",
};
export const priceLineStateLabels: Record<PriceLineState, string> = {
  same: "Same", changed: "Changed", not_in_supplier_list: "Not in supplier list", needs_mapping: "Needs mapping", ambiguous: "Unclear match", shared: "Shared",
};

/**
 * This template's lines from matches computed over the whole source coverage (so a code shared with another product classifies
 * exactly as in a review). Read-only: it only reshapes matches. Lines are one per pricing target of this template.
 */
export function buildPriceLines(matches: PriceMatch[], templateId: string, bindings: Array<Pick<DurableBinding, "id" | "code" | "price_field" | "source_dimension" | "kind" | "confirmed">> = [], options: { familyRequired?: boolean } = {}): { lines: PriceLine[]; truncated: boolean } {
  const lines: PriceLine[] = [];
  const identity = (code: string, field: string, dimension: string) => JSON.stringify([comparisonCode(code), field, dimension]);
  // Same rule as the matcher: two bindings for one identity are both ignored.
  const grouped = new Map<string, typeof bindings>();
  for (const binding of bindings.filter((item) => item.confirmed)) grouped.set(identity(binding.code, binding.price_field, binding.source_dimension), [...(grouped.get(identity(binding.code, binding.price_field, binding.source_dimension)) ?? []), binding]);
  const tiersPerCode = new Map<string, number>();
  for (const match of matches) if (match.source) { const key = JSON.stringify([comparisonCode(match.source.code), match.source.price_field]); tiersPerCode.set(key, (tiersPerCode.get(key) ?? 0) + 1); }
  for (const match of matches) {
    const state = states[match.classification];
    if (!state) continue; // unmatched, invalid or companion rows belong to the supplier list, not to a pricing target
    for (const target of match.targets) {
      if (target.template_id !== templateId) continue;
      const supplierPrice = match.source?.price ?? null;
      const sameCurrency = match.source ? match.source.currency === target.currency : false;
      const saved = match.source ? grouped.get(identity(match.source.code, match.source.price_field, match.source.dimension)) : undefined;
      const binding = saved?.length === 1 ? { id: saved[0].id, kind: saved[0].kind } : undefined;
      const mappable = state === "needs_mapping" && !binding && match.source && match.source.price !== null && match.targets.length === 1
        && tiersPerCode.get(JSON.stringify([comparisonCode(match.source.code), match.source.price_field])) === 1;
      // One changed line with one target, a valid supplier price in the same currency. Shared, ambiguous and unmapped lines never qualify.
      const applicable = state === "changed" && match.targets.length === 1 && match.source !== null && !match.source.issues.length
        && match.source.price !== null && Number.isFinite(match.source.price) && match.source.price >= 0 && match.source.currency === target.currency;
      // Unclear only because several targets read the same supplier row at one price: the matcher's own "candidate_shared" case, nothing else.
      const shareable = match.classification === "ambiguous" && match.candidate_shared === true && !binding && match.source !== null && !match.source.issues.length
        && match.source.price !== null && Number.isFinite(match.source.price) && match.source.price >= 0 && match.targets.length >= 2
        && !sharedBaselineDrift(match.targets) && match.targets.every((item) => item.currency === match.source!.currency);
      // Without a saved family a family-tagged line cannot be mapped: the family decides which supplier rows belong to this product.
      const waitsForFamily = Boolean(options.familyRequired && match.source && supplierDimensionFamily(match.source.dimension) !== null);
      const offerMapping = Boolean(mappable) && !waitsForFamily, offerShared = shareable && !waitsForFamily;
      lines.push({
        ...(binding ? { binding } : {}),
        ...(waitsForFamily && (mappable || shareable) ? { familyHint: "choose_family" as const } : {}),
        ...(offerShared && match.source ? { shared: previewShared(match.source, match.targets) } : {}),
        // An empty price cannot be applied safely: the price writer only accepts a stored value that is exactly null, so it is set by hand.
        ...(applicable && target.price !== null ? { apply: { matchKey: match.key, targetKey: target.key, batchId: null } } : {}),
        ...(applicable && target.price === null ? { applyHint: "set_by_hand" as const } : {}),
        ...(offerMapping && match.source ? { mapping: previewMapping(match.source, target) } : {}),
        key: `${match.key}|${target.key}`, code: target.raw_code || target.code, field: [target.label, target.dimension_label ?? target.dimension].filter(Boolean).join(" · "),
        ourPrice: target.price, ourCurrency: target.currency, supplierPrice, supplierCurrency: match.source?.currency ?? null,
        difference: supplierPrice !== null && target.price !== null && sameCurrency ? Math.round((supplierPrice - target.price) * 100) / 100 : null, state,
      });
    }
  }
  lines.sort((a, b) => a.code.localeCompare(b.code) || a.field.localeCompare(b.field) || a.key.localeCompare(b.key));
  return { lines: lines.slice(0, priceLineLimit), truncated: lines.length > priceLineLimit };
}

/** In-memory preview for a shared mapping: the real matcher with the proposed shared binding added. Never writes. */
export function previewShared(source: SourceIdentity, targets: PriceMatch["targets"]): LineShared {
  const proposed: DurableBinding = { id: "preview", code: source.code, price_field: source.price_field, source_dimension: source.dimension, target_keys: targets.map((item) => item.key), kind: "shared", confirmed: true };
  const [result] = matchSupplierPrices([source], targets, [], [proposed]);
  return {
    code: source.code, priceField: source.price_field, sourceDimension: source.dimension, preview: states[result.classification] ?? "ambiguous",
    targets: targets.map((item) => ({ key: item.key, templateId: item.template_id, templateName: item.template_name, label: item.label, pricingVersion: item.pricing_version, price: item.price, currency: item.currency })),
  };
}

/** In-memory preview: the real matcher with the proposed alias added. Never writes. */
export function previewMapping(source: SourceIdentity, target: PriceMatch["targets"][number]): LineMapping {
  const proposed: DurableBinding = { id: "preview", code: source.code, price_field: source.price_field, source_dimension: source.dimension, target_keys: [target.key], kind: "alias", confirmed: true };
  const [result] = matchSupplierPrices([source], [target], [], [proposed]);
  return { code: source.code, priceField: source.price_field, sourceDimension: source.dimension, tierLabel: source.raw_dimension ?? source.dimension, targetKey: target.key, pricingVersion: target.pricing_version, targetPrice: target.price, targetCurrency: target.currency, preview: states[result.classification] ?? "ambiguous" };
}

export type PriceLineFilter = "all" | "attention" | "same";
export type PriceLineSummary = { same: number; changed: number; needsMapping: number; other: number };

export function summarizePriceLines(lines: PriceLine[]): PriceLineSummary {
  const summary: PriceLineSummary = { same: 0, changed: 0, needsMapping: 0, other: 0 };
  for (const line of lines) {
    if (line.state === "same") summary.same++;
    else if (line.state === "changed") summary.changed++;
    else if (line.state === "needs_mapping") summary.needsMapping++;
    else summary.other++;
  }
  return summary;
}

const attentionOrder: Record<PriceLineState, number> = { needs_mapping: 0, changed: 1, ambiguous: 2, not_in_supplier_list: 3, shared: 4, same: 5 };
/** Lines that need a look first, then the rest. The incoming (code) order is kept inside each group. */
export function filterAndOrderPriceLines(lines: PriceLine[], filter: PriceLineFilter): PriceLine[] {
  const kept = lines.filter((line) => filter === "all" || (filter === "same" ? line.state === "same" : line.state !== "same"));
  return kept.map((line, index) => ({ line, index })).sort((a, b) => attentionOrder[a.line.state] - attentionOrder[b.line.state] || a.index - b.index).map((item) => item.line);
}
