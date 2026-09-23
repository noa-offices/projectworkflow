import "server-only";

import { requireProductLibraryManager } from "@/lib/auth";
import type { NoaCapabilityResult, NoaPageContext } from "@/lib/noa/noa-types";
import { createClient } from "@/lib/supabase/server";

const MAX_RESULTS = 5;
// PART 3: broad list results are hard-capped independently of the small exact/partial-match path.
const BROAD_LIST_LIMIT = 20;

// Fixed, narrow column list only - never select("*"), never an unrestricted/model-built query.
const TEMPLATE_SELECT =
  "id,brand_id,template_code,template_name,internal_selection_name,item_code,description,origin,supplier_name,unit_label,currency,default_unit_price,is_active,lifecycle_status,last_price_checked_at,material_suggestions";

// Broad list/count queries additionally need the category link columns to filter - a separate
// select from TEMPLATE_SELECT so the existing exact/partial-match detail path is untouched.
const BROAD_TEMPLATE_SELECT = `${TEMPLATE_SELECT},main_category_id,sub_category_id`;

type TemplateRow = {
  brand_id: string;
  currency: string;
  default_unit_price: number;
  description: string | null;
  id: string;
  internal_selection_name: string | null;
  is_active: boolean;
  item_code: string | null;
  last_price_checked_at: string | null;
  lifecycle_status: "active" | "archived" | "discontinued" | null;
  material_suggestions: unknown;
  origin: string | null;
  supplier_name: string | null;
  template_code: string | null;
  template_name: string;
  unit_label: string;
};

type BroadTemplateRow = TemplateRow & {
  main_category_id: string | null;
  sub_category_id: string | null;
};

type BrandRow = { id: string; name: string };
type CategoryRow = { brand_id: string; id: string; name: string; parent_id: string | null };

function lifecycleLabel(template: Pick<TemplateRow, "is_active" | "lifecycle_status">) {
  if (template.lifecycle_status === "archived" || template.lifecycle_status === "discontinued") {
    return template.lifecycle_status;
  }
  return template.is_active ? "active" : "archived";
}

function templateSummary(template: TemplateRow, brandName: string | null, linkedFamilyCount?: number) {
  return {
    id: template.id,
    name: template.internal_selection_name?.trim() || template.template_name,
    templateCode: template.template_code,
    itemCode: template.item_code,
    brand: brandName,
    origin: template.origin,
    supplierName: template.supplier_name,
    unitPrice: template.default_unit_price,
    currency: template.currency,
    unitLabel: template.unit_label,
    lifecycleStatus: lifecycleLabel(template),
    lastPriceCheckedAt: template.last_price_checked_at,
    hasMaterialGuidance: Boolean(template.material_suggestions),
    ...(typeof linkedFamilyCount === "number" ? { linkedFamilyCount } : {}),
  };
}

// A this-is-not-NLP heuristic on purpose: Phase 1B routing is deterministic, not a second LLM
// call, so the product search term is just "the message minus common question wording."
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "what", "whats", "who", "which", "for", "of",
  "in", "on", "at", "to", "me", "please", "can", "you", "tell", "find", "show", "about", "this",
  "that", "product", "template", "supplier", "code", "brand", "origin", "finish", "material",
  "linked", "family", "families", "archived", "discontinued", "model", "accessory", "and", "or",
]);

function extractSearchTerm(message: string): string | null {
  const tokens = message
    .toLowerCase()
    .replace(/[?!.,]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !STOPWORDS.has(token));
  const term = tokens.join(" ").trim();
  return term.length >= 2 ? term : null;
}

// PART 1: deterministic classification only (no LLM). Mirrors the existing
// quotationQuestionKind() pattern in noa-quotation-capability.server.ts.
type ProductQuestionKind = "count" | "detail" | "list";

function productQuestionKind(message: string): ProductQuestionKind {
  const normalized = message.toLowerCase();
  if (/\b(how many|count|number of)\b/.test(normalized)) return "count";
  if (/\b(show|list|all|which)\b/.test(normalized)) return "list";
  return "detail";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A name (brand or category) "matches" a message when either the exact name, or its simple
// plural/singular counterpart, appears as a whole phrase - so a DB category named "Chair" matches
// a user typing "chairs" and vice versa, without inventing any alias that isn't tied to real data.
function messageMatchesName(normalizedMessage: string, name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (!lower) return false;
  const variant = lower.endsWith("s") ? lower.slice(0, -1) : `${lower}s`;
  return new RegExp(`\\b${escapeRegExp(lower)}\\b`).test(normalizedMessage)
    || new RegExp(`\\b${escapeRegExp(variant)}\\b`).test(normalizedMessage);
}

type LifecycleFilter = "active" | "archived" | "discontinued";

// PART 2: only the three real lifecycle values already used elsewhere in this file - no new
// lifecycle states invented.
function detectLifecycleFilter(normalizedMessage: string): LifecycleFilter | null {
  if (/\barchived\b/.test(normalizedMessage)) return "archived";
  if (/\bdiscontinued\b/.test(normalizedMessage)) return "discontinued";
  if (/\b(active|current)\b/.test(normalizedMessage)) return "active";
  return null;
}

function lifecycleWord(filter: LifecycleFilter | null) {
  return filter === "active" ? "active" : filter;
}

async function matchedBrandFor(supabase: Awaited<ReturnType<typeof createClient>>, normalizedMessage: string, contextBrandId?: string) {
  const { data } = await supabase.from("brands").select("id,name").returns<BrandRow[]>();
  const brands = data ?? [];
  const textMatch = brands.find((brand) => messageMatchesName(normalizedMessage, brand.name));
  if (textMatch) return textMatch;
  if (contextBrandId) return brands.find((brand) => brand.id === contextBrandId) ?? null;
  return null;
}

async function matchedCategoryFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  normalizedMessage: string,
  brandId: string | null,
) {
  let query = supabase.from("product_categories").select("id,brand_id,name,parent_id").eq("is_active", true);
  if (brandId) query = query.eq("brand_id", brandId);
  const { data } = await query.returns<CategoryRow[]>();
  const categories = data ?? [];
  const matches = categories.filter((category) => messageMatchesName(normalizedMessage, category.name));
  return matches.length ? matches : null;
}

function productResultPhrase(brand: BrandRow | null, categories: CategoryRow[] | null, lifecycle: LifecycleFilter | null) {
  const parts: string[] = [];
  if (lifecycle) parts.push(lifecycleWord(lifecycle) ?? "");
  if (brand) parts.push(brand.name);
  parts.push(categories?.length === 1 ? categories[0].name.toLowerCase() : "product");
  return parts.filter(Boolean).join(" ");
}

// PART 1/3/4: broad list/count path - always deterministic filtering + counting, always bounded,
// always emits deterministicText the provider may rephrase but never recompute.
async function fetchBroadProductResult(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
  context: NoaPageContext,
  kind: "count" | "list",
): Promise<NoaCapabilityResult> {
  const normalizedMessage = message.toLowerCase();
  const brand = await matchedBrandFor(supabase, normalizedMessage, context.brandId);
  const categories = await matchedCategoryFor(supabase, normalizedMessage, brand?.id ?? null);
  const lifecycle = detectLifecycleFilter(normalizedMessage);

  let countQuery = supabase.from("product_templates").select("id", { count: "exact", head: true });
  let rowsQuery = supabase.from("product_templates").select(BROAD_TEMPLATE_SELECT);

  if (brand) {
    countQuery = countQuery.eq("brand_id", brand.id);
    rowsQuery = rowsQuery.eq("brand_id", brand.id);
  }
  if (categories?.length) {
    const mainIds = categories.filter((category) => category.parent_id === null).map((category) => category.id);
    const subIds = categories.filter((category) => category.parent_id !== null).map((category) => category.id);
    const filterParts = [
      ...(mainIds.length ? [`main_category_id.in.(${mainIds.join(",")})`] : []),
      ...(subIds.length ? [`sub_category_id.in.(${subIds.join(",")})`] : []),
    ];
    if (filterParts.length) {
      countQuery = countQuery.or(filterParts.join(","));
      rowsQuery = rowsQuery.or(filterParts.join(","));
    }
  }
  // Mirrors normalizeTemplateLifecycleStatus's fallback (lifecycle_status, falling back to
  // is_active when lifecycle_status is unset) rather than inventing a new rule. Applied inline
  // (not via a shared helper) since the Supabase query-builder return type differs per call site.
  if (lifecycle === "discontinued") {
    countQuery = countQuery.eq("lifecycle_status", "discontinued");
    rowsQuery = rowsQuery.eq("lifecycle_status", "discontinued");
  } else if (lifecycle === "archived") {
    countQuery = countQuery.or("lifecycle_status.eq.archived,and(lifecycle_status.is.null,is_active.eq.false)");
    rowsQuery = rowsQuery.or("lifecycle_status.eq.archived,and(lifecycle_status.is.null,is_active.eq.false)");
  } else if (lifecycle === "active") {
    countQuery = countQuery.eq("is_active", true).or("lifecycle_status.eq.active,lifecycle_status.is.null");
    rowsQuery = rowsQuery.eq("is_active", true).or("lifecycle_status.eq.active,lifecycle_status.is.null");
  }

  const { count } = await countQuery;
  const totalMatching = count ?? 0;
  const phrase = productResultPhrase(brand, categories, lifecycle);
  const sourceLabel = "Checked Product Library";

  if (kind === "count") {
    return {
      data: {
        kind: "product_count",
        totalMatching,
        filters: { brand: brand?.name ?? null, categories: categories?.map((category) => category.name) ?? null, lifecycle },
        deterministicText: `There ${totalMatching === 1 ? "is" : "are"} ${totalMatching} ${phrase} template${totalMatching === 1 ? "" : "s"}.`,
      },
      ok: true,
      sources: [{ label: sourceLabel, type: "product_template" }],
    };
  }

  if (totalMatching === 0) {
    return {
      data: {
        kind: "product_list",
        totalMatching: 0,
        returnedCount: 0,
        truncatedCount: 0,
        rows: [],
        filters: { brand: brand?.name ?? null, categories: categories?.map((category) => category.name) ?? null, lifecycle },
        deterministicText: `I found no ${phrase} templates.`,
      },
      ok: true,
      sources: [{ label: sourceLabel, type: "product_template" }],
    };
  }

  const { data: templates } = await rowsQuery
    .order("template_name", { ascending: true })
    .limit(BROAD_LIST_LIMIT)
    .returns<BroadTemplateRow[]>();
  const rows = templates ?? [];
  const brandNames = await brandNamesFor(supabase, rows.map((template) => template.brand_id));
  const truncatedCount = Math.max(0, totalMatching - rows.length);

  return {
    data: {
      kind: "product_list",
      totalMatching,
      returnedCount: rows.length,
      truncatedCount,
      rows: rows.map((template) => templateSummary(template, brandNames.get(template.brand_id) ?? null)),
      filters: { brand: brand?.name ?? null, categories: categories?.map((category) => category.name) ?? null, lifecycle },
      deterministicText: `I found ${totalMatching} ${phrase} template${totalMatching === 1 ? "" : "s"}.${truncatedCount > 0 ? ` Showing ${rows.length}.` : ""}`,
    },
    ok: true,
    sources: rows.map((template) => ({ label: sourceLabel, recordId: template.id, type: "product_template" })),
  };
}

function isNextRedirectError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}

const UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "I don't have access to that ProjectWorkflow area with your current permissions.",
  ok: false,
  reason: "unauthorized",
};

export async function fetchNoaProductCapability(
  message: string,
  context: NoaPageContext,
): Promise<NoaCapabilityResult> {
  // Defense-in-depth: the API route already confirmed the caller is signed in, but the product
  // domain's own authorization is re-checked here independently, exactly like the real Product
  // Management page does before showing this data.
  try {
    await requireProductLibraryManager();
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const supabase = await createClient();

  // A broad list/count question ("show all chairs", "how many chairs") is never about the single
  // template currently on screen - dispatch it before the specific-template short-circuit below,
  // mirroring how the Quotation capability already prioritizes aggregate questions over the
  // current-record context (see quotationQuestionKind() in noa-quotation-capability.server.ts).
  const questionKind = productQuestionKind(message);
  if (questionKind !== "detail") {
    return fetchBroadProductResult(supabase, message, context, questionKind);
  }

  if (context.productTemplateId) {
    const { data: template } = await supabase
      .from("product_templates")
      .select(TEMPLATE_SELECT)
      .eq("id", context.productTemplateId)
      .maybeSingle<TemplateRow>();

    if (template) {
      const [brandName, linkedFamilyCount] = await Promise.all([
        brandNameFor(supabase, template.brand_id),
        linkedFamilyCountFor(supabase, template.id),
      ]);

      return {
        data: [templateSummary(template, brandName, linkedFamilyCount)],
        ok: true,
        sources: [{ label: "Checked Product Library", recordId: template.id, type: "product_template" }],
      };
    }
  }

  const searchTerm = extractSearchTerm(message);
  if (!searchTerm) {
    return {
      message: "I couldn't understand that ProjectWorkflow request. Try asking about a product, quotation, or price status.",
      ok: false,
      reason: "ambiguous",
    };
  }

  const escapedTerm = searchTerm.replace(/[%,]/g, "");
  const { data: templates } = await supabase
    .from("product_templates")
    .select(TEMPLATE_SELECT)
    .or(
      `template_name.ilike.%${escapedTerm}%,internal_selection_name.ilike.%${escapedTerm}%,template_code.ilike.%${escapedTerm}%,item_code.ilike.%${escapedTerm}%,supplier_name.ilike.%${escapedTerm}%`,
    )
    .limit(MAX_RESULTS)
    .returns<TemplateRow[]>();

  if (!templates?.length) {
    return {
      message: "I couldn't find a matching product in the Product Library.",
      ok: false,
      reason: "not_found",
    };
  }

  const brandNames = await brandNamesFor(supabase, templates.map((template) => template.brand_id));

  return {
    data: templates.map((template) => templateSummary(template, brandNames.get(template.brand_id) ?? null)),
    ok: true,
    sources: templates.map((template) => ({
      label: "Checked Product Library",
      recordId: template.id,
      type: "product_template",
    })),
  };
}

async function brandNameFor(supabase: Awaited<ReturnType<typeof createClient>>, brandId: string) {
  const names = await brandNamesFor(supabase, [brandId]);
  return names.get(brandId) ?? null;
}

async function brandNamesFor(supabase: Awaited<ReturnType<typeof createClient>>, brandIds: string[]) {
  const uniqueIds = Array.from(new Set(brandIds));
  if (!uniqueIds.length) return new Map<string, string>();

  const { data } = await supabase
    .from("brands")
    .select("id,name")
    .in("id", uniqueIds)
    .returns<Array<{ id: string; name: string }>>();

  return new Map((data ?? []).map((brand) => [brand.id, brand.name]));
}

async function linkedFamilyCountFor(supabase: Awaited<ReturnType<typeof createClient>>, templateId: string) {
  const { count } = await supabase
    .from("product_template_linked_families")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .or(`parent_template_id.eq.${templateId},linked_template_id.eq.${templateId}`);

  return count ?? 0;
}
