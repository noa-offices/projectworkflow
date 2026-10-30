import type { PriceMatch } from "./supplier-price-contracts";

export type PriceLineState = "same" | "changed" | "not_in_supplier_list" | "needs_mapping" | "ambiguous" | "shared";
export type PriceLine = {
  key: string; code: string; field: string; ourPrice: number | null; ourCurrency: string; supplierPrice: number | null; supplierCurrency: string | null;
  /** Supplier minus ours; only when both are known and in the same currency. */
  difference: number | null; state: PriceLineState;
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
export function buildPriceLines(matches: PriceMatch[], templateId: string): { lines: PriceLine[]; truncated: boolean } {
  const lines: PriceLine[] = [];
  for (const match of matches) {
    const state = states[match.classification];
    if (!state) continue; // unmatched, invalid or companion rows belong to the supplier list, not to a pricing target
    for (const target of match.targets) {
      if (target.template_id !== templateId) continue;
      const supplierPrice = match.source?.price ?? null;
      const sameCurrency = match.source ? match.source.currency === target.currency : false;
      lines.push({
        key: `${match.key}|${target.key}`, code: target.raw_code || target.code, field: [target.label, target.dimension_label ?? target.dimension].filter(Boolean).join(" · "),
        ourPrice: target.price, ourCurrency: target.currency, supplierPrice, supplierCurrency: match.source?.currency ?? null,
        difference: supplierPrice !== null && target.price !== null && sameCurrency ? Math.round((supplierPrice - target.price) * 100) / 100 : null, state,
      });
    }
  }
  lines.sort((a, b) => a.code.localeCompare(b.code) || a.field.localeCompare(b.field) || a.key.localeCompare(b.key));
  return { lines: lines.slice(0, priceLineLimit), truncated: lines.length > priceLineLimit };
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
