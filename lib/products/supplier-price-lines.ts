import type { DurableBinding, PriceMatch, PriceTarget, SourceIdentity } from "./supplier-price-contracts";
import { comparisonCode, matchSupplierPrices, sharedBaselineDrift } from "./supplier-price-matching";
import { plainSupplierDimension, supplierDimensionFamily, supplierFamilyKey } from "./supplier-price-import";

/** "covered": an untiered family summary line whose tiers are all linked (see coveredUntiered). Counts as resolved; never applicable. */
export type PriceLineState = "same" | "changed" | "not_in_supplier_list" | "needs_mapping" | "ambiguous" | "shared" | "covered";
/** Everything needed to save one alias mapping for a Needs-mapping line, plus what the line would become (computed in memory, no writes). */
export type LineMapping = { code: string; priceField: string; sourceDimension: string; tierLabel: string; targetKey: string; pricingVersion: string; targetPrice: number | null; targetCurrency: string; preview: PriceLineState };
/** "Use supplier price" for one changed single-target line. batchId is filled in by the server only when an open review holds this exact line. */
export type LineApply = { matchKey: string; targetKey: string; batchId: string | null };
/**
 * Everything needed to save ONE shared mapping for an unclear line whose supplier row is used by 2 or more price lines with the same
 * price, currency, tier and price field. The targets are exactly the matcher's targets; the user never picks them. Preview is in memory.
 */
export type LineShared = {
  code: string; priceField: string; sourceDimension: string; /** The supplier price category (e.g. LG6), read as in the link picker. Display only. */ tierLabel: string; preview: PriceLineState;
  targets: Array<{ key: string; templateId: string; templateName: string; label: string; /** The row's own price category label, when it has one. Display only. */ dimensionLabel?: string; pricingVersion: string; price: number | null; currency: string }>;
};
/** Why a product row is suggested for a supplier tier. Rule (a), a structured model reference per row, is not available on a price target. */
export type LinkSuggestionReason = "name" | "note" | "id" | "price";
export const linkReasonLabels: Record<LinkSuggestionReason, string> = { name: "from the row name", note: "from the row note", id: "from the row id", price: "same price as the row" };
const priceText = (value: number | null, currency: string) => value === null ? "—" : `${currency} ${value.toFixed(2)}`;
/** Reason in plain words. A price reason names the price, e.g. "Same price EUR 49.00 as the row". Display only. */
export const linkReasonText = (reason: LinkSuggestionReason, row: Pick<LinkRow, "price" | "currency">) => reason === "price" ? `Same price ${priceText(row.price, row.currency)} as the row` : linkReasonLabels[reason];
export type LinkRow = { targetKey: string; /** The row's own supplier code, to tell rows apart. Display only. */ code: string; name: string; note: string; price: number | null; currency: string; /** Cannot accept this tier in addition to its saved links. */ taken: boolean; takenReason?: string; linkedTiers?: string[]; mapping: LineMapping };
/**
 * One supplier line that could match several rows of this product (or whose code has several tiers). Nothing is saved: a link is made only
 * through the existing alias mapping, after the user confirms. Rows are this product's rows of the code, in the supplier line's currency.
 */
export type LineLink = { sourceDimension: string; tierLabel: string; rows: LinkRow[]; suggestion?: { targetKey: string; reason: LinkSuggestionReason }; /** No row of this product looks like this tier. Display only. */ notInProduct: boolean };
export type PriceLine = {
  key: string; code: string; field: string; ourPrice: number | null; ourCurrency: string; supplierPrice: number | null; supplierCurrency: string | null;
  /** Supplier minus ours; only when both are known and in the same currency. */
  difference: number | null; state: PriceLineState;
  /** Present only when this line can safely be mapped here (one target, one supplier tier, no saved mapping yet). */
  mapping?: LineMapping;
  /** Present when a saved, confirmed mapping (binding) of the Brand is what matches this line. */
  binding?: { id: string; kind: string };
  linkedTiers?: string[];
  matchHint?: string;
  apply?: LineApply;
  /** Present for a grouped Needs-mapping line (one per supplier line, not one per supplier line and row). */
  link?: LineLink;
  /** Present only when this unclear line can safely be mapped as shared (see LineShared). */
  shared?: LineShared;
  /** Why there is no button: the price is empty (set it by hand in Edit Template), or the open review no longer matches this line. */
  applyHint?: "set_by_hand" | "old_review" | "other_product";
  /** The list has families, this product has none saved, and this line carries a family: mapping waits until a family is chosen. */
  familyHint?: "choose_family";
};
export const priceLineLimit = 500;

const states: Partial<Record<string, PriceLineState>> = {
  unchanged: "same", increased: "changed", decreased: "changed", changed: "changed", target_not_represented: "not_in_supplier_list",
  needs_dimension_mapping: "needs_mapping", ambiguous: "ambiguous", baseline_drift: "ambiguous", shared: "shared",
};
export const priceLineStateLabels: Record<PriceLineState, string> = {
  same: "Same", changed: "Changed", not_in_supplier_list: "Not in supplier list", needs_mapping: "Needs mapping", ambiguous: "Unclear match", shared: "Shared", covered: "Covered by its tiers",
};

/**
 * This template's lines from matches computed over the whole source coverage (so a code shared with another product classifies
 * exactly as in a review). Read-only: it only reshapes matches. Lines are one per pricing target of this template.
 */
export function buildPriceLines(matches: PriceMatch[], templateId: string, bindings: Array<Pick<DurableBinding, "id" | "code" | "price_field" | "source_dimension" | "kind" | "confirmed"> & { target_keys?: string[] }> = [], options: { familyRequired?: boolean; /** Row notes/specification by target key, used only to suggest links. */ rowNotes?: ReadonlyMap<string, string> } = {}): { lines: PriceLine[]; truncated: boolean } {
  const lines: PriceLine[] = [];
  const identity = (code: string, field: string, dimension: string) => JSON.stringify([comparisonCode(code), field, dimension]);
  // Same rule as the matcher: two bindings for one identity are both ignored.
  const grouped = new Map<string, typeof bindings>();
  for (const binding of bindings.filter((item) => item.confirmed)) grouped.set(identity(binding.code, binding.price_field, binding.source_dimension), [...(grouped.get(identity(binding.code, binding.price_field, binding.source_dimension)) ?? []), binding]);
  const tiersPerCode = new Map<string, number>();
  for (const match of matches) if (match.source) { const key = JSON.stringify([comparisonCode(match.source.code), match.source.price_field]); tiersPerCode.set(key, (tiersPerCode.get(key) ?? 0) + 1); }
  const takenKeys = new Set(bindings.filter((item) => item.confirmed).flatMap((item) => item.target_keys ?? []));
  const bindingsByTarget = new Map<string, typeof bindings>();
  for (const binding of bindings.filter((item) => item.confirmed)) for (const key of binding.target_keys ?? []) bindingsByTarget.set(key, [...(bindingsByTarget.get(key) ?? []), binding]);
  const linkedTiers = (key: string) => [...new Set((bindingsByTarget.get(key) ?? []).map((binding) => plainSupplierDimension(binding.source_dimension)).filter(Boolean))].sort();
  const allTiers = new Map<string, string[]>();
  for (const match of matches) if (match.source) {
    const key = JSON.stringify([comparisonCode(match.source.code), match.source.price_field]);
    allTiers.set(key, [...(allTiers.get(key) ?? []), plainSupplierDimension(match.source.raw_dimension ?? match.source.dimension).trim().toLowerCase()]);
  }
  // An untiered family line (no tier letters, e.g. one "JOYCE" price next to tiers JC211...) is only a summary when every tier of that code and
  // family is a confirmed single alias AND its price equals the price of at least one of those tiers. Otherwise it stays a visible problem.
  const familyId = (source: SourceIdentity) => { const family = supplierDimensionFamily(source.dimension); return family ? JSON.stringify([comparisonCode(source.code), source.price_field, supplierFamilyKey(family.family)]) : null; };
  const tierGroups = new Map<string, { linked: boolean; prices: Set<string> }>();
  for (const match of matches) {
    const source = match.source, id = source ? familyId(source) : null;
    if (!source || !id || plainSupplierDimension(source.dimension).trim() === "") continue;
    const saved = grouped.get(identity(source.code, source.price_field, source.dimension));
    const entry = tierGroups.get(id) ?? { linked: true, prices: new Set<string>() };
    entry.linked = entry.linked && saved?.length === 1 && saved[0].kind === "alias";
    entry.prices.add(JSON.stringify([source.price, source.currency]));
    tierGroups.set(id, entry);
  }
  const coveredUntiered = (source: SourceIdentity) => {
    const id = familyId(source);
    if (!id || plainSupplierDimension(source.dimension).trim() !== "" || options.familyRequired || grouped.has(identity(source.code, source.price_field, source.dimension))) return false;
    const tiers = tierGroups.get(id);
    return Boolean(tiers?.linked && tiers.prices.has(JSON.stringify([source.price, source.currency])));
  };
  const groups: Array<{ line: PriceLine; own: PriceTarget[]; source: SourceIdentity }> = [];
  for (const match of matches) {
    const state = states[match.classification];
    if (!state) continue; // unmatched, invalid or companion rows belong to the supplier list, not to a pricing target
    const own = match.targets.filter((target) => target.template_id === templateId);
    const savedBinding = match.source ? grouped.get(identity(match.source.code, match.source.price_field, match.source.dimension)) : undefined;
    // Several rows of this product for one supplier line: one grouped line, not one line per pair. One row but several tiers of the code:
    // the line keeps its shape and only gains a link picker. A code with one tier and one row keeps the existing "Map this line" path.
    let attach: { line: PriceLine; link: LineLink } | null = null;
    if (state === "needs_mapping" && match.source && own.length > 0 && savedBinding?.length !== 1 && (own.length >= 2 || (tiersPerCode.get(JSON.stringify([comparisonCode(match.source.code), match.source.price_field])) ?? 0) > 1)) {
      const source = match.source;
      const waits = Boolean(options.familyRequired && supplierDimensionFamily(source.dimension) !== null);
      const valid = source.price !== null && Number.isFinite(source.price) && source.price >= 0 && !source.issues.length;
      const tierLabel = plainSupplierDimension(source.raw_dimension ?? source.dimension);
      const linkable = valid && !waits;
      const rows: LinkRow[] = linkable ? own.filter((target) => target.currency === source.currency).map((target) => {
        const note = options.rowNotes?.get(target.key) ?? "", linked = linkedTiers(target.key);
        const named = (tier: string) => clueFor(target, tier.trim().toLowerCase(), note) !== null;
        const bound = bindingsByTarget.get(target.key) ?? [];
        const canShare = bound.length > 0 && bound.every((binding) => binding.kind === "alias" && binding.target_keys?.length === 1 && comparisonCode(binding.code) === comparisonCode(source.code) && binding.price_field === source.price_field)
          && new Set([...linked.map((tier) => tier.toLowerCase()), tierLabel.trim().toLowerCase()]).size >= 2 && [...linked, tierLabel].every(named);
        // A row that already holds saved single-target alias tiers of this code may take one more tier of an EQUAL price and currency (several tiers, one price).
        const plainAliases = bound.length > 0 && bound.every((binding) => binding.kind === "alias" && binding.target_keys?.length === 1 && comparisonCode(binding.code) === comparisonCode(source.code) && binding.price_field === source.price_field);
        const samePrice = plainAliases && target.price !== null && source.price === target.price && target.currency === source.currency;
        const taken = takenKeys.has(target.key) && !canShare && !samePrice;
        return { targetKey: target.key, code: target.raw_code || target.code, name: target.label || target.row_id, note, price: target.price, currency: target.currency, taken,
          ...(taken ? { takenReason: plainAliases ? `Different price (${priceText(source.price, source.currency)}) from the row (${priceText(target.price, target.currency)})` : "Already linked by a mapping that cannot be reused." } : {}), ...(linked.length ? { linkedTiers: linked } : {}), mapping: previewMapping(source, target) };
      }) : [];
      const line: PriceLine = {
        key: `${match.key}|link`, code: own[0].raw_code || own[0].code, field: `Tier ${tierLabel || "—"} · could match ${own.length} row${own.length === 1 ? "" : "s"} of your product`,
        ourPrice: null, ourCurrency: own[0].currency, supplierPrice: source.price, supplierCurrency: source.currency, difference: null, state,
        ...(waits ? { familyHint: "choose_family" as const } : {}),
        ...(linkable ? { link: { sourceDimension: source.dimension, tierLabel, rows, notInProduct: false } } : {}),
      };
      if (own.length >= 2) {
        lines.push(line);
        if (linkable) groups.push({ line, own, source });
        continue;
      }
      if (linkable) attach = { line, link: line.link! };
    }
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
      const linked = linkedTiers(target.key);
      const pushed: PriceLine = {
        ...(binding ? { binding } : {}),
        ...(linked.length ? { linkedTiers: linked } : {}),
        ...(state === "ambiguous" && match.aliasSources ? { matchHint: `Conflicting tiers: ${match.aliasSources.map((item) => `${item.tier} ${item.currency} ${item.price}`).join("; ")}.` } : {}),
        ...(waitsForFamily && (mappable || shareable) ? { familyHint: "choose_family" as const } : {}),
        ...(offerShared && match.source ? { shared: previewShared(match.source, match.targets) } : {}),
        // An empty price cannot be applied safely: the price writer only accepts a stored value that is exactly null, so it is set by hand.
        ...(applicable && target.price !== null ? { apply: { matchKey: match.key, targetKey: target.key, batchId: null } } : {}),
        ...(applicable && target.price === null ? { applyHint: "set_by_hand" as const } : {}),
        ...(offerMapping && match.source ? { mapping: previewMapping(match.source, target) } : {}),
        key: `${match.key}|${target.key}`, code: target.raw_code || target.code, field: [target.label, target.dimension_label ?? target.dimension].filter(Boolean).join(" · "),
        ourPrice: target.price, ourCurrency: target.currency, supplierPrice, supplierCurrency: match.source?.currency ?? null,
        difference: supplierPrice !== null && target.price !== null && sameCurrency ? Math.round((supplierPrice - target.price) * 100) / 100 : null, state,
      };
      if (state === "ambiguous" && match.source && coveredUntiered(match.source)) {
        // Summary line: it shows the row's own price, never another row's supplier price, and offers nothing.
        delete pushed.shared; delete pushed.mapping; delete pushed.apply; delete pushed.applyHint; delete pushed.familyHint; delete pushed.matchHint; delete pushed.linkedTiers;
        Object.assign(pushed, { state: "covered" as const, supplierPrice: null, supplierCurrency: null, difference: null, field: [target.label, "covered by its tiers"].filter(Boolean).join(" · ") });
      }
      lines.push(pushed);
      if (attach) { pushed.link = attach.link; groups.push({ line: pushed, own, source: match.source! }); }
    }
  }
  suggestLinks(groups, options.rowNotes ?? new Map(), allTiers);
  lines.sort((a, b) => a.code.localeCompare(b.code) || a.field.localeCompare(b.field) || a.key.localeCompare(b.key));
  return { lines: lines.slice(0, priceLineLimit), truncated: lines.length > priceLineLimit };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasToken = (text: string, tier: string) => tier !== "" && new RegExp(`(^|[^a-z0-9])${escapeRegExp(tier)}([^a-z0-9]|$)`).test(text.toLowerCase());
/** The strongest clue that links one row to one tier, or null. Order: name/note, then whole tokens in the row id. */
function clueFor(target: PriceTarget, tier: string, note: string): LinkSuggestionReason | null {
  if (hasToken(target.label, tier)) return "name";
  if (hasToken(note, tier)) return "note";
  return hasToken(target.row_id, tier) ? "id" : null;
}
/**
 * Suggestions only; never applied. A tier is suggested a row only when exactly one row of this product carries a clue at the strongest level that
 * has any, and that row can accept this tier. Several tiers can share a row only when it names them. Any ambiguity means no suggestion. A tier that no row of the
 * product mentions is marked "not in this product", but only when the other tiers of the same code do match rows (so the product's rows are
 * recognisable); otherwise it stays a normal line.
 */
function suggestLinks(groups: Array<{ line: PriceLine; own: PriceTarget[]; source: SourceIdentity }>, notes: ReadonlyMap<string, string>, allTiers: ReadonlyMap<string, string[]>) {
  const byCode = new Map<string, typeof groups>();
  for (const group of groups) { const key = JSON.stringify([comparisonCode(group.source.code), group.source.price_field]); byCode.set(key, [...(byCode.get(key) ?? []), group]); }
  for (const [code, list] of byCode) {
    const tiers = (allTiers.get(code) ?? []).filter(Boolean);
    const found = list.map((group) => {
      const tier = group.line.link!.tierLabel.trim().toLowerCase();
      // An id clue yields to a name/note naming a different tier, unless the merged id itself names that tier too.
      const contradicts = (target: PriceTarget) => tiers.some((other) => other !== tier && (hasToken(target.label, other) || hasToken(notes.get(target.key) ?? "", other)) && !hasToken(target.row_id, other));
      const hits = group.own.map((target) => ({ target, reason: clueFor(target, tier, notes.get(target.key) ?? "") })).filter((hit): hit is { target: PriceTarget; reason: LinkSuggestionReason } => hit.reason !== null && (hit.reason !== "id" || !contradicts(hit.target)));
      const level = hits.some((hit) => hit.reason !== "id") ? hits.filter((hit) => hit.reason !== "id") : hits;
      return { group, hits, pick: level.length === 1 && group.line.link!.rows.some((row) => row.targetKey === level[0].target.key && !row.taken) ? level[0] : null };
    });
    const recognisable = tiers.some((tier) => list.some((group) => group.own.some((target) => clueFor(target, tier, notes.get(target.key) ?? "") !== null)));
    // Weakest clue: equal price. Only for plain rows (no row of the code names any tier), only when no name/note/id clue exists for the tier,
    // and only when exactly one row of this product has this price and currency. Never for rows that name tiers, so those behave as before.
    const plain = !recognisable;
    for (const item of found) {
      const link = item.group.line.link!;
      if (plain && item.hits.length === 0 && item.group.source.price !== null) {
        const same = item.group.own.filter((target) => target.currency === item.group.source.currency && target.price === item.group.source.price);
        if (same.length === 1 && link.rows.some((row) => row.targetKey === same[0].key && !row.taken)) { link.suggestion = { targetKey: same[0].key, reason: "price" }; continue; }
      }
      if (item.pick) link.suggestion = { targetKey: item.pick.target.key, reason: item.pick.reason };
      const tier = link.tierLabel.trim().toLowerCase();
      if (recognisable && !item.group.own.some((target) => clueFor(target, tier, notes.get(target.key) ?? "") !== null)) link.notInProduct = true;
    }
  }
}

/** Row notes for suggestions: the stored specification (or notes) of the row a target points to, found by its group and row ids. Read only. */
export function targetRowNotes(templates: Array<Record<string, unknown>>, targets: PriceTarget[]): Map<string, string> {
  const byId = new Map(templates.map((template) => [String(template.id), template]));
  const notes = new Map<string, string>();
  for (const target of targets) {
    const roots = byId.get(target.template_id)?.[target.architecture];
    if (!Array.isArray(roots)) continue;
    const group = roots.find((root) => root && typeof root === "object" && (root as { id?: unknown }).id === target.group_id) as { items?: unknown } | undefined;
    const row = (Array.isArray(group?.items) ? group.items : []).find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === target.row_id) as Record<string, unknown> | undefined;
    const text = [row?.specification, row?.notes].filter((value): value is string => typeof value === "string" && value.trim() !== "").join(" ");
    if (text) notes.set(target.key, text);
  }
  return notes;
}

/** In-memory preview for a shared mapping: the real matcher with the proposed shared binding added. Never writes. */
export function previewShared(source: SourceIdentity, targets: PriceMatch["targets"]): LineShared {
  const proposed: DurableBinding = { id: "preview", code: source.code, price_field: source.price_field, source_dimension: source.dimension, target_keys: targets.map((item) => item.key), kind: "shared", confirmed: true };
  const [result] = matchSupplierPrices([source], targets, [], [proposed]);
  return {
    code: source.code, priceField: source.price_field, sourceDimension: source.dimension, tierLabel: plainSupplierDimension(source.raw_dimension ?? source.dimension), preview: states[result.classification] ?? "ambiguous",
    targets: targets.map((item) => ({ key: item.key, templateId: item.template_id, templateName: item.template_name, label: item.label, ...(item.dimension_label ? { dimensionLabel: item.dimension_label } : {}), pricingVersion: item.pricing_version, price: item.price, currency: item.currency })),
  };
}

/** In-memory preview: the real matcher with the proposed alias added. Never writes. */
export function previewMapping(source: SourceIdentity, target: PriceMatch["targets"][number]): LineMapping {
  const proposed: DurableBinding = { id: "preview", code: source.code, price_field: source.price_field, source_dimension: source.dimension, target_keys: [target.key], kind: "alias", confirmed: true };
  const [result] = matchSupplierPrices([source], [target], [], [proposed]);
  return { code: source.code, priceField: source.price_field, sourceDimension: source.dimension, tierLabel: source.raw_dimension ?? source.dimension, targetKey: target.key, pricingVersion: target.pricing_version, targetPrice: target.price, targetCurrency: target.currency, preview: states[result.classification] ?? "ambiguous" };
}

export type PriceLineFilter = "all" | "attention" | "same";
/** `same` includes confirmed shared lines; `shared` says how many of them there are (for the small note under the Same tile). */
export type PriceLineSummary = { same: number; changed: number; needsMapping: number; other: number; shared: number };
/** A line that is fine as it is: the same price, or a confirmed shared mapping. */
const isOk = (line: PriceLine) => line.state === "same" || line.state === "shared" || line.state === "covered";

export function summarizePriceLines(lines: PriceLine[]): PriceLineSummary {
  const summary: PriceLineSummary = { same: 0, changed: 0, needsMapping: 0, other: 0, shared: 0 };
  for (const line of lines) {
    if (line.link?.notInProduct) continue; // shown in its own collapsed group, not counted as needing attention
    if (isOk(line)) { summary.same++; if (line.state === "shared") summary.shared++; }
    else if (line.state === "changed") summary.changed++;
    else if (line.state === "needs_mapping") summary.needsMapping++;
    else summary.other++;
  }
  return summary;
}

const attentionOrder: Record<PriceLineState, number> = { needs_mapping: 0, changed: 1, ambiguous: 2, not_in_supplier_list: 3, shared: 5, same: 5, covered: 5 };
/** Lines that need a look first, then the rest. The incoming (code) order is kept inside each group. */
export function filterAndOrderPriceLines(lines: PriceLine[], filter: PriceLineFilter): PriceLine[] {
  const kept = lines.filter((line) => !line.link?.notInProduct).filter((line) => filter === "all" || (filter === "same" ? isOk(line) : !isOk(line)));
  return kept.map((line, index) => ({ line, index })).sort((a, b) => attentionOrder[a.line.state] - attentionOrder[b.line.state] || a.index - b.index).map((item) => item.line);
}

/** Supplier lines no row of this product looks like. Display only: nothing is saved. */
export const notInProductLines = (lines: PriceLine[]) => lines.filter((line) => line.link?.notInProduct);

/**
 * One supplier line read by several product rows is shown as ONE group, not as one problem per row. Presentation only: it reshapes the lines
 * that are already built, never changes them, and the state counts still come from the lines. "unmapped" is the Unclear-match case that can be
 * mapped as shared (all lines carry the same LineShared, i.e. the matcher's targets); "mapped" is a saved shared binding read by 2 or more lines.
 */
export type PriceLineGroup = { key: string; kind: "unmapped" | "mapped"; lines: PriceLine[]; /** The line the existing save/remove path is started from. */ first: PriceLine };
export const isPriceLineGroup = (item: PriceLine | PriceLineGroup): item is PriceLineGroup => "lines" in item;
export function groupSharedLines(lines: PriceLine[]): Array<PriceLine | PriceLineGroup> {
  const groups = new Map<string, PriceLineGroup>();
  const out: Array<PriceLine | PriceLineGroup> = [];
  const mappedCount = new Map<string, number>();
  const mappedKey = (line: PriceLine) => line.state === "shared" && line.binding?.kind === "shared" ? `mapped|${line.binding.id}` : null;
  for (const line of lines) { const key = mappedKey(line); if (key) mappedCount.set(key, (mappedCount.get(key) ?? 0) + 1); }
  for (const line of lines) {
    const mapped = mappedKey(line);
    const key = line.shared ? `unmapped|${JSON.stringify([line.shared.code, line.shared.priceField, line.shared.sourceDimension, line.shared.targets.map((item) => item.key).sort()])}` : mapped && (mappedCount.get(mapped) ?? 0) >= 2 ? mapped : null;
    if (!key) { out.push(line); continue; }
    const found = groups.get(key);
    if (found) { found.lines.push(line); continue; }
    const group: PriceLineGroup = { key, kind: line.shared ? "unmapped" : "mapped", lines: [line], first: line };
    groups.set(key, group); out.push(group);
  }
  return out;
}
