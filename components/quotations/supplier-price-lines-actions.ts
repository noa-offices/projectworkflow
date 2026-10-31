"use server";

import { requireActiveUser } from "@/lib/auth";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import type { DurableBinding, PriceMatch } from "@/lib/products/supplier-price-contracts";
import { buildPriceLines, type PriceLine } from "@/lib/products/supplier-price-lines";
import { resolveApplicableSupplierSourceVersion, supplierBrandMatches, supplierBusinessDate, supplierLatestTemplateChecks, supplierListTemplateFamilies, supplierMissingTemplateFamilies, supplierRows, supplierSourceFamilies } from "@/lib/products/supplier-price-repository";
import { findSourceReviewBatch } from "@/lib/products/supplier-replacement";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PriceLinesFamilies = {
  /** The families found in this price list, with how many identities carry each. Empty for lists without a family column. */
  families: Array<{ family: string; key: string; count: number }>;
  /** The families saved for this product in this price list type. */
  chosen: Array<{ family: string; key: string }>;
  /** Saved families that the current price list does not contain. */
  missing: Array<{ family: string; key: string }>;
};
export type PriceLinesResult = { brandId: string; sources: Array<{ definitionId: string; sourceId: string; definitionName: string; title: string; effectiveFrom: string | null; lines: PriceLine[]; truncated: boolean;
  /** The newest per-product sign-off for this price list: when, and whether the product's pricing version still matches it. Null when never checked. */
  check: { checkedAt: string; valid: boolean } | null } & PriceLinesFamilies> };

const applyLookupLimit = 40;
/**
 * Read only. A changed line can use the supplier price only when the open review (status "review") of this source holds the same line:
 * same key, still one target with the same product price, same supplier price. Otherwise there is no button.
 */
async function withApplyBatch(client: SupabaseClient, sourceId: string, built: { lines: PriceLine[]; truncated: boolean }) {
  const eligible = built.lines.filter((line) => line.apply);
  if (!eligible.length) return built;
  const review = await findSourceReviewBatch(client, sourceId);
  const batchId = review.state === "exists" && review.status === "review" ? review.batchId : null;
  if (!batchId) return built;
  const checked = new Map<string, boolean>();
  await Promise.all(eligible.slice(0, applyLookupLimit).map(async (line) => {
    const { data } = await client.from("supplier_price_matches").select("key,data").eq("batch_id", batchId).eq("key", line.apply!.matchKey).maybeSingle<{ key: string; data: PriceMatch }>();
    const stored = data?.data;
    checked.set(line.key, Boolean(stored && ["increased", "decreased", "changed"].includes(stored.classification) && stored.targets.length === 1 && stored.targets[0].key === line.apply!.targetKey
      && stored.targets[0].price === line.ourPrice && stored.source?.price === line.supplierPrice));
  }));
  return { ...built, lines: built.lines.map((line) => {
    if (!line.apply || !checked.has(line.key)) return line;
    if (!checked.get(line.key)) return { ...line, apply: undefined, applyHint: "old_review" as const };
    return { ...line, apply: { ...line.apply, batchId } };
  }) };
}

/** Read-only: no batch, decision, binding or price is written (saving or removing a mapping uses the existing Price Updates actions). The role is checked again here. */
export async function supplierTemplatePriceLines(templateId: string): Promise<PriceLinesResult> {
  const { profile } = await requireActiveUser();
  if (!canApproveBrandPrices(profile?.role, profile?.account_status)) throw Error("Brand price approver permission required.");
  const client = await createClient();
  const template = (await supplierRows<{ id: string; brand_id: string; pricing_version: number | string }>(client, "product_templates", "id,brand_id,pricing_version", { id: templateId, is_active: true })).at(0);
  if (!template) throw Error("This product is unavailable.");
  const covered = new Set((await supplierRows<{ definition_id: string }>(client, "supplier_source_definition_families", "definition_id", { template_id: templateId }, "definition_id")).map((row) => row.definition_id));
  const [definitions, versions] = await Promise.all([
    supplierRows<{ id: string; name: string }>(client, "supplier_source_definitions", "id,name", { brand_id: template.brand_id, is_active: true }, "name"),
    supplierRows<{ id: string; title: string; status: string; effective_from: string | null; created_at: string; definition_id: string | null }>(client, "supplier_source_versions", "id,title,status,effective_from,created_at,definition_id", { brand_id: template.brand_id, status: "imported" }),
  ]);
  const bindings = await supplierRows<DurableBinding>(client, "supplier_price_bindings", "*", { brand_id: template.brand_id });
  const checks = (await supplierLatestTemplateChecks(client, [template.brand_id])).filter((item) => item.template_id === templateId);
  const sources: PriceLinesResult["sources"] = [];
  for (const definition of definitions.filter((item) => covered.has(item.id))) {
    const current = resolveApplicableSupplierSourceVersion(versions.filter((version) => version.definition_id === definition.id), supplierBusinessDate());
    if (!current) continue;
    // Read only. Matching already uses the saved families of this definition (supplierBrandMatches loads them and hands them to the matcher).
    const [found, saved, absent] = await Promise.all([supplierSourceFamilies(client, current.id), supplierListTemplateFamilies(client, { definitionId: definition.id }), supplierMissingTemplateFamilies(client, definition.id, current.id)]);
    const families = found.map((item) => ({ family: item.family, key: item.family_key, count: item.identity_count }));
    const chosen = saved.filter((item) => item.template_id === templateId).map((item) => ({ family: item.family, key: item.family_key }));
    const missing = absent.filter((item) => item.template_id === templateId).map((item) => ({ family: item.family, key: item.family_key }));
    const { matches } = await supplierBrandMatches(client, current.id);
    const familyRequired = families.length > 0 && chosen.length === 0;
    sources.push({ definitionId: definition.id, sourceId: current.id, definitionName: definition.name, title: current.title, effectiveFrom: current.effective_from, families, chosen, missing,
      check: (() => { const newest = checks.filter((item) => item.source_id === current.id).sort((a, b) => b.checked_at.localeCompare(a.checked_at))[0]; return newest ? { checkedAt: newest.checked_at, valid: String(newest.pricing_version) === String(template.pricing_version) } : null; })(),
      ...(await withApplyBatch(client, current.id, buildPriceLines(matches, templateId, bindings, { familyRequired }))) });
  }
  return { brandId: template.brand_id, sources };
}
