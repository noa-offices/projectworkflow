"use server";

import { requireActiveUser } from "@/lib/auth";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import type { DurableBinding } from "@/lib/products/supplier-price-contracts";
import { buildPriceLines, type PriceLine } from "@/lib/products/supplier-price-lines";
import { resolveApplicableSupplierSourceVersion, supplierBrandMatches, supplierBusinessDate, supplierRows } from "@/lib/products/supplier-price-repository";
import { createClient } from "@/lib/supabase/server";

export type PriceLinesResult = { brandId: string; sources: Array<{ definitionName: string; title: string; effectiveFrom: string | null; lines: PriceLine[]; truncated: boolean }> };

/** Read-only: no batch, decision, binding or price is written (saving or removing a mapping uses the existing Price Updates actions). The role is checked again here. */
export async function supplierTemplatePriceLines(templateId: string): Promise<PriceLinesResult> {
  const { profile } = await requireActiveUser();
  if (!canApproveBrandPrices(profile?.role, profile?.account_status)) throw Error("Brand price approver permission required.");
  const client = await createClient();
  const template = (await supplierRows<{ id: string; brand_id: string }>(client, "product_templates", "id,brand_id", { id: templateId, is_active: true })).at(0);
  if (!template) throw Error("This product is unavailable.");
  const covered = new Set((await supplierRows<{ definition_id: string }>(client, "supplier_source_definition_families", "definition_id", { template_id: templateId }, "definition_id")).map((row) => row.definition_id));
  const [definitions, versions] = await Promise.all([
    supplierRows<{ id: string; name: string }>(client, "supplier_source_definitions", "id,name", { brand_id: template.brand_id, is_active: true }, "name"),
    supplierRows<{ id: string; title: string; status: string; effective_from: string | null; created_at: string; definition_id: string | null }>(client, "supplier_source_versions", "id,title,status,effective_from,created_at,definition_id", { brand_id: template.brand_id, status: "imported" }),
  ]);
  const bindings = await supplierRows<DurableBinding>(client, "supplier_price_bindings", "*", { brand_id: template.brand_id });
  const sources: PriceLinesResult["sources"] = [];
  for (const definition of definitions.filter((item) => covered.has(item.id))) {
    const current = resolveApplicableSupplierSourceVersion(versions.filter((version) => version.definition_id === definition.id), supplierBusinessDate());
    if (!current) continue;
    const { matches } = await supplierBrandMatches(client, current.id);
    sources.push({ definitionName: definition.name, title: current.title, effectiveFrom: current.effective_from, ...buildPriceLines(matches, templateId, bindings) });
  }
  return { brandId: template.brand_id, sources };
}
