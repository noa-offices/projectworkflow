import type { LineMapping } from "./supplier-price-lines";

/** The proposal shape of the existing confirmSupplierBindings action, for one alias link. Same fields the "Map this line" step sends. */
export const aliasProposal = (mapping: LineMapping) => ({
  code: mapping.code, price_field: mapping.priceField, source_dimension: mapping.sourceDimension, kind: "alias" as const, target_keys: [mapping.targetKey],
  expected_targets: [{ key: mapping.targetKey, pricing_version: mapping.pricingVersion, price: mapping.targetPrice, currency: mapping.targetCurrency }],
});
export type AliasProposal = ReturnType<typeof aliasProposal>;
export type SaveBindings = (brandId: string, proposals: AliasProposal[]) => Promise<unknown>;
export type LinkOutcome = { saved: number; failed: { index: number; label: string; message: string } | null };

/**
 * Saves links one at a time through the existing save action (one call per line, each with its own baseline check and audit row) and stops at
 * the first failure, so the user is told exactly which line failed and how many were saved before it. It writes nothing by itself.
 */
export async function confirmLinksInOrder(brandId: string, links: Array<{ label: string; mapping: LineMapping }>, save: SaveBindings): Promise<LinkOutcome> {
  for (const [index, link] of links.entries()) {
    try { await save(brandId, [aliasProposal(link.mapping)]); }
    catch (reason) { return { saved: index, failed: { index, label: link.label, message: reason instanceof Error ? reason.message : "Could not save." } }; }
  }
  return { saved: links.length, failed: null };
}
