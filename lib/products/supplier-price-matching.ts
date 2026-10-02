import type { DimensionRule, DurableBinding, PriceMatch, PriceTarget, SourceIdentity } from "./supplier-price-contracts";

export function sharedBaselineDrift(targets: PriceTarget[]) {
  return targets.some((target) => target.price === null) || new Set(targets.map((target) => JSON.stringify([target.price, target.currency, target.dimension, target.price_field]))).size !== 1;
}
function mappedDimension(source: SourceIdentity, target: PriceTarget, rules: DimensionRule[]): string | null {
  if (!source.dimension) return "";
  const matching = rules.filter((rule) => rule.brand_id === target.brand_id && (!rule.template_id || rule.template_id === target.template_id) && (!rule.group_id || rule.group_id === target.group_id) && (!rule.raw_labels.length || rule.raw_labels.includes(source.raw_dimension ?? source.dimension)) && (rule.finish_codes.length ? source.finishes.length > 0 && source.finishes.every((finish) => rule.finish_codes.includes(finish)) : !source.finishes.length) && (rule.raw_labels.length > 0 || rule.finish_codes.length > 0));
  const specificity = Math.max(-1, ...matching.map((rule) => (rule.template_id ? 2 : 0) + (rule.group_id ? 1 : 0)));
  const dimensions = new Set(matching.filter((rule) => (rule.template_id ? 2 : 0) + (rule.group_id ? 1 : 0) === specificity).map((rule) => rule.dimension_code));
  return dimensions.size === 1 ? [...dimensions][0] : null;
}
export function matchSupplierPrices(sources: SourceIdentity[], targets: PriceTarget[], rules: DimensionRule[] = [], bindings: DurableBinding[] = []): PriceMatch[] {
  const index = new Map<string, PriceTarget[]>(); const byKey = new Map(targets.map((target) => [target.key, target]));
  for (const target of targets) { const key = JSON.stringify([target.code, target.price_field]); const bucket = index.get(key) ?? []; bucket.push(target); index.set(key, bucket); }
  const bindingIndex = new Map(bindings.filter((binding) => binding.confirmed).map((binding) => [JSON.stringify([binding.code, binding.price_field, binding.source_dimension]), binding]));
  const represented = new Set<string>();
  const matches = sources.map<PriceMatch>((source) => {
    const base = { key: source.key, source, targets: [] as PriceTarget[], candidate_shared: false };
    if (source.issues.length || source.price === null) return { ...base, classification: "invalid_source" };
    const binding = bindingIndex.get(JSON.stringify([source.code, source.price_field, source.dimension]));
    const candidates = index.get(JSON.stringify([source.code, source.price_field])) ?? [];
    let found: PriceTarget[];
    if (binding) {
      found = binding.target_keys.flatMap((key) => byKey.has(key) ? [byKey.get(key)!] : []);
      if (found.length !== binding.target_keys.length || !found.length) return { ...base, classification: "ambiguous", targets: found };
    } else {
      found = candidates.filter((target) => mappedDimension(source, target, rules) === target.dimension);
      if (!found.length && candidates.length && (source.dimension || candidates.some((target) => target.dimension))) return { ...base, classification: "needs_dimension_mapping", targets: candidates };
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
