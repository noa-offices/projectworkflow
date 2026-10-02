import type { SupabaseClient } from "@supabase/supabase-js";
import type { DimensionRule, DurableBinding, PriceMatch, ProductPriceInput, SourceIdentity, SourceVersion } from "./supplier-price-contracts";
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
