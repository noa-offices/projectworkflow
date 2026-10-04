import type { SupabaseClient } from "@supabase/supabase-js";
import type { DimensionRule, DurableBinding, PriceMatch, PriceTarget, ProductPriceInput, ReviewBatch, SourceIdentity, SourceVersion } from "./supplier-price-contracts";
import { expectedPricingVersion, pricingConflictMessage } from "./pricing-write-version";
import { brandPriceTargets } from "./supplier-price-targets";
import { matchSupplierPrices } from "./supplier-price-matching";

export async function supplierRows<T>(client: SupabaseClient, table: string, columns: string, filters: Record<string, string | boolean> = {}, order = "id"): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    let query = client.from(table).select(columns).order(order, { ascending: true }).range(from, from + 499);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const { data, error } = await query;
    if (error) throw Error(error.message);
    const page = (data ?? []) as T[]; rows.push(...page);
    if (page.length < 500) return rows;
  }
}
export async function supplierWrite(client: SupabaseClient, operation: string, payload: Record<string, unknown>) {
  const { data, error } = await client.rpc("supplier_price_review_write", { p_operation: operation, p_payload: payload });
  if (error) throw Error(error.message);
  return data as { id: string; reused?: boolean };
}
export async function supplierBrandTargets(client: SupabaseClient, brandId: string) {
  const [templates, components] = await Promise.all([
    supplierRows<ProductPriceInput>(client, "product_templates", "id,brand_id,template_name,item_code,currency,default_unit_price,pricing_version,variant_pricing,category_pricing,desking_size_pricing,accessory_pricing", { brand_id: brandId, is_active: true }),
    supplierRows<Record<string, unknown>>(client, "product_components", "id,template_id,component_code,component_name,currency,unit_price,is_active,product_templates!inner(brand_id)", { "product_templates.brand_id": brandId, is_active: true }),
  ]);
  return { templates, targets: brandPriceTargets(templates, components) };
}
export async function supplierSource(client: SupabaseClient, sourceId: string) {
  const { data, error } = await client.from("supplier_source_versions").select("*").eq("id", sourceId).single<SourceVersion>();
  if (error || !data) throw Error(error?.message ?? "Source unavailable.");
  return data;
}
export async function supplierBrandMatches(client: SupabaseClient, sourceId: string) {
  const source = await supplierSource(client, sourceId);
  if (source.status !== "imported") throw Error("Matching refuses an incomplete or archived source.");
  const [{ targets, templates }, identities, rules, bindings] = await Promise.all([
    supplierBrandTargets(client, source.brand_id),
    supplierRows<{ data: SourceIdentity }>(client, "supplier_source_identities", "key,data", { source_id: sourceId }, "key"),
    supplierRows<DimensionRule>(client, "supplier_dimension_vocabulary", "*", { brand_id: source.brand_id, is_active: true }),
    supplierRows<DurableBinding>(client, "supplier_price_bindings", "*", { brand_id: source.brand_id }),
  ]);
  return { source, templates, targets, matches: matchSupplierPrices(identities.map((identity) => identity.data), targets, rules, bindings) };
}
export function supplierMatchChunks(matches: PriceMatch[]) {
  const chunks: PriceMatch[][] = []; let chunk: PriceMatch[] = []; let size = 2;
  for (const match of matches) {
    const bytes = new TextEncoder().encode(JSON.stringify(match)).length + 1;
    if (bytes > 600_000) throw Error("A match has too many targets/provenance rows for a bounded chunk. Review source scope.");
    if (chunk.length && (chunk.length >= 500 || size + bytes > 600_000)) { chunks.push(chunk); chunk = []; size = 2; }
    chunk.push(match); size += bytes;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

const freshSupplierComparison = "This Product Template changed. Build a fresh Supplier comparison before applying.";
type SupplierApplyBatch = ReviewBatch & { brand_price_list_update_id: string | null };
type ReviewedMatch = { key: string; data: PriceMatch; supplier_price_decisions: { decision: PriceMatch["decision"] } | null };

function supplierDetailPayload(template: ProductPriceInput, target: PriceTarget, price: number) {
  const architecture = target.architecture;
  if (!["variant_pricing", "category_pricing", "desking_size_pricing", "accessory_pricing"].includes(architecture)
    || !["prices", "price", "default_price", "additional_price"].includes(target.physical_field)
    || !Array.isArray(template[architecture])) throw Error("Unsupported Supplier pricing target.");
  const roots = structuredClone(template[architecture]) as Array<Record<string, unknown>>;
  const rows = target.group_id === `legacy-flat:${architecture}`
    ? roots.filter((root) => !Array.isArray(root.items) && root.id === target.row_id)
    : roots.filter((root) => root.id === target.group_id && Array.isArray(root.items))
      .flatMap((root) => root.items as Array<Record<string, unknown>>).filter((row) => row.id === target.row_id);
  if (rows.length !== 1) throw Error(freshSupplierComparison);
  const row = rows[0];
  if (target.physical_field === "prices") {
    const prices = row.prices as Record<string, unknown> | undefined;
    if (!target.column_id || !prices || !Object.hasOwn(prices, target.column_id) || prices[target.column_id] !== target.price) throw Error(freshSupplierComparison);
    prices[target.column_id] = price;
  } else {
    if (target.column_id || row[target.physical_field] !== target.price) throw Error(freshSupplierComparison);
    row[target.physical_field] = price;
  }
  return { [architecture]: roots };
}

/** Builds one writer operation (mode, payload, history) for a target against the given Template copies. */
function supplierTargetWrite(current: PriceTarget, templates: Map<string, ProductPriceInput>, price: number, currency: string, base: Record<string, unknown>) {
  if (current.architecture === "simple" && current.physical_field === "default_unit_price") {
    return { mode: "supplier_default" as const, payload: { default_unit_price: price, currency } as Record<string, unknown>, history: base };
  }
  let payload: Record<string, unknown>;
  if (current.architecture === "product_components") {
    if (current.physical_field !== "unit_price") throw Error("Unsupported Supplier component target.");
    payload = { unit_price: price, currency };
  } else {
    const template = templates.get(current.template_id);
    if (!template) throw Error(freshSupplierComparison);
    payload = supplierDetailPayload(template, current, price);
  }
  return { mode: "detail" as const, payload, history: { ...base, source_table: current.architecture === "product_components" ? "product_components" : `product_templates.${current.architecture}`,
    source_record_id: current.row_id, price_field: current.physical_field === "prices" ? `prices.${current.column_id}` : current.physical_field,
    old_price: current.price, new_price: price, currency } };
}

/** Called only after the server action's existing approver guard. No browser baseline is accepted. */
export async function supplierApplyReviewedPrice(client: SupabaseClient, batchId: string, matchKey: string) {
  if (typeof batchId !== "string" || !batchId || typeof matchKey !== "string" || !matchKey) throw Error("Supplier batch and match required.");
  const batchResult = await client.from("supplier_price_batches").select("*").eq("id", batchId).single<SupplierApplyBatch>();
  if (batchResult.error || !batchResult.data) throw Error(batchResult.error?.message ?? "Supplier batch unavailable.");
  const batch = batchResult.data;
  if (batch.status !== "review") throw Error("Supplier batch must be in review before applying.");
  const source = await supplierSource(client, batch.source_id);
  if (source.id !== batch.source_id || source.brand_id !== batch.brand_id) throw Error("Supplier source does not belong to this batch and Brand.");
  if (source.status !== "imported") throw Error("Supplier source must be imported before applying.");
  const matchResult = await client.from("supplier_price_matches").select("key,data,supplier_price_decisions(decision)")
    .eq("batch_id", batch.id).eq("key", matchKey).single<ReviewedMatch>();
  if (matchResult.error || !matchResult.data) throw Error(matchResult.error?.message ?? "Supplier match unavailable in this batch.");
  const stored = matchResult.data, match = stored.data;
  if (stored.key !== matchKey || match.key !== matchKey) throw Error("Supplier match does not belong to this batch.");
  const shared = match.classification === "shared";
  if (!shared && match.targets.length !== 1) throw Error("Phase 2A does not support shared or multiple-target Apply.");
  if (shared ? match.targets.length < 2 : !["increased", "decreased", "changed"].includes(match.classification)) throw Error("Only changed Supplier prices may be applied.");
  if (stored.supplier_price_decisions?.decision !== "reviewed") throw Error("Review this Supplier price before applying.");
  if (!match.source || match.source.price === null || !Number.isFinite(match.source.price) || match.source.price < 0 || match.source.issues.length) throw Error("Supplier source price is invalid.");
  // Reload the identity from this immutable source, rather than relying on a match's embedded price.
  const identityResult = await client.from("supplier_source_identities").select("data").eq("source_id", source.id).eq("key", match.source.key).single<{ data: SourceIdentity }>();
  if (identityResult.error || !identityResult.data) throw Error(identityResult.error?.message ?? "Supplier price unavailable in this source.");
  const identity = identityResult.data.data;
  if (["key", "code", "price_field", "price", "currency"].some((field) => identity[field as keyof SourceIdentity] !== match.source![field as keyof SourceIdentity])
    || JSON.stringify(identity.row_keys) !== JSON.stringify(match.source.row_keys) || identity.issues.length) throw Error("Supplier match source does not match this source version.");
  const brandResult = await client.from("brands").select("id,stored_price_basis").eq("id", batch.brand_id).single<{ id: string; stored_price_basis: string }>();
  if (brandResult.error || !brandResult.data || brandResult.data.id !== batch.brand_id) throw Error(brandResult.error?.message ?? "Supplier Brand unavailable.");
  const brand = brandResult.data;
  if (!["list", "net"].includes(source.basis) || !["list", "net"].includes(brand.stored_price_basis)) throw Error("Supplier price basis must be confirmed before applying.");
  if (source.basis !== brand.stored_price_basis) throw Error("Supplier price basis does not match the Brand stored price basis.");
  const baselines = match.targets;
  if (baselines.some((baseline) => baseline.brand_id !== batch.brand_id)) throw Error("Supplier target does not belong to this Brand.");
  if (!["AED", "EUR", "USD"].includes(source.currency) || identity.currency !== source.currency) throw Error("Unsupported Supplier currency. Use AED, EUR, or USD.");
  if (baselines.some((baseline) => source.currency !== baseline.currency)) throw Error("Supplier and Product currencies must match before applying.");
  if (new Set(baselines.map((baseline) => baseline.key)).size !== baselines.length) throw Error("Supplier shared targets must be unique.");
  if (shared) {
    // The durable binding, not the review snapshot, is the authority for the shared target set.
    const bindings = await supplierRows<DurableBinding>(client, "supplier_price_bindings", "*", { brand_id: batch.brand_id, code: identity.code, price_field: identity.price_field, source_dimension: identity.dimension });
    const binding = bindings.length === 1 ? bindings[0] : null;
    if (!binding || binding.kind !== "shared" || binding.confirmed !== true) throw Error("A confirmed durable shared binding is required before shared Apply.");
    const bound = [...binding.target_keys].sort(), reviewed = baselines.map((baseline) => baseline.key).sort();
    if (new Set(bound).size !== bound.length || bound.length !== reviewed.length || bound.some((key, index) => key !== reviewed[index])) throw Error("The durable shared binding no longer matches the reviewed targets. Build a fresh Supplier comparison.");
  }
  const { targets, templates } = await supplierBrandTargets(client, batch.brand_id);
  const baselineFields = ["key", "brand_id", "template_id", "pricing_version", "price", "currency", "raw_code", "code", "architecture", "group_id", "row_id", "column_id", "physical_field", "price_field", "dimension"] as const;
  const currents = baselines.map((baseline) => {
    const current = targets.find((target) => target.key === baseline.key);
    if (!current || baselineFields.some((field) => current[field] !== baseline[field]) || current.price === identity.price || expectedPricingVersion(current.pricing_version) === null) throw Error(freshSupplierComparison);
    return current;
  });
  const history = { brand_price_list_update_id: batch.brand_price_list_update_id ?? null, effective_from: source.effective_from ?? null,
    note: `Supplier source: ${source.title}; batch: ${batch.id}; match: ${match.key}${shared ? "; shared apply" : ""}` };
  // Same-Template detail targets accumulate into one working copy so each later payload includes earlier changes.
  const working = new Map(templates.map((template) => [template.id, structuredClone(template)]));
  const operations = currents.map((current) => {
    const write = supplierTargetWrite(current, working, identity.price!, source.currency, history);
    if (write.mode === "detail" && current.architecture !== "product_components") working.get(current.template_id)![current.architecture] = write.payload[current.architecture];
    return { template_id: current.template_id, expected_version: current.pricing_version, mode: write.mode, payload: write.payload, history: write.history };
  });
  if (shared) {
    const { data, error } = await client.rpc("apply_supplier_shared_price_at_versions", { p_operations: operations });
    if (error) throw Error(error.message.includes(pricingConflictMessage) ? freshSupplierComparison : error.message);
    return { pricing_version: null, message: `Shared price applied to ${(data as { applied_count: number }).applied_count} targets. Build a fresh comparison to continue reviewing these targets.` };
  }
  const [operation] = operations;
  const { data, error } = await client.rpc("write_product_price_with_history_at_version", {
    p_template_id: operation.template_id, p_expected_version: operation.expected_version, p_mode: operation.mode, p_payload: operation.payload, p_history: operation.history,
  });
  if (error) throw Error(error.message.includes(pricingConflictMessage) ? freshSupplierComparison : error.message);
  return { pricing_version: data, message: "Price applied. Build a fresh comparison to continue reviewing this target." };
}

const freshBeforeConfirming = "This Product Template changed. Build a fresh Supplier comparison before confirming.";
/** Called only after the server action's approver guard. Persists a durable decision only; never writes Product pricing. */
export async function supplierConfirmUnchangedPrice(client: SupabaseClient, batchId: string, matchKey: string) {
  if (typeof batchId !== "string" || !batchId || typeof matchKey !== "string" || !matchKey) throw Error("Supplier batch and match required.");
  const batchResult = await client.from("supplier_price_batches").select("*").eq("id", batchId).single<ReviewBatch>();
  if (batchResult.error || !batchResult.data) throw Error(batchResult.error?.message ?? "Supplier batch unavailable.");
  const batch = batchResult.data;
  if (batch.status !== "review") throw Error("Supplier batch must be in review before confirming.");
  const source = await supplierSource(client, batch.source_id);
  if (source.id !== batch.source_id || source.brand_id !== batch.brand_id) throw Error("Supplier source does not belong to this batch and Brand.");
  if (source.status !== "imported") throw Error("Supplier source must be imported before confirming.");
  const matchResult = await client.from("supplier_price_matches").select("key,data,supplier_price_decisions(decision,note)")
    .eq("batch_id", batch.id).eq("key", matchKey).single<{ key: string; data: PriceMatch; supplier_price_decisions: { decision: string; note: string } | null }>();
  if (matchResult.error || !matchResult.data) throw Error(matchResult.error?.message ?? "Supplier match unavailable in this batch.");
  const stored = matchResult.data, match = stored.data;
  if (stored.key !== matchKey || match.key !== matchKey) throw Error("Supplier match does not belong to this batch.");
  if (match.classification !== "unchanged") throw Error("Only unchanged Supplier prices can be confirmed unchanged.");
  if (match.targets.length !== 1) throw Error("Confirm unchanged supports exactly one target.");
  if (!match.source || match.source.price === null || !Number.isFinite(match.source.price) || match.source.price < 0 || match.source.issues.length) throw Error("Supplier source price is invalid.");
  const identityResult = await client.from("supplier_source_identities").select("data").eq("source_id", source.id).eq("key", match.source.key).single<{ data: SourceIdentity }>();
  if (identityResult.error || !identityResult.data) throw Error(identityResult.error?.message ?? "Supplier price unavailable in this source.");
  const identity = identityResult.data.data;
  if (["key", "code", "price_field", "price", "currency"].some((field) => identity[field as keyof SourceIdentity] !== match.source![field as keyof SourceIdentity]) || identity.issues.length) throw Error("Supplier match source does not match this source version.");
  const brandResult = await client.from("brands").select("id,stored_price_basis").eq("id", batch.brand_id).single<{ id: string; stored_price_basis: string }>();
  if (brandResult.error || !brandResult.data || brandResult.data.id !== batch.brand_id) throw Error(brandResult.error?.message ?? "Supplier Brand unavailable.");
  if (!["list", "net"].includes(source.basis) || !["list", "net"].includes(brandResult.data.stored_price_basis)) throw Error("Supplier price basis must be confirmed before confirming.");
  if (source.basis !== brandResult.data.stored_price_basis) throw Error("Supplier price basis does not match the Brand stored price basis.");
  const baseline = match.targets[0];
  if (baseline.brand_id !== batch.brand_id) throw Error("Supplier target does not belong to this Brand.");
  if (!["AED", "EUR", "USD"].includes(source.currency) || identity.currency !== source.currency) throw Error("Unsupported Supplier currency. Use AED, EUR, or USD.");
  if (source.currency !== baseline.currency) throw Error("Supplier and Product currencies must match before confirming.");
  const { targets } = await supplierBrandTargets(client, batch.brand_id);
  const current = targets.find((target) => target.key === baseline.key);
  const baselineFields = ["key", "brand_id", "template_id", "pricing_version", "price", "currency", "raw_code", "code", "architecture", "group_id", "row_id", "column_id", "physical_field", "price_field", "dimension"] as const;
  // Another price row in the same Template may have advanced pricing_version; only this exact target must be intact and still equal.
  if (!current || baselineFields.some((field) => field !== "pricing_version" && current[field] !== baseline[field]) || current.price !== identity.price || current.currency !== source.currency) throw Error(freshBeforeConfirming);
  // Same decision path and upsert as every review decision; a repeat rewrites the one row. The reviewer's note is kept.
  await supplierWrite(client, "decision", { batch_id: batch.id, key: matchKey, decision: "confirmed_unchanged", note: stored.supplier_price_decisions?.note ?? "", proposed_target_keys: [] });
  return { message: "Unchanged price confirmed." };
}

export type SupplierCompletionReadiness = {
  scope: string; status: string; issue: string; ready: boolean; blocking: number; checkedTemplates: number; excludedTemplates: number;
  counts: Record<SupplierCompletionCount, number>; templateVersions: Record<string, string>;
};
export type SupplierCompletionCount = "resolved" | "unresolved_changed" | "unresolved_shared" | "unchanged_not_confirmed" | "changed_after_review" | "skipped" | "rejected" | "mapping_proposed"
  | "ambiguous" | "needs_dimension_mapping" | "baseline_drift" | "invalid_source" | "target_not_represented" | "targets_added_after_comparison" | "excluded_from_source" | "unmatched" | "referenced_companion";
const informationalCounts = new Set<SupplierCompletionCount>(["resolved", "excluded_from_source", "unmatched", "referenced_companion"]);

/** Read-only preview of the locked Complete-review resolution matrix. The completion RPC re-enforces every rule. */
export async function supplierCompletionReadiness(client: SupabaseClient, batchId: string): Promise<SupplierCompletionReadiness> {
  if (typeof batchId !== "string" || !batchId) throw Error("Supplier batch required.");
  const batchResult = await client.from("supplier_price_batches").select("*").eq("id", batchId).single<ReviewBatch>();
  if (batchResult.error || !batchResult.data) throw Error(batchResult.error?.message ?? "Supplier batch unavailable.");
  const batch = batchResult.data;
  const counts = Object.fromEntries(["resolved", "unresolved_changed", "unresolved_shared", "unchanged_not_confirmed", "changed_after_review", "skipped", "rejected", "mapping_proposed", "ambiguous", "needs_dimension_mapping", "baseline_drift", "invalid_source", "target_not_represented", "targets_added_after_comparison", "excluded_from_source", "unmatched", "referenced_companion"].map((key) => [key, 0])) as Record<SupplierCompletionCount, number>;
  const empty = { scope: batch.scope, status: batch.status, issue: "", ready: false, blocking: 0, checkedTemplates: 0, excludedTemplates: 0, counts, templateVersions: {} };
  if (batch.scope !== "complete" || batch.status !== "review") return empty;
  const source = await supplierSource(client, batch.source_id);
  const brandResult = await client.from("brands").select("id,stored_price_basis").eq("id", batch.brand_id).single<{ id: string; stored_price_basis: string }>();
  if (brandResult.error || !brandResult.data) throw Error(brandResult.error?.message ?? "Supplier Brand unavailable.");
  const brandBasis = brandResult.data.stored_price_basis;
  const issue = source.id !== batch.source_id || source.brand_id !== batch.brand_id ? "Supplier source does not belong to this batch and Brand."
    : source.status !== "imported" ? "Supplier source must be imported before completing."
    : !["list", "net"].includes(source.basis) || !["list", "net"].includes(brandBasis) ? "Supplier price basis must be confirmed before completing."
    : source.basis !== brandBasis ? "Supplier price basis does not match the Brand stored price basis." : "";
  if (issue) return { ...empty, issue };
  const [matches, decisions, { targets, templates }] = await Promise.all([
    supplierRows<{ key: string; data: PriceMatch }>(client, "supplier_price_matches", "key,data", { batch_id: batch.id }, "key"),
    supplierRows<{ key: string; decision: NonNullable<PriceMatch["decision"]> }>(client, "supplier_price_decisions", "key,decision", { batch_id: batch.id }, "key"),
    supplierBrandTargets(client, batch.brand_id),
  ]);
  const decided = new Map(decisions.map((row) => [row.key, row.decision]));
  const live = new Map(targets.map((target) => [target.key, target]));
  const reviewedKeys = new Set<string>(), covered = new Set<string>(), excluded = new Set<string>();
  const add = (key: SupplierCompletionCount) => { counts[key]++; };
  for (const { key, data: match } of matches) {
    match.targets.forEach((target) => reviewedKeys.add(target.key));
    const decision = decided.get(key);
    if (match.classification === "unmatched" || match.classification === "referenced_companion") { add(match.classification); continue; }
    if (decision === "skip") { add("skipped"); continue; }
    if (decision === "reject") { add("rejected"); continue; }
    if (decision === "mapping_proposed") { add("mapping_proposed"); continue; }
    if (match.classification === "target_not_represented") {
      if (decision === "excluded_from_source") { add("excluded_from_source"); match.targets.forEach((target) => excluded.add(target.template_id)); } else add("target_not_represented");
      continue;
    }
    if (!["increased", "decreased", "changed", "unchanged", "shared"].includes(match.classification)) { add(match.classification as SupplierCompletionCount); continue; }
    if (match.classification === "unchanged" && decision !== "confirmed_unchanged") { add("unchanged_not_confirmed"); continue; }
    const price = match.source?.price;
    const settled = price !== null && price !== undefined && match.targets.length > 0 && match.targets.every((target) => {
      const current = live.get(target.key);
      return current && current.price === price && current.currency === match.source!.currency && current.raw_code === target.raw_code;
    });
    if (settled) { add("resolved"); match.targets.forEach((target) => covered.add(target.template_id)); }
    else add(match.classification === "unchanged" ? "changed_after_review" : match.classification === "shared" ? "unresolved_shared" : "unresolved_changed");
  }
  // Complete coverage must account for every current target; new targets need a fresh comparison.
  counts.targets_added_after_comparison = targets.filter((target) => !reviewedKeys.has(target.key)).length;
  const blocking = Object.entries(counts).reduce((total, [key, value]) => informationalCounts.has(key as SupplierCompletionCount) ? total : total + value, 0);
  const versions = new Map(templates.map((template) => [template.id, String(template.pricing_version)]));
  const checked = [...covered].filter((id) => !excluded.has(id));
  return { ...empty, ready: blocking === 0, blocking, checkedTemplates: checked.length, excludedTemplates: excluded.size,
    templateVersions: Object.fromEntries(checked.flatMap((id) => versions.has(id) ? [[id, versions.get(id)!]] : [])) };
}

/** Called only after the server action's approver guard. One atomic RPC activates the baseline and marks checks. */
export async function supplierCompleteReview(client: SupabaseClient, batchId: string) {
  const readiness = await supplierCompletionReadiness(client, batchId);
  if (readiness.status === "completed") throw Error("This Supplier review is already completed.");
  if (readiness.scope !== "complete") throw Error("This review cannot activate a Brand-wide baseline because coverage is not Complete.");
  if (readiness.status !== "review") throw Error("Supplier batch must be in review before completing.");
  if (readiness.issue) throw Error(readiness.issue);
  if (!readiness.ready) throw Error(`Supplier review has ${readiness.blocking} unresolved rows. Resolve them before completing this price list.`);
  const { data, error } = await client.rpc("complete_supplier_price_review", { p_batch_id: batchId, p_template_versions: readiness.templateVersions });
  if (error) throw Error(error.message);
  const result = data as { price_list_update_id: string; title: string; baseline_date: string | null; checked_templates: number; excluded_templates: number };
  return { ...result, message: "Supplier price-list review completed and Brand baseline activated." };
}

/** Approver-only durable exclusion of a target missing from this source. Never writes Product data. */
export async function supplierExcludeTargetFromSource(client: SupabaseClient, batchId: string, matchKey: string, note: string) {
  if (typeof batchId !== "string" || !batchId || typeof matchKey !== "string" || !matchKey) throw Error("Supplier batch and match required.");
  const reason = typeof note === "string" ? note.trim() : "";
  if (!reason || reason.length > 4000) throw Error("A reason is required to exclude a target from this source.");
  const batchResult = await client.from("supplier_price_batches").select("*").eq("id", batchId).single<ReviewBatch>();
  if (batchResult.error || !batchResult.data) throw Error(batchResult.error?.message ?? "Supplier batch unavailable.");
  if (batchResult.data.status !== "review") throw Error("Supplier batch must be in review before excluding targets.");
  const matchResult = await client.from("supplier_price_matches").select("key,data").eq("batch_id", batchId).eq("key", matchKey).single<{ key: string; data: PriceMatch }>();
  if (matchResult.error || !matchResult.data) throw Error(matchResult.error?.message ?? "Supplier match unavailable in this batch.");
  if (matchResult.data.data.classification !== "target_not_represented") throw Error("Only a target missing from this source can be excluded.");
  await supplierWrite(client, "decision", { batch_id: batchId, key: matchKey, decision: "excluded_from_source", note: reason, proposed_target_keys: [] });
  return { message: "Target excluded from this source. It will remain Needs price check after completion." };
}

// ---- Phase 2E: Family Review. Friendly grouping and bounded bulk actions over the existing safe engines. ----
/** The transactional writer accepts at most 50 operations, so every bulk action uses the same bound. */
export const SUPPLIER_BULK_LIMIT = 50;
export type FamilySection = "changed" | "same" | "missing" | "attention";
export const familySections: FamilySection[] = ["changed", "same", "missing", "attention"];
const attentionIssues: Record<string, [string, string]> = {
  invalid_source: ["Source data problem", "Check the Supplier source row in Advanced Review"],
  needs_dimension_mapping: ["Size / option mapping required", "Map the size or option in Advanced Review"],
  ambiguous: ["More than one possible match", "Choose the correct Product price in Advanced Review"],
  shared: ["One Supplier item linked to multiple Product prices", "Use the shared price workflow in Advanced Review"],
  baseline_drift: ["Product changed after this review started", "Build a fresh comparison"],
  mapping_proposed: ["Mapping awaiting confirmation", "An approver confirms the mapping in Advanced Review"],
  skip: ["Skipped earlier", "Review details in Advanced Review"],
  reject: ["Rejected earlier", "Review details in Advanced Review"],
  changed_after: ["Product changed after this review started", "Build a fresh comparison"],
  multiple_targets: ["One Supplier item linked to multiple Product prices", "Use the shared price workflow in Advanced Review"],
};
const baselineKeys = ["key", "brand_id", "template_id", "pricing_version", "price", "currency", "raw_code", "code", "architecture", "group_id", "row_id", "column_id", "physical_field", "price_field", "dimension"] as const;
const attention = (kind: string) => ({ section: "attention" as FamilySection, done: false, issue: attentionIssues[kind]?.[0] ?? "Needs a technical check", action: attentionIssues[kind]?.[1] ?? "Review details in Advanced Review", kind });

/** Friendly, live-aware state of one comparison row. `section: null` rows (Supplier-only items) are not Product Family rows. */
export function familyRowState(match: PriceMatch, decision: string | undefined, live: Map<string, PriceTarget>): { section: FamilySection | null; done: boolean; issue: string; action: string; kind: string } {
  const none = { section: null, done: false, issue: "", action: "", kind: "" };
  if (match.classification === "unmatched" || match.classification === "referenced_companion") return none;
  if (decision === "skip" || decision === "reject" || decision === "mapping_proposed") return attention(decision);
  if (match.classification === "target_not_represented") return { section: "missing", done: decision === "excluded_from_source", issue: "", action: "", kind: "missing" };
  if (match.classification === "shared") {
    const price = match.source?.price;
    const applied = price !== null && price !== undefined && match.targets.length > 1 && match.targets.every((target) => live.get(target.key)?.price === price);
    return applied ? { ...attention("shared"), done: true } : attention("shared");
  }
  if (!["increased", "decreased", "changed", "unchanged"].includes(match.classification)) return attention(match.classification);
  if (match.targets.length !== 1 || !match.source || match.source.price === null) return attention("multiple_targets");
  const target = match.targets[0], current = live.get(target.key), price = match.source.price;
  if (!current) return attention("changed_after");
  const settled = current.price === price && current.currency === match.source.currency;
  const intact = baselineKeys.every((field) => current[field] === target[field]);
  const targetIntact = baselineKeys.every((field) => field === "pricing_version" || current[field] === target[field]);
  if (match.classification === "unchanged") {
    if (!settled) return attention("changed_after");
    // A persisted confirmation stays valid while the live price still equals the Supplier price; an unconfirmed row needs an intact baseline.
    if (decision === "confirmed_unchanged") return { section: "same", done: true, issue: "", action: "", kind: "same" };
    return targetIntact ? { section: "same", done: false, issue: "", action: "", kind: "same" } : attention("changed_after");
  }
  if (settled) return { section: "changed", done: true, issue: "", action: "", kind: "changed" };
  return intact ? { section: "changed", done: false, issue: "", action: "", kind: "changed" } : attention("changed_after");
}

export type FamilySummary = { template_id: string; template_name: string; items: number; changed: number; same: number; missing: number; attention: number; done: number; excluded: number; status: "ready" | "needs_review" | "needs_attention" | "completed" };
export type FamilyOverview = {
  batch: { id: string; status: string; scope: string };
  families: FamilySummary[];
  totals: { families: number; ready: number; changed: number; same: number; missing: number; attention: number };
  finished: { applied: number; confirmed: number; excluded: number };
  supplierOnly: { unmatched: number; companions: number };
};
export type FamilyRow = { key: string; code: string; item: string; current: string; supplier: string; change: string; issue: string; action: string; classification: string; selectable: boolean };

const rowClassifications = ["increased", "decreased", "changed", "unchanged", "shared", "ambiguous", "needs_dimension_mapping", "baseline_drift", "invalid_source", "target_not_represented"];
async function loadFamilyState(client: SupabaseClient, batchId: string) {
  if (typeof batchId !== "string" || !batchId) throw Error("Supplier batch required.");
  const batchResult = await client.from("supplier_price_batches").select("*").eq("id", batchId).single<ReviewBatch>();
  if (batchResult.error || !batchResult.data) throw Error(batchResult.error?.message ?? "Supplier batch unavailable.");
  const batch = batchResult.data;
  const pagedMatches: Array<{ key: string; data: PriceMatch }> = [];
  for (let from = 0; ; from += 500) {
    const page = await client.from("supplier_price_matches").select("key,data").eq("batch_id", batch.id).in("classification", rowClassifications).order("key").range(from, from + 499);
    if (page.error) throw Error(page.error.message);
    pagedMatches.push(...((page.data ?? []) as Array<{ key: string; data: PriceMatch }>));
    if ((page.data ?? []).length < 500) break;
  }
  const [decisions, unmatched, companions, { targets }] = await Promise.all([
    supplierRows<{ key: string; decision: string }>(client, "supplier_price_decisions", "key,decision", { batch_id: batch.id }, "key"),
    supplierRows<{ key: string }>(client, "supplier_price_matches", "key", { batch_id: batch.id, classification: "unmatched" }, "key"),
    supplierRows<{ key: string }>(client, "supplier_price_matches", "key", { batch_id: batch.id, classification: "referenced_companion" }, "key"),
    supplierBrandTargets(client, batch.brand_id),
  ]);
  const decided = new Map(decisions.map((row) => [row.key, row.decision]));
  const live = new Map(targets.map((target) => [target.key, target]));
  const rows = pagedMatches.map(({ key, data }) => ({ key, match: data, decision: decided.get(key), state: familyRowState(data, decided.get(key), live) }));
  return { batch, rows, live, supplierOnly: { unmatched: unmatched.length, companions: companions.length } };
}

export async function supplierFamilyOverview(client: SupabaseClient, batchId: string): Promise<FamilyOverview> {
  const { batch, rows, supplierOnly } = await loadFamilyState(client, batchId);
  const families = new Map<string, FamilySummary>();
  for (const row of rows) {
    if (!row.state.section) continue;
    for (const target of new Map(row.match.targets.map((item) => [item.template_id, item])).values()) {
      const family = families.get(target.template_id) ?? { template_id: target.template_id, template_name: target.template_name, items: 0, changed: 0, same: 0, missing: 0, attention: 0, done: 0, excluded: 0, status: "ready" as const };
      family.items++;
      if (row.state.done) { family.done++; if (row.state.section === "missing") family.excluded++; } else family[row.state.section]++;
      families.set(target.template_id, family);
    }
  }
  const list = [...families.values()].sort((a, b) => a.template_name.localeCompare(b.template_name)).map((family): FamilySummary => ({ ...family,
    status: batch.status === "completed" ? "completed" : family.attention ? "needs_attention" : family.changed || family.same || family.missing ? "needs_review" : "ready" }));
  const finished = { applied: 0, confirmed: 0, excluded: 0 };
  for (const row of rows) if (row.state.done) { if (row.state.section === "changed") finished.applied++; else if (row.state.section === "same") finished.confirmed++; else if (row.state.section === "missing") finished.excluded++; }
  const sum = (field: "changed" | "same" | "missing" | "attention") => list.reduce((total, family) => total + family[field], 0);
  return { batch: { id: batch.id, status: batch.status, scope: batch.scope }, families: list, supplierOnly,
    finished,
    totals: { families: list.length, ready: list.filter((family) => family.status === "ready" || family.status === "completed").length, changed: sum("changed"), same: sum("same"), missing: sum("missing"), attention: sum("attention") } };
}

/** Rows for one Family section. Display strings only; nothing here is trusted by the bulk actions. */
export async function supplierFamilyRows(client: SupabaseClient, batchId: string, templateId: string, section: FamilySection): Promise<{ rows: FamilyRow[]; truncated: boolean }> {
  if (!familySections.includes(section)) throw Error("Unknown Family section.");
  const { rows } = await loadFamilyState(client, batchId);
  const money = (currency: string, price: number | null) => price === null ? "—" : `${currency} ${price}`;
  const result: FamilyRow[] = [];
  for (const row of rows) {
    if (row.state.section !== section || !row.match.targets.some((target) => target.template_id === templateId)) continue;
    const target = row.match.targets.find((item) => item.template_id === templateId)!;
    const price = row.match.source?.price ?? null, change = price !== null && target.price !== null && target.currency === row.match.source?.currency ? price - target.price : null;
    result.push({ key: row.key, code: row.match.source?.code ?? target.raw_code, item: `${target.label}${target.dimension ? ` / ${target.dimension}` : ""}`,
      current: money(target.currency, target.price), supplier: section === "missing" ? "Not listed" : money(row.match.source?.currency ?? target.currency, price),
      change: row.state.done ? (section === "same" ? "Confirmed" : section === "missing" ? "Excluded" : "Applied") : change === null ? (section === "missing" ? "Missing" : "—") : change === 0 ? "Same" : `${change > 0 ? "+" : ""}${Number(change.toFixed(2))}`,
      issue: row.state.issue, action: row.state.action, classification: row.match.classification, selectable: !row.state.done && section !== "attention" });
  }
  return { rows: result.slice(0, 500), truncated: result.length > 500 };
}

function bulkKeys(matchKeys: unknown) {
  if (!Array.isArray(matchKeys) || !matchKeys.length || matchKeys.some((key) => typeof key !== "string" || !key) || new Set(matchKeys).size !== matchKeys.length) throw Error("Select at least one item.");
  if (matchKeys.length > SUPPLIER_BULK_LIMIT) throw Error(`Select up to ${SUPPLIER_BULK_LIMIT} items at a time.`);
  return matchKeys as string[];
}
type BulkRow = { key: string; data: PriceMatch; supplier_price_decisions: { decision: string; note: string } | null };
/** Reloads batch, source, Brand and the selected matches. Every row is then checked against the single-row rules. */
async function loadBulkContext(client: SupabaseClient, batchId: string, matchKeys: unknown, verb: string, pricing = true) {
  const keys = bulkKeys(matchKeys);
  const batchResult = await client.from("supplier_price_batches").select("*").eq("id", batchId).single<SupplierApplyBatch>();
  if (batchResult.error || !batchResult.data) throw Error("Supplier batch unavailable.");
  const batch = batchResult.data;
  if (batch.status !== "review") throw Error(`Supplier batch must be in review before ${verb}.`);
  const source = await supplierSource(client, batch.source_id);
  if (source.id !== batch.source_id || source.brand_id !== batch.brand_id) throw Error("Supplier source does not belong to this batch and Brand.");
  if (source.status !== "imported") throw Error(`Supplier source must be imported before ${verb}.`);
  if (pricing) {
    const brandResult = await client.from("brands").select("id,stored_price_basis").eq("id", batch.brand_id).single<{ id: string; stored_price_basis: string }>();
    if (brandResult.error || !brandResult.data || brandResult.data.id !== batch.brand_id) throw Error("Supplier Brand unavailable.");
    if (!["list", "net"].includes(source.basis) || !["list", "net"].includes(brandResult.data.stored_price_basis)) throw Error("Supplier price basis must be confirmed first.");
    if (source.basis !== brandResult.data.stored_price_basis) throw Error("Supplier price basis does not match the Brand stored price basis.");
    if (!["AED", "EUR", "USD"].includes(source.currency)) throw Error("Unsupported Supplier currency. Use AED, EUR, or USD.");
  }
  const matched = await client.from("supplier_price_matches").select("key,data,supplier_price_decisions(decision,note)").eq("batch_id", batch.id).in("key", keys);
  if (matched.error) throw Error("Supplier matches unavailable.");
  const byKey = new Map(((matched.data ?? []) as unknown as BulkRow[]).map((row) => [row.key, row]));
  if (keys.some((key) => !byKey.has(key))) throw Error("Some selected items are not part of this review.");
  return { batch, source, keys, rows: keys.map((key) => byKey.get(key)!) };
}
async function loadBulkIdentities(client: SupabaseClient, sourceId: string, rows: BulkRow[]) {
  const identityKeys = [...new Set(rows.flatMap((row) => row.data.source ? [row.data.source.key] : []))];
  const result = identityKeys.length ? await client.from("supplier_source_identities").select("key,data").eq("source_id", sourceId).in("key", identityKeys) : { data: [], error: null };
  if (result.error) throw Error("Supplier prices unavailable.");
  return new Map(((result.data ?? []) as unknown as Array<{ key: string; data: SourceIdentity }>).map((row) => [row.key, row.data]));
}
const needAttention = (count: number) => `${count} selected item${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention. Nothing was changed.`;
const changedAfterStart = (count: number) => `${count} selected item${count === 1 ? "" : "s"} changed after this review started. Nothing was applied.`;

/** Shared per-row eligibility for bulk Apply and bulk Confirm: the Phase 2A / 2C rules, never relaxed. */
function bulkRowCheck(row: BulkRow, identity: SourceIdentity | undefined, source: SourceVersion, brandId: string, live: Map<string, PriceTarget>, kind: "changed" | "unchanged") {
  const match = row.data;
  if (match.key !== row.key || match.targets.length !== 1 || !match.source || match.source.price === null || !Number.isFinite(match.source.price) || match.source.price < 0 || match.source.issues.length) return "attention" as const;
  if (kind === "changed" ? !["increased", "decreased", "changed"].includes(match.classification) : match.classification !== "unchanged") return "attention" as const;
  const decision = row.supplier_price_decisions?.decision;
  if (decision === "skip" || decision === "reject" || decision === "mapping_proposed") return "attention" as const;
  if (!identity || ["key", "code", "price_field", "price", "currency"].some((field) => identity[field as keyof SourceIdentity] !== match.source![field as keyof SourceIdentity]) || identity.issues.length || identity.currency !== source.currency) return "attention" as const;
  const baseline = match.targets[0];
  if (baseline.brand_id !== brandId || baseline.currency !== source.currency) return "attention" as const;
  const current = live.get(baseline.key);
  // Confirming unchanged writes no Product data, so only the exact target must be intact; Apply keeps the full version-checked baseline.
  if (!current || baselineKeys.some((field) => (kind === "unchanged" && field === "pricing_version") ? false : current[field] !== baseline[field]) || (kind === "changed" && expectedPricingVersion(current.pricing_version) === null)) return "stale" as const;
  if (kind === "changed" ? current.price === identity.price : current.price !== identity.price) return "stale" as const;
  return current;
}

/** Approver bulk Apply: all selected single-target changed prices go through the one transactional writer, or none do. */
export async function supplierBulkApplyChanged(client: SupabaseClient, batchId: string, matchKeys: string[]) {
  const { batch, source, keys, rows } = await loadBulkContext(client, batchId, matchKeys, "applying");
  const identities = await loadBulkIdentities(client, source.id, rows);
  const { targets, templates } = await supplierBrandTargets(client, batch.brand_id);
  const live = new Map(targets.map((target) => [target.key, target]));
  const checks = rows.map((row) => bulkRowCheck(row, row.data.source ? identities.get(row.data.source.key) : undefined, source, batch.brand_id, live, "changed"));
  const stale = checks.filter((check) => check === "stale").length, other = checks.filter((check) => check === "attention").length;
  if (stale) throw Error(changedAfterStart(stale));
  if (other) throw Error(needAttention(other));
  const currents = checks as PriceTarget[];
  if (new Set(currents.map((current) => current.key)).size !== currents.length) throw Error(needAttention(1));
  const working = new Map(templates.map((template) => [template.id, structuredClone(template)]));
  const operations = currents.map((current, index) => {
    const price = identities.get(rows[index].data.source!.key)!.price!;
    const history = { brand_price_list_update_id: batch.brand_price_list_update_id ?? null, effective_from: source.effective_from ?? null, note: `Supplier source: ${source.title}; batch: ${batch.id}; match: ${keys[index]}; bulk apply` };
    const write = supplierTargetWrite(current, working, price, source.currency, history);
    if (write.mode === "detail" && current.architecture !== "product_components") working.get(current.template_id)![current.architecture] = write.payload[current.architecture];
    return { template_id: current.template_id, expected_version: current.pricing_version, mode: write.mode, payload: write.payload, history: write.history };
  });
  const { error } = await client.rpc("apply_supplier_shared_price_at_versions", { p_operations: operations });
  if (error) throw Error(error.message.includes(pricingConflictMessage) ? changedAfterStart(operations.length) : "Prices could not be applied. Nothing was changed.");
  // Applying is the approver's explicit review: record it so earlier skip/reject dispositions no longer block completion.
  let failed = 0;
  for (let index = 0; index < keys.length; index++) {
    try { await supplierWrite(client, "decision", { batch_id: batch.id, key: keys[index], decision: "reviewed", note: rows[index].supplier_price_decisions?.note ?? "", proposed_target_keys: [] }); } catch { failed++; }
  }
  if (failed) throw Error(`${operations.length} prices were applied, but ${failed} review decision${failed === 1 ? "" : "s"} could not be recorded. Mark them reviewed in Advanced Review.`);
  return { message: `${operations.length} price${operations.length === 1 ? "" : "s"} applied.`, count: operations.length };
}

/** Approver bulk Confirm unchanged. Every row is validated first; the idempotent decision writes happen only afterwards. */
export async function supplierBulkConfirmUnchanged(client: SupabaseClient, batchId: string, matchKeys: string[]) {
  const { batch, source, keys, rows } = await loadBulkContext(client, batchId, matchKeys, "confirming");
  const identities = await loadBulkIdentities(client, source.id, rows);
  const { targets } = await supplierBrandTargets(client, batch.brand_id);
  const live = new Map(targets.map((target) => [target.key, target]));
  const checks = rows.map((row) => bulkRowCheck(row, row.data.source ? identities.get(row.data.source.key) : undefined, source, batch.brand_id, live, "unchanged"));
  const stale = checks.filter((check) => check === "stale").length, other = checks.filter((check) => check === "attention").length;
  if (stale) throw Error(`${stale} selected item${stale === 1 ? "" : "s"} changed after this review started. Nothing was confirmed.`);
  if (other) throw Error(needAttention(other));
  let done = 0;
  try {
    for (let index = 0; index < keys.length; index++) {
      await supplierWrite(client, "decision", { batch_id: batch.id, key: keys[index], decision: "confirmed_unchanged", note: rows[index].supplier_price_decisions?.note ?? "", proposed_target_keys: [] });
      done++;
    }
  } catch { throw Error(`${done} of ${keys.length} unchanged prices were confirmed before an error. Select the rest and confirm again.`); }
  return { message: `${keys.length} unchanged price${keys.length === 1 ? "" : "s"} confirmed.`, count: keys.length };
}

/** Approver bulk exclusion of targets missing from the Supplier source, with one required reason. No Product data is written. */
export async function supplierBulkExcludeMissing(client: SupabaseClient, batchId: string, matchKeys: string[], reason: string) {
  const note = typeof reason === "string" ? reason.trim() : "";
  if (!note || note.length > 4000) throw Error("A reason is required to exclude items from this source.");
  const { batch, keys, rows } = await loadBulkContext(client, batchId, matchKeys, "excluding", false);
  const bad = rows.filter((row) => row.data.classification !== "target_not_represented" || row.data.key !== row.key).length;
  if (bad) throw Error(needAttention(bad));
  let done = 0;
  try {
    for (const key of keys) { await supplierWrite(client, "decision", { batch_id: batch.id, key, decision: "excluded_from_source", note, proposed_target_keys: [] }); done++; }
  } catch { throw Error(`${done} of ${keys.length} items were excluded before an error. Select the rest and try again.`); }
  return { message: `${keys.length} item${keys.length === 1 ? "" : "s"} excluded from this Supplier source.`, count: keys.length };
}
