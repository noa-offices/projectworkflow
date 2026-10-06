import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeManufacturerCode } from "./manufacturer-code";
import type { DimensionRule, DurableBinding, PriceMatch, PriceTarget, ProductPriceInput, ReviewBatch, SourceIdentity, SourceVersion, SupplierIdentityEvidence, SupplierCoverageConflict, SupplierCoverageSuggestionRow, SupplierSourceDefinitionSummary } from "./supplier-price-contracts";
import { expectedPricingVersion, pricingConflictMessage } from "./pricing-write-version";
import { brandPriceTargets } from "./supplier-price-targets";
import { comparisonCode, matchSupplierPrices } from "./supplier-price-matching";

export type SupplierSourceInspectorRow = {
  key: string; code: string; price: number | null; currency: string; priceField: string; dimension: string; finishes: string[]; sourceRowCount: number; warnings: string[]; multiplePriceIdentities?: boolean;
};
/** Clean read-only view over retained source rows; original source values are never altered. */
export type SupplierNormalizedWorkingRow = { articleCode: string; fullCode: string; description: string; finishCode: string; categoryLabel: string; dimensionLabel: string; rawPrice: string; price: number | null; currency: string; priceField: string; dimension: string; sourceRowNumber: number; sheet: string; validationWarnings: string[] };
export type SupplierSourceInspectorEvidence = SupplierNormalizedWorkingRow;
export type SupplierSourceInspectorDetail = SupplierSourceInspectorRow & { fullCodes: string[]; evidence: SupplierSourceInspectorEvidence[]; moreEvidence: number };

const inspectorLimit = 50;
const inspectorText = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const inspectorRow = (identity: SourceIdentity): SupplierSourceInspectorRow => ({
  key: identity.key, code: identity.code, price: identity.price, currency: identity.currency, priceField: identity.price_field, dimension: identity.raw_dimension || identity.dimension, finishes: identity.finishes, sourceRowCount: identity.source_row_count ?? identity.row_keys.length, warnings: identity.issues,
});
function normalizedSupplierWorkingRow(source: SourceVersion, identity: SourceIdentity, row: { row_number: number; sheet: string; raw_extras: Record<string, unknown> }): SupplierNormalizedWorkingRow {
  const fullCode = inspectorText(row.raw_extras[source.profile.full_code_column]);
  const finishCode = source.profile.strategy === "article_plus_finish" && source.profile.finish_length && fullCode.length >= source.profile.finish_length ? fullCode.slice(-source.profile.finish_length) : "";
  return { articleCode: identity.code, fullCode, description: source.profile.description_column ? inspectorText(row.raw_extras[source.profile.description_column]) : "", finishCode, categoryLabel: source.profile.category_column ? inspectorText(row.raw_extras[source.profile.category_column]) : "", dimensionLabel: identity.raw_dimension || identity.dimension, rawPrice: "", price: identity.price, currency: identity.currency, priceField: identity.price_field, dimension: identity.raw_dimension || identity.dimension, sourceRowNumber: row.row_number, sheet: row.sheet, validationWarnings: identity.issues };
}

/** Read-only, source-scoped identity search. Exact canonical code matches always precede browse matches. */
export async function supplierSourceInspectorSearch(client: SupabaseClient, sourceId: string, query: string, offset = 0, limit = inspectorLimit) {
  const source = await supplierSource(client, sourceId);
  if (source.status !== "imported") throw Error("Supplier source is not available for inspection.");
  const search = typeof query === "string" ? query.trim().slice(0, 120) : "";
  const canonical = comparisonCode(search);
  const start = Math.max(0, Math.floor(offset)); const take = Math.min(inspectorLimit, Math.max(1, Math.floor(limit)));
  const exactQuery = canonical ? client.from("supplier_source_identities").select("key,data", { count: "exact" }).eq("source_id", source.id).eq("code", canonical).order("key", { ascending: true }) : null;
  const exactResult = exactQuery ? await exactQuery : { data: [], error: null, count: 0 };
  if (exactResult.error) throw Error(exactResult.error.message);
  const exactCount = exactResult.count ?? 0;
  let rows: Array<{ key: string; data: SourceIdentity }> = [];
  if (start < exactCount) {
    const result = await client.from("supplier_source_identities").select("key,data").eq("source_id", source.id).eq("code", canonical).order("key", { ascending: true }).range(start, start + take - 1);
    if (result.error) throw Error(result.error.message); rows = (result.data ?? []) as Array<{ key: string; data: SourceIdentity }>;
  } else {
    let browse = client.from("supplier_source_identities").select("key,data").eq("source_id", source.id).order("key", { ascending: true });
    if (canonical) browse = browse.ilike("code", `%${canonical.replace(/[\\%_]/g, "\\$&")}%`).neq("code", canonical);
    const result = await browse.range(Math.max(0, start - exactCount), Math.max(0, start - exactCount) + take - 1);
    if (result.error) throw Error(result.error.message); rows = (result.data ?? []) as Array<{ key: string; data: SourceIdentity }>;
  }
  return { source: { id: source.id, title: source.title }, rows: rows.map((row) => ({ ...inspectorRow(row.data), multiplePriceIdentities: Boolean(canonical && exactCount > 1) })), exactCount, hasMore: rows.length === take };
}

function evidenceWorkingRow(identity: SourceIdentity, item: SupplierIdentityEvidence): SupplierNormalizedWorkingRow {
  return { articleCode: item.article_code ?? identity.code, fullCode: item.full_supplier_code ?? "", description: item.description ?? "", finishCode: item.finish_code ?? "", categoryLabel: item.category_label ?? "", dimensionLabel: item.dimension_label ?? (identity.raw_dimension || identity.dimension), rawPrice: inspectorText(item.raw_price), price: identity.price, currency: identity.currency, priceField: identity.price_field, dimension: identity.raw_dimension || identity.dimension, sourceRowNumber: item.row_number, sheet: item.sheet, validationWarnings: identity.issues };
}
/** The detail endpoint deliberately returns only five human-readable provenance rows, never raw source JSON. */
export async function supplierSourceInspectorDetail(client: SupabaseClient, sourceId: string, identityKey: string): Promise<SupplierSourceInspectorDetail> {
  const source = await supplierSource(client, sourceId);
  if (source.status !== "imported") throw Error("Supplier source is not available for inspection.");
  const identityResult = await client.from("supplier_source_identities").select("key,data").eq("source_id", source.id).eq("key", identityKey).single<{ key: string; data: SourceIdentity }>();
  if (identityResult.error || !identityResult.data) throw Error(identityResult.error?.message ?? "Extracted identity unavailable.");
  const identity = identityResult.data.data; const rowKeys = identity.row_keys;
  // Finalised identities carry their own evidence; only older identities still need the source rows.
  if (identity.evidence?.length) {
    const evidence = identity.evidence.map((item) => evidenceWorkingRow(identity, item));
    return { ...inspectorRow(identity), fullCodes: [...new Set(evidence.map((row) => row.fullCode).filter(Boolean))], evidence, moreEvidence: Math.max(0, (identity.source_row_count ?? rowKeys.length) - evidence.length) };
  }
  const provenance = rowKeys.length ? await client.from("supplier_source_rows").select("unit_key,row_number,sheet,raw_extras").eq("source_id", source.id).in("unit_key", rowKeys.slice(0, 5)).order("row_number", { ascending: true }).returns<Array<{ unit_key: string; row_number: number; sheet: string; raw_extras: Record<string, unknown> }>>() : { data: [], error: null };
  if (provenance.error) throw Error(provenance.error.message);
  const evidence = (provenance.data ?? []).map((row) => normalizedSupplierWorkingRow(source, identity, row));
  const fullCodes = [...new Set(evidence.map((row) => row.fullCode).filter(Boolean))];
  return { ...inspectorRow(identity), fullCodes, evidence, moreEvidence: Math.max(0, rowKeys.length - evidence.length) };
}

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
/** A batch’s immutable coverage snapshot: null is legacy/unrestricted, otherwise the only Families that participate in the review. */
export function supplierBatchCoverage(batch: { coverage_template_ids?: string[] | null }): string[] | null { return batch.coverage_template_ids ?? null; }
/** The one Supplier target universe. Every matching, review, readiness, Apply and Confirm path takes its targets here, so all agree on coverage. */
export async function supplierBrandTargets(client: SupabaseClient, brandId: string, coverage: string[] | null = null) {
  const [allTemplates, components] = await Promise.all([
    supplierRows<ProductPriceInput>(client, "product_templates", "id,brand_id,template_name,item_code,currency,default_unit_price,pricing_version,variant_pricing,category_pricing,desking_size_pricing,accessory_pricing", { brand_id: brandId, is_active: true }),
    supplierRows<Record<string, unknown>>(client, "product_components", "id,template_id,component_code,component_name,currency,unit_price,is_active,product_templates!inner(brand_id)", { "product_templates.brand_id": brandId, is_active: true }),
  ]);
  const covered = coverage ? new Set(coverage) : null;
  const templates = covered ? allTemplates.filter((template) => covered.has(template.id)) : allTemplates;
  return { templates, targets: brandPriceTargets(templates, components) };
}
/** Coverage for a source that has a definition: the active definition’s confirmed Families, or an error. Null for a legacy source. The database derives the same set for the batch snapshot. */
export async function supplierSourceCoverage(client: SupabaseClient, source: { brand_id: string; definition_id?: string | null }): Promise<string[] | null> {
  if (!source.definition_id) return null;
  const definition = (await supplierRows<{ id: string }>(client, "supplier_source_definitions", "id", { id: source.definition_id, brand_id: source.brand_id, is_active: true })).at(0);
  if (!definition) throw Error("This Supplier source definition is inactive or unavailable.");
  const families = await supplierRows<{ template_id: string }>(client, "supplier_source_definition_families", "template_id", { definition_id: definition.id }, "template_id");
  if (!families.length) throw Error("This Supplier source has no confirmed Family coverage.");
  return families.map((family) => family.template_id);
}
export async function supplierSource(client: SupabaseClient, sourceId: string) {
  const { data, error } = await client.from("supplier_source_versions").select("*").eq("id", sourceId).single<SourceVersion>();
  if (error || !data) throw Error(error?.message ?? "Source unavailable.");
  return data;
}
/** Review matches carry the identity without its evidence, so stored match rows do not grow; evidence stays on the identity. */
function withoutEvidence(identity: SourceIdentity): SourceIdentity { const copy = { ...identity }; delete copy.evidence; return copy; }
export async function supplierBrandMatches(client: SupabaseClient, sourceId: string) {
  const source = await supplierSource(client, sourceId);
  if (source.status !== "imported") throw Error("Matching refuses an incomplete or archived source.");
  const coverage = await supplierSourceCoverage(client, source);
  const [{ targets, templates }, identities, rules, bindings] = await Promise.all([
    supplierBrandTargets(client, source.brand_id, coverage),
    supplierRows<{ data: SourceIdentity }>(client, "supplier_source_identities", "key,data", { source_id: sourceId }, "key"),
    supplierRows<DimensionRule>(client, "supplier_dimension_vocabulary", "*", { brand_id: source.brand_id, is_active: true }),
    supplierRows<DurableBinding>(client, "supplier_price_bindings", "*", { brand_id: source.brand_id }),
  ]);
  return { source, templates, targets, coverage, rules, matches: matchSupplierPrices(identities.map((identity) => withoutEvidence(identity.data)), targets, rules, bindings) };
}
/** Builds a review batch. Coverage is the outer boundary (a source definition’s Families, or the whole Brand for a legacy source); the scope only narrows within it. */
export async function supplierCreateReviewBatch(client: SupabaseClient, sourceId: string, scope: string, selectedIds: string[], brandListId?: string) {
  const { source, matches, coverage } = await supplierBrandMatches(client, sourceId);
  if (coverage && source.definition_id && (await supplierSourceCoverageConflicts(client, { brandId: source.brand_id, definitionId: source.definition_id })).length) throw Error("Resolve Family coverage conflicts before starting this review.");
  if (coverage && selectedIds.some((id) => !coverage.includes(id))) throw Error("A selected Family is outside this source coverage.");
  const chunks = supplierMatchChunks(matches);
  const result = await supplierWrite(client, "batch", { source_id: sourceId, title: source.title, scope, selected_template_ids: selectedIds, brand_price_list_update_id: brandListId || null, expected_matches: matches.length, expected_chunks: chunks.length });
  // The database derived the stored snapshot itself; the comparison above must have used exactly that set.
  const stored = (await client.from("supplier_price_batches").select("*").eq("id", result.id).single<ReviewBatch>()).data;
  const snapshot = stored ? supplierBatchCoverage(stored) : null;
  if ((snapshot ? [...snapshot].sort().join() : null) !== (coverage ? [...coverage].sort().join() : null)) throw Error("Source coverage changed while the comparison was built. Start a fresh batch.");
  for (let index = 0; index < chunks.length; index++) await supplierWrite(client, "match_chunk", { batch_id: result.id, chunk_index: index, matches: chunks[index] });
  await supplierWrite(client, "finalize_batch", { batch_id: result.id });
  return result;
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
    // Same comparison rule as the matcher: the binding is found by compact code, whatever whitespace it was stored with.
    const bindings = (await supplierRows<DurableBinding>(client, "supplier_price_bindings", "*", { brand_id: batch.brand_id, price_field: identity.price_field, source_dimension: identity.dimension }))
      .filter((row) => comparisonCode(row.code) === comparisonCode(identity.code));
    const binding = bindings.length === 1 ? bindings[0] : null;
    if (!binding || binding.kind !== "shared" || binding.confirmed !== true) throw Error("A confirmed durable shared binding is required before shared Apply.");
    const bound = [...binding.target_keys].sort(), reviewed = baselines.map((baseline) => baseline.key).sort();
    if (new Set(bound).size !== bound.length || bound.length !== reviewed.length || bound.some((key, index) => key !== reviewed[index])) throw Error("The durable shared binding no longer matches the reviewed targets. Build a fresh Supplier comparison.");
  }
  const { targets, templates } = await supplierBrandTargets(client, batch.brand_id, supplierBatchCoverage(batch));
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
  const { targets } = await supplierBrandTargets(client, batch.brand_id, supplierBatchCoverage(batch));
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
    supplierBrandTargets(client, batch.brand_id, supplierBatchCoverage(batch)),
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
  needs_dimension_mapping: ["Category mapping needed", "Supplier data was found, but ProjectWorkflow cannot determine which Product category/tier this Supplier price belongs to."],
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
export type FamilyMapping = { templateId: string; groupId: string | null; dimensions: string[]; mode: "raw_label" | "finish" | null; rawLabels: string[]; finishCodes: string[] };
export type FamilyRow = { key: string; code: string; productCode: string; item: string; productPriceField: string; productDimension: string; sourceIdentityKey: string | null; mapping: FamilyMapping | null; current: string; supplier: string; change: string; issue: string; action: string; classification: string; selectable: boolean };
export type FamilyTierTask = FamilyMapping & { key: string; label: string; affected: number; codes: string[]; mappedDimension: string | null; hasRule: boolean };
export type FamilyMappedTier = { rule: DimensionRule; dimensions: string[]; affected: number; scope: "Brand" | "Template" | "Group" };
export type FamilyTierPanel = { unresolved: FamilyTierTask[]; mapped: FamilyMappedTier[] };

/** Display-only aggregation; saved match classifications and scope precedence remain authoritative. */
export function familyTierPanel(matches: PriceMatch[], targets: PriceTarget[], rules: DimensionRule[], templateId: string): FamilyTierPanel {
  const familyTargets = targets.filter((target) => target.template_id === templateId);
  const dimensionsFor = (groupId?: string | null) => [...new Set(familyTargets.filter((target) => !groupId || target.group_id === groupId).map((target) => target.dimension).filter(Boolean))].sort();
  const relevant = rules.filter((rule) => (!rule.template_id || rule.template_id === templateId) && dimensionsFor(rule.group_id).length);
  const accepts = (rule: DimensionRule, source: SourceIdentity, target: PriceTarget) => rule.brand_id === target.brand_id && (!rule.template_id || rule.template_id === target.template_id) && (!rule.group_id || rule.group_id === target.group_id) &&
    (!rule.raw_labels.length || rule.raw_labels.includes(source.raw_dimension ?? source.dimension)) && (rule.finish_codes.length ? Boolean(target.dimension) && source.finishes.length > 0 && source.finishes.every((code) => rule.finish_codes.includes(code)) : !(source.finishes.length && source.dimension !== (source.raw_dimension ?? source.dimension))) && Boolean(rule.raw_labels.length || rule.finish_codes.length);
  const groups = new Map<string, FamilyTierTask>();
  for (const match of matches) {
    if (match.classification !== "needs_dimension_mapping" || !match.source) continue;
    const source = match.source;
    const finishDriven = Boolean(source.finishes.length && source.dimension !== (source.raw_dimension ?? source.dimension));
    const rawLabels = finishDriven ? [] : [source.raw_dimension ?? source.dimension].filter(Boolean);
    const finishCodes = finishDriven ? [...source.finishes].sort() : [];
    if (!rawLabels.length && !finishCodes.length) continue;
    for (const target of new Map(match.targets.filter((item) => item.template_id === templateId).map((item) => [item.group_id, item])).values()) {
      const key = JSON.stringify([templateId, target.group_id, rawLabels, finishCodes]);
      const task = groups.get(key) ?? { key, label: rawLabels.join(", ") || `Finishes: ${finishCodes.join(", ")}`, templateId, groupId: target.group_id || null, dimensions: dimensionsFor(target.group_id), mode: finishDriven ? "finish" : "raw_label", rawLabels, finishCodes, affected: 0, codes: [], mappedDimension: null, hasRule: false };
      task.affected++; task.codes.push(source.code);
      // Only report a saved mapping when the most-specific eligible rules agree.
      const eligible = relevant.filter((rule) => accepts(rule, source, target));
      task.hasRule ||= eligible.length > 0;
      const specificity = (rule: DimensionRule) => (rule.template_id ? 1 : 0) + (rule.group_id ? 1 : 0);
      const highest = Math.max(-1, ...eligible.map(specificity));
      const codes = [...new Set(eligible.filter((rule) => specificity(rule) === highest).map((rule) => rule.dimension_code))];
      task.mappedDimension = codes.length === 1 && task.dimensions.includes(codes[0]) ? codes[0] : null;
      groups.set(key, task);
    }
  }
  return { unresolved: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)), mapped: relevant.map((rule) => ({ rule, dimensions: dimensionsFor(rule.group_id), scope: rule.group_id ? "Group" : rule.template_id ? "Template" : "Brand", affected: matches.filter((match) => match.source && match.targets.some((target) => target.template_id === templateId && accepts(rule, match.source!, target))).length })) };
}

export type SourceTierTask = FamilyTierTask & { scopeName: string; finishLabel: string };
export type SourceMappedTier = FamilyMappedTier & { scopeName: string; label: string };
export type SourceTierPanel = { unmapped: SourceTierTask[]; ambiguous: SourceTierTask[]; mapped: SourceMappedTier[] };

/** Current source truth: uses identities/current vocabulary/covered targets, never a saved batch. */
export async function supplierSourceTierPanel(client: SupabaseClient, sourceId: string): Promise<SourceTierPanel> {
  const { matches, targets, templates, rules } = await supplierBrandMatches(client, sourceId);
  return sourceTierPanel(matches, targets, rules, templates);
}

export function sourceTierPanel(matches: PriceMatch[], targets: PriceTarget[], rules: DimensionRule[], templates: ProductPriceInput[]): SourceTierPanel {
  const friendlyScope = (templateId?: string | null, groupId?: string | null) => {
    if (!templateId) return "Brand";
    const template = templates.find((item) => item.id === templateId);
    const name = template?.template_name || "Product family";
    if (!groupId) return name;
    const group = template ? ["variant_pricing", "category_pricing", "desking_size_pricing", "accessory_pricing"].flatMap((field) => Array.isArray(template[field]) ? template[field] as Array<Record<string, unknown>> : []).find((item) => item.id === groupId) : undefined;
    const title = group?.group_name ?? group?.name ?? group?.title ?? group?.category_name;
    return `${name} / ${typeof title === "string" && title.trim() ? title : "Pricing group"}`;
  };
  const panels = templates.map((template) => familyTierPanel(matches, targets, rules, template.id));
  const tasks = panels.flatMap((panel) => panel.unresolved).map((task) => ({ ...task, scopeName: friendlyScope(task.templateId, task.groupId), finishLabel: `Supplier finishes (${task.finishCodes.length})`, label: task.finishCodes.length ? `Supplier finishes (${task.finishCodes.length})` : task.label }));
  const relevantRules = new Map<string, SourceMappedTier>();
  for (const panel of panels) for (const item of panel.mapped) {
    if (!item.affected) continue;
    const previous = relevantRules.get(item.rule.id);
    relevantRules.set(item.rule.id, { ...item, affected: (previous?.affected ?? 0) + item.affected, dimensions: [...new Set([...(previous?.dimensions ?? []), ...item.dimensions])].sort(), scopeName: friendlyScope(item.rule.template_id, item.rule.group_id), label: item.rule.raw_labels.join(", ") || `${item.rule.dimension_code.replace(/_/g, " ")} finishes (${item.rule.finish_codes.length})` });
  }
  return { unmapped: tasks.filter((task) => !task.hasRule), ambiguous: tasks.filter((task) => task.hasRule && !task.mappedDimension), mapped: [...relevantRules.values()] };
}

/** Rebuild only the latest open review. The existing RPC creates a new immutable snapshot. */
export async function supplierRefreshReviewAfterMapping(client: SupabaseClient, sourceId: string, batchId?: string) {
  if (!batchId) return { id: null };
  const batchResult = await client.from("supplier_price_batches").select("*").eq("id", batchId).eq("source_id", sourceId).single<ReviewBatch & { brand_price_list_update_id?: string | null }>();
  if (batchResult.error || !batchResult.data) throw Error("Supplier review unavailable for this source.");
  const batch = batchResult.data;
  if (batch.status !== "review") return { id: null };
  const latest = await client.from("supplier_price_batches").select("id").eq("source_id", sourceId).order("created_at", { ascending: false }).order("id").limit(1).maybeSingle<{ id: string }>();
  if (latest.error) throw Error(latest.error.message);
  if (latest.data?.id !== batch.id) return { id: null };
  const source = await supplierSource(client, sourceId);
  const coverage = await supplierSourceCoverage(client, source);
  const normalized = (ids: string[] | null) => ids === null ? null : [...ids].sort().join();
  if (normalized(coverage) !== normalized(supplierBatchCoverage(batch))) throw Error("Source coverage changed. Start a review with the current coverage.");
  return supplierCreateReviewBatch(client, sourceId, batch.scope, batch.selected_template_ids, batch.brand_price_list_update_id || undefined);
}

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
    supplierBrandTargets(client, batch.brand_id, supplierBatchCoverage(batch)),
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
  const { rows, live } = await loadFamilyState(client, batchId);
  const money = (currency: string, price: number | null) => price === null ? "—" : `${currency} ${price}`;
  const result: FamilyRow[] = [];
  for (const row of rows) {
    if (row.state.section !== section || !row.match.targets.some((target) => target.template_id === templateId)) continue;
    const target = row.match.targets.find((item) => item.template_id === templateId)!;
    const price = row.match.source?.price ?? null, change = price !== null && target.price !== null && target.currency === row.match.source?.currency ? price - target.price : null;
    const source = row.match.source;
    const finishDriven = Boolean(source?.finishes.length && source.dimension !== (source.raw_dimension ?? source.dimension));
    const dimensions = [...new Set([...live.values()].filter((candidate) => candidate.template_id === target.template_id && candidate.group_id === target.group_id && candidate.price_field === target.price_field && Boolean(candidate.dimension)).map((candidate) => candidate.dimension))].sort();
    const mapping: FamilyMapping | null = source ? { templateId: target.template_id, groupId: target.group_id || null, dimensions, mode: finishDriven ? "finish" : source.raw_dimension ? "raw_label" : null, rawLabels: finishDriven ? [] : source.raw_dimension ? [source.raw_dimension] : [], finishCodes: finishDriven ? source.finishes : [] } : null;
    result.push({ key: row.key, code: source?.code ?? target.raw_code, productCode: target.raw_code, item: `${target.label}${target.dimension ? ` / ${target.dimension}` : ""}`, productPriceField: target.price_field, productDimension: target.dimension, sourceIdentityKey: source?.key ?? null, mapping,
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
  const { targets, templates } = await supplierBrandTargets(client, batch.brand_id, supplierBatchCoverage(batch));
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
  const { targets } = await supplierBrandTargets(client, batch.brand_id, supplierBatchCoverage(batch));
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

// ---- Phase 2I-1: read-only source-definition coverage. Nothing here writes, and no review path consumes it yet. ----
/** Strong code overlap suggests coverage; the user always confirms. Descriptions are never evidence here. */
const SUPPLIER_COVERAGE_SUGGEST_RATIO = 0.8;
type DefinitionRow = { id: string; brand_id: string; name: string; profile_id: string | null; is_active: boolean };
type DefinitionFamilyRow = { template_id: string; confirmed_at: string };

async function definitionFamilies(client: SupabaseClient, definitionId: string) {
  return supplierRows<DefinitionFamilyRow>(client, "supplier_source_definition_families", "template_id,confirmed_at", { definition_id: definitionId }, "template_id");
}

export async function supplierSourceDefinitionsForBrand(client: SupabaseClient, brandId: string): Promise<SupplierSourceDefinitionSummary[]> {
  const [definitions, versions] = await Promise.all([
    supplierRows<DefinitionRow>(client, "supplier_source_definitions", "id,brand_id,name,profile_id,is_active", { brand_id: brandId }, "name"),
    supplierRows<{ id: string; title: string; received_at: string | null; created_at: string; definition_id: string | null }>(client, "supplier_source_versions", "id,title,received_at,created_at,definition_id", { brand_id: brandId, status: "imported" }, "created_at"),
  ]);
  return Promise.all(definitions.map(async (definition) => {
    const latest = versions.filter((version) => version.definition_id === definition.id).at(-1);
    return { id: definition.id, name: definition.name, profileId: definition.profile_id, isActive: definition.is_active, confirmedFamilyCount: (await definitionFamilies(client, definition.id)).length,
      latestSource: latest ? { id: latest.id, title: latest.title, receivedAt: latest.received_at } : null };
  }));
}

/** Per Family: how many of its distinct Product comparison codes exist in the imported source. Same canonical code as matching; no new matching semantics. */
export async function supplierSourceCoverageSuggestion(client: SupabaseClient, input: { brandId: string; sourceId: string; definitionId?: string }): Promise<SupplierCoverageSuggestionRow[]> {
  const source = await supplierSource(client, input.sourceId);
  if (source.brand_id !== input.brandId) throw Error("Supplier source belongs to another Brand.");
  if (source.status !== "imported") throw Error("Coverage can only be suggested for an imported source.");
  let prior = new Map<string, string>(); let priorConfirmedAt = "";
  if (input.definitionId) {
    const definition = (await supplierRows<DefinitionRow>(client, "supplier_source_definitions", "id,brand_id,name,profile_id,is_active", { id: input.definitionId, brand_id: input.brandId })).at(0);
    if (!definition) throw Error("Source definition unavailable for this Brand.");
    const families = await definitionFamilies(client, definition.id);
    prior = new Map(families.map((family) => [family.template_id, family.confirmed_at]));
    priorConfirmedAt = families.reduce((latest, family) => (family.confirmed_at > latest ? family.confirmed_at : latest), "");
  }
  const [{ targets, templates }, identities, created] = await Promise.all([
    supplierBrandTargets(client, input.brandId),
    supplierRows<{ data: SourceIdentity }>(client, "supplier_source_identities", "key,data", { source_id: input.sourceId }, "key"),
    supplierRows<{ id: string; created_at: string }>(client, "product_templates", "id,created_at", { brand_id: input.brandId, is_active: true }),
  ]);
  const sourceCodes = new Set(identities.map((identity) => comparisonCode(identity.data.code)));
  const createdAt = new Map(created.map((template) => [template.id, template.created_at]));
  return templates.map((template) => {
    const codes = new Set(targets.filter((target) => target.template_id === template.id).map((target) => comparisonCode(target.code)));
    const found = [...codes].filter((code) => sourceCodes.has(code)).length;
    const previouslyCovered = prior.has(template.id);
    // A Family is new only if it appeared after the definition's last confirmation; a Family left out on purpose is not re-announced.
    const isNewFamily = Boolean(priorConfirmedAt) && !previouslyCovered && String(createdAt.get(template.id) ?? "") > priorConfirmedAt;
    const foundRatio = codes.size ? found / codes.size : 0;
    return { templateId: template.id, templateName: template.template_name, totalTargetCodes: codes.size, foundTargetCodes: found, foundRatio, previouslyCovered, isNewFamily,
      suggested: previouslyCovered || (found > 0 && foundRatio >= SUPPLIER_COVERAGE_SUGGEST_RATIO) };
  }).sort((a, b) => a.templateName.localeCompare(b.templateName));
}

/** A Family claimed by two or more active definitions. Computed, never enforced; no winner is chosen. */
export async function supplierSourceCoverageConflicts(client: SupabaseClient, input: { brandId: string; definitionId?: string }): Promise<SupplierCoverageConflict[]> {
  const [definitions, templates] = await Promise.all([
    supplierRows<DefinitionRow>(client, "supplier_source_definitions", "id,brand_id,name,profile_id,is_active", { brand_id: input.brandId, is_active: true }, "name"),
    supplierRows<{ id: string; template_name: string }>(client, "product_templates", "id,template_name", { brand_id: input.brandId }),
  ]);
  const claims = new Map<string, Array<{ definitionId: string; definitionName: string }>>();
  for (const definition of definitions) for (const family of await definitionFamilies(client, definition.id)) claims.set(family.template_id, [...(claims.get(family.template_id) ?? []), { definitionId: definition.id, definitionName: definition.name }]);
  const names = new Map(templates.map((template) => [template.id, template.template_name]));
  return [...claims].filter(([, owners]) => owners.length > 1 && (!input.definitionId || owners.some((owner) => owner.definitionId === input.definitionId)))
    .map(([templateId, owners]) => ({ templateId, templateName: names.get(templateId) ?? templateId, definitions: owners }))
    .sort((a, b) => a.templateName.localeCompare(b.templateName));
}

// ---- Phase 2I-4: business-facing coverage overview and the thin write helpers behind the coverage UI. ----
export type SupplierCoverageDefinition = { id: string; name: string; profileId: string | null; profileTitle: string | null; isActive: boolean; canDelete: boolean; families: Array<{ id: string; name: string }>; latest: { id: string; title: string; receivedAt: string | null } | null };
export type SupplierCoverageOverview = { definitions: SupplierCoverageDefinition[]; conflicts: SupplierCoverageConflict[]; uncovered: Array<{ templateId: string; templateName: string }> };

/** Everything the Brand overview needs: sources with their Families, conflicts between active sources, and active Families no active source covers. */
export async function supplierCoverageOverview(client: SupabaseClient, brandId: string): Promise<SupplierCoverageOverview> {
  const [summaries, templates, profiles, conflicts, versions] = await Promise.all([
    supplierSourceDefinitionsForBrand(client, brandId),
    supplierRows<{ id: string; template_name: string }>(client, "product_templates", "id,template_name", { brand_id: brandId, is_active: true }, "template_name"),
    supplierRows<{ id: string; title: string }>(client, "supplier_price_profiles", "id,title", { brand_id: brandId }),
    supplierSourceCoverageConflicts(client, { brandId }),
    supplierRows<{ definition_id: string | null }>(client, "supplier_source_versions", "definition_id", { brand_id: brandId }),
  ]);
  const usedDefinitionIds = new Set(versions.flatMap((version) => version.definition_id ? [version.definition_id] : []));
  const names = new Map(templates.map((template) => [template.id, template.template_name]));
  const definitions = await Promise.all(summaries.map(async (summary) => ({
    id: summary.id, name: summary.name, profileId: summary.profileId, profileTitle: profiles.find((profile) => profile.id === summary.profileId)?.title ?? null, isActive: summary.isActive, canDelete: !usedDefinitionIds.has(summary.id),
    families: (await definitionFamilies(client, summary.id)).flatMap((family) => names.has(family.template_id) ? [{ id: family.template_id, name: names.get(family.template_id)! }] : []).sort((a, b) => a.name.localeCompare(b.name)),
    latest: summary.latestSource ? { id: summary.latestSource.id, title: summary.latestSource.title, receivedAt: summary.latestSource.receivedAt } : null,
  })));
  const covered = new Set(definitions.filter((definition) => definition.isActive).flatMap((definition) => definition.families.map((family) => family.id)));
  return { definitions, conflicts, uncovered: templates.filter((template) => !covered.has(template.id)).map((template) => ({ templateId: template.id, templateName: template.template_name })) };
}

const friendlyDefinitionError = (error: unknown) => { const message = error instanceof Error ? error.message : "Could not save."; return Error(/duplicate key|unique/i.test(message) ? "A Supplier source with this name already exists for this Brand." : message); };
export async function supplierCreateSourceDefinition(client: SupabaseClient, brandId: string, name: string, profileId?: string | null) {
  if (!name.trim()) throw Error("Enter a Supplier source name.");
  try { return await supplierWrite(client, "definition", { brand_id: brandId, name: name.trim(), profile_id: profileId || null }); } catch (error) { throw friendlyDefinitionError(error); }
}
/** Definition metadata only: existing imported source titles and review history remain untouched. */
export async function supplierUpdateSourceDefinition(client: SupabaseClient, brandId: string, id: string, name?: string, isActive?: boolean) {
  if (name !== undefined && !name.trim()) throw Error("Enter a Supplier source name.");
  try { return await supplierWrite(client, "definition", { id, brand_id: brandId, ...(name !== undefined ? { name: name.trim() } : {}), ...(isActive !== undefined ? { is_active: isActive } : {}) }); } catch (error) { throw friendlyDefinitionError(error); }
}
/** The RPC re-checks all historical links; this helper never treats the UI's canDelete hint as authority. */
export async function supplierDeleteSourceDefinition(client: SupabaseClient, brandId: string, id: string) {
  return supplierWrite(client, "definition_delete", { id, brand_id: brandId });
}
export async function supplierConfirmCoverage(client: SupabaseClient, definitionId: string, templateIds: string[]) {
  return supplierWrite(client, "definition_coverage", { definition_id: definitionId, template_ids: [...new Set(templateIds)] });
}
export async function supplierLinkSourceDefinition(client: SupabaseClient, sourceId: string, definitionId: string | null) {
  return supplierWrite(client, "source_definition", { source_id: sourceId, definition_id: definitionId });
}
export async function supplierAssignFamilyToSource(client: SupabaseClient, definitionId: string, templateId: string) {
  const current = (await definitionFamilies(client, definitionId)).map((family) => family.template_id);
  return supplierConfirmCoverage(client, definitionId, [...current, templateId]);
}
/** The chosen source keeps the Family; every other active source gives it up. No priority logic and no automatic winner. */
export async function supplierResolveCoverageConflict(client: SupabaseClient, brandId: string, templateId: string, keepDefinitionId: string) {
  const conflict = (await supplierSourceCoverageConflicts(client, { brandId })).find((item) => item.templateId === templateId);
  if (!conflict || !conflict.definitions.some((definition) => definition.definitionId === keepDefinitionId)) throw Error("This Family is no longer in conflict.");
  for (const other of conflict.definitions.filter((definition) => definition.definitionId !== keepDefinitionId)) {
    const remaining = (await definitionFamilies(client, other.definitionId)).map((family) => family.template_id).filter((id) => id !== templateId);
    await supplierConfirmCoverage(client, other.definitionId, remaining);
  }
}

// ---- Phase 2I-4.1: one row per active Family for the bulk coverage setup table. Read-only; reuses the existing suggestion and overview. ----
export type SupplierFamilyCoverageRow = {
  templateId: string; templateName: string; mainCategory: string | null; subCategory: string | null;
  totalTargetCodes: number | null; foundTargetCodes: number | null; foundRatio: number | null; suggested: boolean;
  currentSources: Array<{ definitionId: string; definitionName: string }>;
};
/** Found/total comes from the reference source's extracted codes (null when no price list has been imported yet). Category names are the Product Library's own; nothing is inferred. */
export async function supplierFamilyCoverageSetup(client: SupabaseClient, brandId: string, referenceSourceId?: string | null): Promise<SupplierFamilyCoverageRow[]> {
  const [overview, templates, categories, suggestion] = await Promise.all([
    supplierCoverageOverview(client, brandId),
    supplierRows<{ id: string; template_name: string; main_category_id: string | null; sub_category_id: string | null }>(client, "product_templates", "id,template_name,main_category_id,sub_category_id", { brand_id: brandId, is_active: true }, "template_name"),
    supplierRows<{ id: string; name: string }>(client, "product_categories", "id,name", { brand_id: brandId }),
    referenceSourceId ? supplierSourceCoverageSuggestion(client, { brandId, sourceId: referenceSourceId }) : Promise.resolve(null),
  ]);
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const found = new Map((suggestion ?? []).map((row) => [row.templateId, row]));
  return templates.map((template) => {
    const evidence = found.get(template.id);
    return { templateId: template.id, templateName: template.template_name, mainCategory: template.main_category_id ? categoryName.get(template.main_category_id) ?? null : null, subCategory: template.sub_category_id ? categoryName.get(template.sub_category_id) ?? null : null,
      totalTargetCodes: evidence?.totalTargetCodes ?? null, foundTargetCodes: evidence?.foundTargetCodes ?? null, foundRatio: evidence?.foundRatio ?? null, suggested: evidence?.suggested ?? false,
      currentSources: overview.definitions.filter((definition) => definition.isActive && definition.families.some((family) => family.id === template.id)).map((definition) => ({ definitionId: definition.id, definitionName: definition.name })) };
  });
}

/** Bulk assignment composed from the existing writes: optionally create the source, then confirm its coverage as the current set plus the selection. */
export async function supplierAssignFamiliesToSource(client: SupabaseClient, brandId: string, target: { definitionId?: string; newName?: string; profileId?: string }, templateIds: string[]) {
  if (!templateIds.length) throw Error("Select at least one Family.");
  const definitionId = target.newName !== undefined ? (await supplierCreateSourceDefinition(client, brandId, target.newName, target.profileId)).id : target.definitionId;
  if (!definitionId) throw Error("Choose a Supplier source.");
  const current = (await definitionFamilies(client, definitionId)).map((family) => family.template_id);
  await supplierConfirmCoverage(client, definitionId, [...current, ...templateIds]);
  const name = (await supplierRows<{ name: string }>(client, "supplier_source_definitions", "name", { id: definitionId })).at(0)?.name ?? "this source";
  return { definitionId, name, count: new Set(templateIds).size };
}

// ---- Supplier capacity (read-only). The database function is System Owner-only and recomputes everything itself. ----
export type SupplierCapacityMember = { source_id: string; filename: string; title: string; status: string; created_at: string; classification: string; rows: number; cells: number; identities: number; chunks: number; chunk_payload_bytes: number; batches: number; review_batches: number; matches: number; review_units: number; decisions: number; decision_set: string[]; completed_batches: number; linked_source_definition: boolean; brand_bindings: number; working_reference: string | null; storage_shared: boolean; estimated_bytes: number };
export type SupplierCapacityReport = {
  generated_at: string; database_bytes: number; supplier_bytes: number;
  tables: Array<{ name: string; total_bytes: number; table_bytes: number; index_bytes: number; rows: number | null }>;
  protected_sources: Array<{ source_id: string; brand: string; filename: string; status: string; rows: number; reason: string }>;
  duplicate_groups: Array<{ brand: string; brand_id: string; file_hash: string; classification: string; canonical_source_id: string; members: SupplierCapacityMember[]; reclaimable_bytes: number }>;
  batches: Array<{ batch_id: string; source_id: string; status: string; scope: string; created_at: string; matches: number; match_chunk_payload_bytes: number; review_units: number; decisions: number; retention: string; estimated_bytes: number }>;
  compaction: { source_chunk_bytes: number; match_chunk_bytes: number };
  reclaimable: { duplicate_sources_bytes: number; superseded_batches_bytes: number; superseded_match_rows: number };
};
export async function supplierCapacityReport(client: SupabaseClient): Promise<SupplierCapacityReport> {
  const { data, error } = await client.rpc("supplier_capacity_report");
  if (error) throw Error(/permission|privilege/i.test(error.message) ? "Only the System Owner can view Supplier database capacity." : error.message);
  return data as SupplierCapacityReport;
}
/** Capacity diagnostics and future cleanup are System Owner-only; Supplier reviewers and approvers do not get them. */
export function canManageSupplierCapacity(role: string | null | undefined, accountStatus: string | null | undefined) { return role === "system_owner" && accountStatus === "active"; }

// ---- Phase E: previous price list lifecycle and source-row storage (database functions re-check every rule). ----
export type SupplierPreviousSource = { source_id: string; current_source_id: string; title: string; status: string; created_at: string; batches: number; protected_reviews: string[]; reasons: string[]; safe_to_delete: boolean; storage_shared: boolean; storage_object_candidate: string | null; rows: number };
export async function supplierPreviousSources(client: SupabaseClient, currentSourceId: string): Promise<SupplierPreviousSource[]> {
  const { data, error } = await client.rpc("supplier_previous_source_state", { p_current: currentSourceId });
  if (error) throw Error(error.message);
  return ((data as { previous?: SupplierPreviousSource[] } | null)?.previous ?? []);
}
export async function supplierDeletePreviousSource(client: SupabaseClient, currentSourceId: string, previousSourceId: string) {
  const { data, error } = await client.rpc("cleanup_previous_supplier_source", { p_current_source: currentSourceId, p_previous_source: previousSourceId, p_dry_run: false });
  if (error) throw Error(/review history that must be retained/.test(error.message) ? "This previous price list contains review history that must be retained." : error.message);
  return data as { deleted: Record<string, number>; storage_object_candidate: string | null };
}
export type SupplierSourceStorageRow = { source_id: string; title: string; status: string; created_at: string; definition: string | null; current_for_definition: boolean; rows: number; raw_extras_bytes: number; estimated_saving_bytes: number; compactable: boolean };
export async function supplierSourceStorage(client: SupabaseClient): Promise<SupplierSourceStorageRow[]> {
  const { data, error } = await client.rpc("supplier_capacity_source_storage");
  if (error) throw Error(error.message);
  return data as SupplierSourceStorageRow[];
}

// ---- Phase F1: provenance from identity evidence, and the read-only Supplier source lookup for a future Product cross-check. ----
type ProvenanceRow = { row_number: number; sheet: string; raw_extras: Record<string, unknown> };
/** Technical review provenance for one page of matches: embedded identity evidence first, source rows only for older identities. */
export async function supplierMatchProvenance(client: SupabaseClient, source: SourceVersion, matches: PriceMatch[]): Promise<Map<string, ProvenanceRow[]>> {
  const result = new Map<string, ProvenanceRow[]>();
  const keys = [...new Set(matches.flatMap((match) => match.source ? [match.source.key] : []))];
  if (!keys.length) return result;
  const identities = await client.from("supplier_source_identities").select("key,data").eq("source_id", source.id).in("key", keys).returns<Array<{ key: string; data: SourceIdentity }>>();
  if (identities.error) throw Error(identities.error.message);
  const evidence = new Map((identities.data ?? []).flatMap((row) => row.data.evidence?.length ? [[row.key, row.data.evidence] as const] : []));
  const asRow = (item: SupplierIdentityEvidence): ProvenanceRow => ({ row_number: item.row_number, sheet: item.sheet, raw_extras: { [source.profile.full_code_column]: item.full_supplier_code, ...(source.profile.description_column && item.description !== undefined ? { [source.profile.description_column]: item.description } : {}) } });
  for (const match of matches) if (match.source && evidence.has(match.source.key)) result.set(match.key, evidence.get(match.source.key)!.slice(0, 3).map(asRow));
  // Legacy identities (finalised before evidence existed): one bounded source-row query for this page, as before.
  const legacy = matches.filter((match) => match.source && !result.has(match.key));
  const rowKeys = [...new Set(legacy.flatMap((match) => match.source!.row_keys.slice(0, 3)))];
  if (rowKeys.length) {
    const rows = await client.from("supplier_source_rows").select("unit_key,row_number,sheet,raw_extras").eq("source_id", source.id).in("unit_key", rowKeys).order("unit_key").range(0, 149).returns<Array<ProvenanceRow & { unit_key: string }>>();
    if (rows.error) throw Error(rows.error.message);
    const byKey = new Map((rows.data ?? []).map((row) => [row.unit_key, row]));
    for (const match of legacy) result.set(match.key, match.source!.row_keys.slice(0, 3).flatMap((key) => byKey.has(key) ? [byKey.get(key)!] : []));
  }
  return result;
}

export type SupplierProductSourceLookup = {
  definition: { id: string; name: string; brand_id: string };
  source: { id: string; title: string; filename: string; status: string; currency: string; basis: string; effective_from: string | null; received_at: string | null } | null;
  code: string; multiplicity: number; ambiguous: boolean;
  identities: Array<Pick<SourceIdentity, "key" | "code" | "price" | "currency" | "price_field" | "dimension" | "raw_dimension" | "finishes" | "issues" | "companion_notes" | "source_row_count" | "evidence">>;
};
/**
 * Read-only: every identity with this manufacturer code in the current imported price list of one Supplier Source Definition.
 * Scoped by Brand + definition, so two sources of one Brand (Furniture, Chairs) never mix. Same comparison code as matching.
 */
export async function supplierProductSourceLookup(client: SupabaseClient, input: { brandId: string; definitionId: string; code: string }): Promise<SupplierProductSourceLookup> {
  const definition = (await supplierRows<{ id: string; name: string; brand_id: string }>(client, "supplier_source_definitions", "id,name,brand_id", { id: input.definitionId, brand_id: input.brandId, is_active: true })).at(0);
  if (!definition) throw Error("Supplier source unavailable for this Brand.");
  const normalized = normalizeManufacturerCode(input.code ?? ""); const wanted = comparisonCode(normalized);
  if (!wanted) throw Error("Enter a manufacturer code.");
  const versions = await supplierRows<SourceVersion & { created_at: string }>(client, "supplier_source_versions", "*", { brand_id: input.brandId, definition_id: definition.id, status: "imported" }, "created_at");
  const current = versions.at(-1);
  const empty = { definition: { id: definition.id, name: definition.name, brand_id: definition.brand_id }, code: normalized, multiplicity: 0, ambiguous: false, identities: [] };
  if (!current) return { ...empty, source: null };
  const found = await client.from("supplier_source_identities").select("key,code,data").eq("source_id", current.id).in("code", [...new Set([normalized, wanted])]).order("key").returns<Array<{ key: string; code: string; data: SourceIdentity }>>();
  if (found.error) throw Error(found.error.message);
  const identities = (found.data ?? []).filter((row) => comparisonCode(row.code) === wanted).map(({ data }) => ({ key: data.key, code: data.code, price: data.price, currency: data.currency, price_field: data.price_field, dimension: data.dimension,
    raw_dimension: data.raw_dimension, finishes: data.finishes, issues: data.issues, companion_notes: data.companion_notes, source_row_count: data.source_row_count ?? data.row_keys.length, evidence: data.evidence ?? [] }));
  return { ...empty, source: { id: current.id, title: current.title, filename: current.filename, status: current.status, currency: current.currency, basis: current.basis, effective_from: current.effective_from, received_at: current.received_at },
    multiplicity: identities.length, ambiguous: identities.length > 1, identities };
}
