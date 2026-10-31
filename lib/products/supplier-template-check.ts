import { summarizePriceLines, type PriceLine } from "./supplier-price-lines";

/** What the server rebuilt for ONE product against ONE price list (the same data the Supplier price lines popup shows). */
export type TemplateCheckInput = {
  lines: PriceLine[];
  truncated: boolean;
  families: Array<{ key: string }>;
  chosen: Array<{ key: string; family: string }>;
  missing: Array<{ family: string }>;
};
export type TemplateCheckVerdict = {
  ok: boolean;
  /** Plain-words reasons the product cannot be marked as checked yet. Empty when ok. */
  blockers: string[];
  lineCount: number;
  summary: { same: number; shared: number; families: string[] };
};

const lines = (count: number) => `${count} ${count === 1 ? "line" : "lines"}`;

/**
 * A product may be marked as checked only when EVERY line matches: Same, or a confirmed Shared mapping. Anything changed, needing
 * mapping, unclear, missing, empty-price, or waiting for a family blocks it. Pure; the server runs it on the rebuilt comparison.
 */
export function evaluateTemplateCheck(source: TemplateCheckInput): TemplateCheckVerdict {
  const summary = summarizePriceLines(source.lines);
  const blockers: string[] = [];
  if (source.lines.length === 0) blockers.push("This product has no lines in this price list.");
  if (source.truncated) blockers.push("This product has too many lines to check at once.");
  if (summary.changed) blockers.push(`${lines(summary.changed)} changed. Review them first.`);
  if (summary.needsMapping) blockers.push(`${lines(summary.needsMapping)} ${summary.needsMapping === 1 ? "needs" : "need"} mapping.`);
  if (summary.other) blockers.push(`${lines(summary.other)} unclear or missing from the price list.`);
  const empty = source.lines.filter((line) => line.ourPrice === null).length;
  if (empty) blockers.push(`${lines(empty)} ${empty === 1 ? "has" : "have"} an empty price. Set the price first.`);
  if (source.lines.some((line) => line.familyHint) || (source.families.length > 0 && source.chosen.length === 0 && source.lines.some((line) => line.state !== "same" && line.state !== "shared"))) {
    blockers.push("Choose a family for this product first.");
  }
  for (const item of source.missing) blockers.push(`This family is not in the price list: ${item.family}. Choose again.`);
  return {
    ok: blockers.length === 0, blockers, lineCount: source.lines.length,
    summary: { same: summary.same - summary.shared, shared: summary.shared, families: source.chosen.map((item) => item.family) },
  };
}
