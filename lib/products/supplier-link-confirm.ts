import { linkReasonText, priceLineStateLabels, type LinkRow, type LineMapping, type PriceLine } from "./supplier-price-lines";

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

const amount = (value: number | null, currency: string | null) => value === null ? "—" : `${currency ?? ""} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
/** Code, name and note of a product row (the note only when there is one), so rows with the same name can be told apart. Display only. */
export const linkRowIdentity = (row: Pick<LinkRow, "code" | "name" | "note">) => [row.code, row.name, row.note].filter((part) => part.trim() !== "");
/** One Confirm-all line: tier and price, an arrow, the row's identity and price, the result and the reason. Display only. */
export function confirmLineText(line: PriceLine, row: LinkRow): string {
  const reason = line.link?.suggestion ? linkReasonText(line.link.suggestion.reason, row) : "";
  return [`Tier ${line.link?.tierLabel ?? ""} ${amount(line.supplierPrice, line.supplierCurrency)} →`, [...linkRowIdentity(row), amount(row.price, row.currency), priceLineStateLabels[row.mapping.preview], reason].filter(Boolean).join(" · ")].join(" ");
}
