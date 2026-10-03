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
  if (match.classification === "shared" || match.targets.length !== 1) throw Error("Phase 2A does not support shared or multiple-target Apply.");
  if (!["increased", "decreased", "changed"].includes(match.classification)) throw Error("Only changed Supplier prices may be applied.");
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
  const baseline = match.targets[0];
  if (baseline.brand_id !== batch.brand_id) throw Error("Supplier target does not belong to this Brand.");
  if (!["AED", "EUR", "USD"].includes(source.currency) || identity.currency !== source.currency) throw Error("Unsupported Supplier currency. Use AED, EUR, or USD.");
  if (source.currency !== baseline.currency) throw Error("Supplier and Product currencies must match before applying.");
  const { targets, templates } = await supplierBrandTargets(client, batch.brand_id);
  const current = targets.find((target) => target.key === baseline.key);
  const baselineFields = ["key", "brand_id", "template_id", "pricing_version", "price", "currency", "raw_code", "code", "architecture", "group_id", "row_id", "column_id", "physical_field", "price_field", "dimension"] as const;
  if (!current || baselineFields.some((field) => current[field] !== baseline[field]) || current.price === identity.price || expectedPricingVersion(current.pricing_version) === null) throw Error(freshSupplierComparison);
  const history = { brand_price_list_update_id: batch.brand_price_list_update_id ?? null, effective_from: source.effective_from ?? null,
    note: `Supplier source: ${source.title}; batch: ${batch.id}; match: ${match.key}` };
  let mode: "supplier_default" | "detail", payload: Record<string, unknown>, detail = {};
  if (current.architecture === "simple" && current.physical_field === "default_unit_price") {
    mode = "supplier_default"; payload = { default_unit_price: identity.price, currency: source.currency };
  } else {
    mode = "detail";
    if (current.architecture === "product_components") {
      if (current.physical_field !== "unit_price") throw Error("Unsupported Supplier component target.");
      payload = { unit_price: identity.price, currency: source.currency };
    } else {
      const template = templates.find((item) => item.id === current.template_id);
      if (!template) throw Error(freshSupplierComparison);
      payload = supplierDetailPayload(template, current, identity.price!);
    }
    detail = { source_table: current.architecture === "product_components" ? "product_components" : `product_templates.${current.architecture}`,
      source_record_id: current.row_id, price_field: current.physical_field === "prices" ? `prices.${current.column_id}` : current.physical_field,
      old_price: current.price, new_price: identity.price, currency: source.currency };
  }
  const { data, error } = await client.rpc("write_product_price_with_history_at_version", {
    p_template_id: current.template_id, p_expected_version: current.pricing_version, p_mode: mode, p_payload: payload, p_history: { ...history, ...detail },
  });
  if (error) throw Error(error.message.includes(pricingConflictMessage) ? freshSupplierComparison : error.message);
  return { pricing_version: data, message: "Price applied. Build a fresh comparison to continue reviewing this target." };
}
