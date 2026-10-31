"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import { supplierMarkTemplateChecked, supplierRows } from "@/lib/products/supplier-price-repository";
import { evaluateTemplateCheck } from "@/lib/products/supplier-template-check";
import { createClient } from "@/lib/supabase/server";
import { supplierTemplatePriceLines } from "./supplier-price-lines-actions";

/**
 * Marks ONE product as checked against ONE price list, without completing the brand-wide review. Nothing is trusted from the browser:
 * only the two ids arrive. The server rebuilds the live comparison with the same code as the Supplier price lines popup (family scope
 * included), refuses unless every line matches, and only then asks the database to record the sign-off. It changes no price, review
 * batch, decision or baseline.
 */
export async function markTemplateSupplierPriceChecked(templateId: string, sourceId: string): Promise<{ lineCount: number; message: string }> {
  if (typeof templateId !== "string" || !templateId || typeof sourceId !== "string" || !sourceId) throw Error("Choose the product and the price list.");
  const { profile } = await requireActiveUser();
  if (!canApproveBrandPrices(profile?.role, profile?.account_status)) throw Error("Brand price approver permission required.");
  const client = await createClient();
  // The version is read BEFORE the comparison is rebuilt: if the product is edited meanwhile, the database refuses the stale version.
  const template = (await supplierRows<{ id: string; pricing_version: number | string }>(client, "product_templates", "id,pricing_version", { id: templateId, is_active: true })).at(0);
  if (!template) throw Error("This product is unavailable.");
  const source = (await supplierTemplatePriceLines(templateId)).sources.find((item) => item.sourceId === sourceId);
  if (!source) throw Error("This is not the current price list for this product.");
  const verdict = evaluateTemplateCheck(source);
  if (!verdict.ok) throw Error(`Not marked as checked. ${verdict.blockers.join(" ")}`);
  await supplierMarkTemplateChecked(client, { definitionId: source.definitionId, sourceId, templateId, expectedPricingVersion: String(template.pricing_version), lineCount: verdict.lineCount, summary: verdict.summary });
  revalidatePath("/products/price-updates");
  revalidatePath("/products/templates");
  return { lineCount: verdict.lineCount, message: `All ${verdict.lineCount} lines match the supplier list. The product is marked as checked.` };
}
