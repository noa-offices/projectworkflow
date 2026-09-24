/**
 * GPC-2: a narrow, server-only loader for exactly ONE Product Library template plus its brand -
 * the minimum data GPC-1's pure `resolveProductConfigurationState()` needs. Never the whole
 * Product Library (that remains ProductLibrarySelector's own, separate server payload), never
 * linked-family child templates (deferred per GPC-0/GPC-1), never a second pricing/loader
 * architecture - this file only fetches and maps, GPC-1 stays the sole evaluator.
 */
import "server-only";

import { requireProductLibraryManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ProductConfigurationTemplateInput } from "./product-configuration-state";

// Fixed, narrow column list only - never select("*"). Identity fields per GPC-2 PART 3, plus the
// four configuration JSON columns GPC-1 consumes. Deliberately excludes images/image_settings/
// references/AI setup/audit fields - none of them are configuration-relevant.
const TEMPLATE_SELECT =
  "id,brand_id,template_code,template_name,internal_selection_name,item_code,description,default_specification,origin,supplier_name,unit_label,currency,default_unit_price,is_active,lifecycle_status,variant_pricing,category_pricing,accessory_pricing,desking_size_pricing";

// One brand, four fields only - never the full brands table.
const BRAND_SELECT = "id,name,origin,default_currency";

type TemplateRow = {
  id: string;
  brand_id: string;
  template_code: string | null;
  template_name: string;
  internal_selection_name: string | null;
  item_code: string | null;
  description: string | null;
  default_specification: string | null;
  origin: string | null;
  supplier_name: string | null;
  unit_label: string | null;
  currency: string;
  default_unit_price: number;
  is_active: boolean;
  lifecycle_status: "active" | "archived" | "discontinued" | null;
  variant_pricing: unknown;
  category_pricing: unknown;
  accessory_pricing: unknown;
  desking_size_pricing: unknown;
};

type BrandRow = {
  id: string;
  name: string;
  origin: string | null;
  default_currency: string | null;
};

export type ProductConfigurationTemplateLoadResult =
  | { ok: true; template: ProductConfigurationTemplateInput }
  | { ok: false; reason: "unauthorized" | "not_found" | "inactive" | "brand_missing" };

function isNextRedirectError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}

// PART 5: usable = is_active AND lifecycle_status === "active" - the exact same condition the
// existing "templates available to add to a quotation" query already applies
// (app/quotations/[id]/builder/page.tsx: .eq("is_active", true).eq("lifecycle_status", "active")).
// Not the more lenient fallback noa-product-capability.server.ts uses for read-only Q&A (where any
// existing template, active or not, may still be looked up) - GPC is a configure/act flow, the
// same kind of decision the builder page's own query already makes, so it reuses that semantics
// rather than inventing a third lifecycle policy.
function isUsableForConfiguration(template: Pick<TemplateRow, "is_active" | "lifecycle_status">): boolean {
  return template.is_active && template.lifecycle_status === "active";
}

// PART 6: DB row -> GPC-1 input, field renames only - no calculation, no normalization of the
// four JSON columns (passed through exactly as GPC-1/the existing selector already tolerate:
// null stays null, whatever shape is there stays as-is).
function mapToTemplateInput(template: TemplateRow, brandName: string | null): ProductConfigurationTemplateInput {
  return {
    id: template.id,
    templateName: template.template_name,
    internalSelectionName: template.internal_selection_name,
    itemCode: template.item_code,
    templateCode: template.template_code,
    supplierName: template.supplier_name,
    brandName,
    origin: template.origin,
    currency: template.currency,
    defaultUnitPrice: template.default_unit_price,
    defaultSpecification: template.default_specification,
    description: template.description,
    variantPricing: template.variant_pricing,
    categoryPricing: template.category_pricing,
    accessoryPricing: template.accessory_pricing,
    deskingSizePricing: template.desking_size_pricing,
  };
}

// PART 2: the same requireProductLibraryManager() gate the existing NOA Product/Price capabilities
// use, independently re-checked here - never trusted from the caller, never a profile/user id
// argument, never an admin/service-role client. PART 10: a typed result, never a throw for a
// normal not-found/inactive/missing-brand outcome - only an unrecovered auth redirect propagates
// (translated to {ok:false, reason:"unauthorized"} exactly like the existing NOA capabilities do).
export async function loadProductConfigurationTemplate(
  templateId: string,
): Promise<ProductConfigurationTemplateLoadResult> {
  try {
    await requireProductLibraryManager();
  } catch (error) {
    if (isNextRedirectError(error)) return { ok: false, reason: "unauthorized" };
    throw error;
  }

  const supabase = await createClient();

  // PART 3/9: exactly one template, by id - never an unbounded/library-wide query.
  const { data: template } = await supabase
    .from("product_templates")
    .select(TEMPLATE_SELECT)
    .eq("id", templateId)
    .maybeSingle<TemplateRow>();

  if (!template) return { ok: false, reason: "not_found" };
  if (!isUsableForConfiguration(template)) return { ok: false, reason: "inactive" };

  // PART 4/9: exactly one brand, by the template's own brand_id - never the full brands table.
  const { data: brand } = await supabase
    .from("brands")
    .select(BRAND_SELECT)
    .eq("id", template.brand_id)
    .maybeSingle<BrandRow>();

  if (!brand) return { ok: false, reason: "brand_missing" };

  return { ok: true, template: mapToTemplateInput(template, brand.name) };
}
