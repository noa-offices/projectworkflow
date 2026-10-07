import type { DimensionRule, DurableBinding, PriceMatch, PriceTarget, SourceIdentity } from "./supplier-price-contracts";

/** Comparison identity only: whitespace is formatting ("1AF 044" and "1AF044" are the same article). Stored and display codes are never changed. */
export const comparisonCode = (code: string) => code.replace(/\s+/g, "");

export function sharedBaselineDrift(targets: PriceTarget[]) {
  return targets.some((target) => target.price === null) || new Set(targets.map((target) => JSON.stringify([target.price, target.currency, target.dimension, target.price_field]))).size !== 1;
}
// Retained physical finishes are evidence, not automatically a price tier.
const isFinishTier = (source: SourceIdentity) => source.finishes.length > 0 && source.dimension !== (source.raw_dimension ?? source.dimension);
function applicableRules(source: SourceIdentity, target: PriceTarget, rules: DimensionRule[]) {
  const finishTier = isFinishTier(source);
  // A finish-set rule resolves a price tier; a target with no dimension has no tier to resolve, so it must not remap the source.
  return rules.filter((rule) => rule.brand_id === target.brand_id && (!rule.finish_codes.length || Boolean(target.dimension)) && (!rule.template_id || rule.template_id === target.template_id) && (!rule.group_id || rule.group_id === target.group_id) && (!rule.raw_labels.length || rule.raw_labels.includes(source.raw_dimension ?? source.dimension)) && (rule.finish_codes.length ? source.finishes.length > 0 && source.finishes.every((finish) => rule.finish_codes.includes(finish)) : !finishTier) && (rule.raw_labels.length > 0 || rule.finish_codes.length > 0));
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== "";
/**
 * Exact, unsaved match: only when no explicit vocabulary rule applies, the Supplier tier equals the target's internal dimension code or its
 * displayed pricing-column label (trim + case only; no fuzzy or partial matching). It never creates a rule and never renames anything.
 */
function directTierMatch(source: SourceIdentity, target: PriceTarget, rules: DimensionRule[]) {
  if (isFinishTier(source) || applicableRules(source, target, rules).length) return false;
  const tier = source.raw_dimension ?? source.dimension;
  return same(tier, target.dimension) || same(tier, target.dimension_label ?? "");
}
function mappedDimension(source: SourceIdentity, target: PriceTarget, rules: DimensionRule[]): string | null {
  if (!source.dimension && !source.finishes.length) return "";
  const matching = applicableRules(source, target, rules);
  if (!matching.length && !source.dimension) return "";
  const specificity = Math.max(-1, ...matching.map((rule) => (rule.template_id ? 2 : 0) + (rule.group_id ? 1 : 0)));
  const dimensions = new Set(matching.filter((rule) => (rule.template_id ? 2 : 0) + (rule.group_id ? 1 : 0) === specificity).map((rule) => rule.dimension_code));
  return dimensions.size === 1 ? [...dimensions][0] : null;
}
export function matchSupplierPrices(sources: SourceIdentity[], targets: PriceTarget[], rules: DimensionRule[] = [], bindings: DurableBinding[] = []): PriceMatch[] {
  const index = new Map<string, PriceTarget[]>(); const byKey = new Map(targets.map((target) => [target.key, target]));
  for (const target of targets) { const key = JSON.stringify([comparisonCode(target.code), target.price_field]); const bucket = index.get(key) ?? []; bucket.push(target); index.set(key, bucket); }
  // Bindings whose codes differ only by whitespace would be two answers for one identity: neither is used, so the row stays unresolved.
  const bindingGroups = new Map<string, DurableBinding[]>();
  for (const binding of bindings.filter((item) => item.confirmed)) { const key = JSON.stringify([comparisonCode(binding.code), binding.price_field, binding.source_dimension]); bindingGroups.set(key, [...(bindingGroups.get(key) ?? []), binding]); }
  const bindingIndex = new Map([...bindingGroups].filter(([, group]) => group.length === 1).map(([key, group]) => [key, group[0]]));
  const represented = new Set<string>();
  const matches = sources.map<PriceMatch>((source) => {
    const base = { key: source.key, source, targets: [] as PriceTarget[], candidate_shared: false };
    const candidates = index.get(JSON.stringify([comparisonCode(source.code), source.price_field])) ?? [];
    // Missing means no Supplier identity exists for the code: any identity with this code represents its Products, whatever mapping remains unresolved.
    candidates.forEach((target) => represented.add(target.key));
    if (source.issues.length || source.price === null) return { ...base, classification: "invalid_source" };
    const binding = bindingIndex.get(JSON.stringify([comparisonCode(source.code), source.price_field, source.dimension]));
    let found: PriceTarget[];
    if (binding) {
      found = binding.target_keys.flatMap((key) => byKey.has(key) ? [byKey.get(key)!] : []);
      if (found.length !== binding.target_keys.length || !found.length) return { ...base, classification: "ambiguous", targets: found };
    } else {
      const direct = new Set<string>();
      found = candidates.filter((target) => {
        if (mappedDimension(source, target, rules) === target.dimension) return true;
        if (!directTierMatch(source, target, rules)) return false;
        direct.add(target.key); return true;
      });
      // Two columns of one row that read the same to the Supplier tier: never pick one for the user.
      if (found.length > 1 && found.every((target) => direct.has(target.key)) && new Set(found.map((target) => JSON.stringify([target.template_id, target.group_id, target.row_id, target.physical_field]))).size === 1) return { ...base, classification: "ambiguous", targets: found };
      if (!found.length && candidates.length && (source.dimension || candidates.some((target) => target.dimension))) {
        // The article exists in the Supplier source and only needs a mapping; its Products must not also be reported as missing from it.
        candidates.forEach((target) => represented.add(target.key));
        return { ...base, classification: "needs_dimension_mapping", targets: candidates };
      }
    }
    found.forEach((target) => represented.add(target.key));
    if (!found.length) return { ...base, classification: source.companion_notes?.length ? "referenced_companion" : "unmatched" };
    if (found.length > 1) {
      const drift = sharedBaselineDrift(found);
      const comparison = drift || found[0].currency !== source.currency ? "changed" : source.price === found[0].price ? "unchanged" : source.price > found[0].price! ? "increased" : "decreased";
      return { ...base, targets: found, comparison, classification: drift ? "baseline_drift" : binding?.kind === "shared" ? "shared" : "ambiguous", candidate_shared: !drift && found.every((target) => target.currency === source.currency) };
    }
    const target = found[0];
    const comparison = target.currency !== source.currency || target.price === null ? "changed" : source.price === target.price ? "unchanged" : source.price > target.price ? "increased" : "decreased";
    return { ...base, targets: found, comparison, classification: comparison };
  });
  for (const target of targets) if (!represented.has(target.key)) matches.push({ key: `target:${target.key}`, source: null, targets: [target], classification: "target_not_represented", candidate_shared: false });
  return matches;
}
export function templateReviewUnits(matches: PriceMatch[], templateIds?: string[]) {
  const units = new Map<string, { template_id: string; template_name: string; matched: number; changed: number; unchanged: number; unresolved: number; state: string }>();
  for (const match of matches) for (const id of new Set(match.targets.map((target) => target.template_id))) {
    if (templateIds && !templateIds.includes(id)) continue;
    const target = match.targets.find((target) => target.template_id === id)!;
    const unit = units.get(id) ?? { template_id: id, template_name: target.template_name, matched: 0, changed: 0, unchanged: 0, unresolved: 0, state: "NOT_REVIEWED" };
    if (["increased", "decreased", "changed", "unchanged", "shared"].includes(match.classification)) {
      unit.matched++; if (match.comparison === "unchanged" || match.classification === "unchanged") unit.unchanged++; else unit.changed++;
    } else unit.unresolved++;
    unit.state = unit.unresolved ? "NEEDS_MAPPING" : "READY"; units.set(id, unit);
  }
  return [...units.values()];
}
