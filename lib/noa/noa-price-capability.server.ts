import "server-only";

import { requireProductLibraryManager } from "@/lib/auth";
import {
  brandPriceBaselineDate,
  latestBrandPriceListUpdate,
  productTemplatePriceCheckState,
  type ProductPriceCheckState,
} from "@/lib/product-price-check";
import type { NoaSemanticProduct } from "@/lib/noa/noa-semantic-request";
import type { NoaCapabilityResult, NoaPageContext } from "@/lib/noa/noa-types";
import { createClient } from "@/lib/supabase/server";

const TEMPLATE_SELECT = "id,template_name,internal_selection_name,brand_id,created_at,last_price_checked_at,price_check_interval_days";
// PART 9: broad scans additionally need the category link columns to filter, plus a hard cap on
// how many templates are ever evaluated in one request.
const BROAD_TEMPLATE_SELECT = `${TEMPLATE_SELECT},main_category_id,sub_category_id`;
const BROAD_SCAN_LIMIT = 100;
const PRICE_LIST_DISPLAY_LIMIT = 20;

type PriceStatusKey = ProductPriceCheckState["key"];

type TemplateRow = {
  brand_id: string;
  created_at: string | null;
  id: string;
  internal_selection_name: string | null;
  last_price_checked_at: string | null;
  price_check_interval_days: number | null;
  template_name: string;
};

type BroadTemplateRow = TemplateRow & {
  main_category_id: string | null;
  sub_category_id: string | null;
};

type BrandRow = {
  code: string | null;
  id: string;
  last_price_list_checked_at: string | null;
  name: string;
};

type CategoryRow = { brand_id: string; id: string; name: string; parent_id: string | null };

type BrandPriceListUpdateRow = {
  created_at: string | null;
  effective_from: string | null;
  received_at: string | null;
  status: string;
  title: string | null;
};

// Broad scans evaluate templates across multiple brands at once, so (unlike the single-brand
// detail-path query above) this variant needs brand_id back to group updates per brand.
type BroadBrandPriceListUpdateRow = BrandPriceListUpdateRow & { brand_id: string };

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

const NOT_ENOUGH_INFO_RESULT: NoaCapabilityResult = {
  message: "I couldn't find enough product information to check the price status.",
  ok: false,
  reason: "not_found",
};

function formatDate(value: string | null) {
  if (!value) return "Not set";
  const time = new Date(value);
  return Number.isFinite(time.getTime())
    ? time.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "Not set";
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "for", "of", "in", "on", "at", "to", "me", "please", "what",
  "whats", "price", "pricing", "status", "check", "checked", "current", "due", "needs", "list",
  "this", "product", "template",
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

// PART 7: deterministic classification only (no LLM). Mirrors quotationQuestionKind() /
// productQuestionKind() in the sibling capability files.
type PriceQuestionKind = "detail" | "list" | "summary";

function priceQuestionKind(message: string): PriceQuestionKind {
  const normalized = message.toLowerCase();
  if (/\b(summarize|summary|overall|every|all|how many|count|number of)\b/.test(normalized)) return "summary";
  if (/\b(which|show|list)\b/.test(normalized)) return "list";
  return "detail";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A name (brand or category) "matches" a message when either the exact name, or its simple
// plural/singular counterpart, appears as a whole phrase - tied to real DB names only, never an
// invented alias.
function messageMatchesName(normalizedMessage: string, name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (!lower) return false;
  const variant = lower.endsWith("s") ? lower.slice(0, -1) : `${lower}s`;
  return new RegExp(`\\b${escapeRegExp(lower)}\\b`).test(normalizedMessage)
    || new RegExp(`\\b${escapeRegExp(variant)}\\b`).test(normalizedMessage);
}

function messageMatchesCode(normalizedMessage: string, code: string | null): boolean {
  const normalizedCode = code?.trim().toLowerCase();
  return Boolean(normalizedCode && new RegExp(`\\b${escapeRegExp(normalizedCode)}\\b`).test(normalizedMessage));
}

function uniqueFirstTokenBrand(brands: BrandRow[], normalizedMessage: string): BrandRow | null {
  const matches = brands.filter((brand) => {
    const firstToken = brand.name.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    return firstToken.length >= 3 && new RegExp(`\\b${escapeRegExp(firstToken)}\\b`).test(normalizedMessage);
  });
  return matches.length === 1 ? matches[0] : null;
}

async function matchedBrandFor(supabase: Awaited<ReturnType<typeof createClient>>, normalizedMessage: string, contextBrandId?: string, brandText?: string) {
  const { data } = await supabase.from("brands").select("id,name,code").returns<BrandRow[]>();
  const brands = data ?? [];
  const text = (brandText ?? normalizedMessage).trim().toLowerCase();
  const exactCode = brands.find((brand) => brand.code?.trim().toLowerCase() === text);
  if (exactCode) return exactCode;
  const exactName = brands.find((brand) => brand.name.trim().toLowerCase() === text);
  if (exactName) return exactName;
  const codeMatch = brands.find((brand) => messageMatchesCode(text, brand.code));
  if (codeMatch) return codeMatch;
  const nameMatch = brands.find((brand) => messageMatchesName(text, brand.name));
  if (nameMatch) return nameMatch;
  const firstTokenMatch = uniqueFirstTokenBrand(brands, text);
  if (firstTokenMatch) return firstTokenMatch;
  if (contextBrandId) return brands.find((brand) => brand.id === contextBrandId) ?? null;
  return null;
}

async function matchedCategoryFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  normalizedMessage: string,
  brandId: string | null,
  categoryText?: string,
) {
  let query = supabase.from("product_categories").select("id,brand_id,name,parent_id").eq("is_active", true);
  if (brandId) query = query.eq("brand_id", brandId);
  const { data } = await query.returns<CategoryRow[]>();
  const categories = data ?? [];
  const matches = categories.filter((category) => messageMatchesName((categoryText ?? normalizedMessage).toLowerCase(), category.name));
  return matches.length ? matches : null;
}

// Authoritative statuses only - the exact key union productTemplatePriceCheckState() already
// returns (lib/product-price-check.ts). No new state is invented; an alias that isn't provably
// one of these keys is simply never detected.
const STATUS_ALIASES: ReadonlyArray<{ key: PriceStatusKey; pattern: RegExp }> = [
  { key: "needs_check", pattern: /\bneeds?[\s-]?check(ing)?\b/ },
  { key: "due", pattern: /\bdue\b/ },
  { key: "checked", pattern: /\bchecked\b/ },
  { key: "no_price_list_date", pattern: /\bno price list\b/ },
  { key: "scheduled", pattern: /\bscheduled\b/ },
  { key: "current", pattern: /\bcurrent\b/ },
];

function detectStatusAlias(normalizedMessage: string): PriceStatusKey | null {
  return STATUS_ALIASES.find(({ pattern }) => pattern.test(normalizedMessage))?.key ?? null;
}

const STATUS_WORD: Record<PriceStatusKey, string> = {
  checked: "recently checked",
  current: "current",
  due: "due for a check",
  needs_check: "needing a check",
  no_price_list_date: "with no price list date on record",
  scheduled: "scheduled",
};

const STATUS_ORDER: readonly PriceStatusKey[] = ["current", "needs_check", "due", "scheduled", "checked", "no_price_list_date"];

function priceResultPhrase(brand: BrandRow | { name: string } | null, categories: CategoryRow[] | null) {
  const parts: string[] = [];
  if (brand) parts.push(brand.name);
  parts.push(categories?.length === 1 ? categories[0].name.toLowerCase() : "product");
  return parts.join(" ");
}

// PART 7/8/9: broad price list/summary path. Requires at least one narrowing filter (brand or
// category), hard-caps the scan at BROAD_SCAN_LIMIT, and always aggregates in code by calling
// productTemplatePriceCheckState() per template - never a reimplementation of its rules.
async function fetchBroadPriceResult(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
  context: NoaPageContext,
  kind: "list" | "summary",
  product?: NoaSemanticProduct,
): Promise<NoaCapabilityResult> {
  const normalizedMessage = message.toLowerCase();
  const brand = await matchedBrandFor(supabase, normalizedMessage, context.brandId, product?.brandText);
  const categories = await matchedCategoryFor(supabase, normalizedMessage, brand?.id ?? null, product?.categoryText);

  if (!brand && !categories) {
    return {
      message: "To check price status broadly, tell me a brand or category - for example \"which LAS products are due\" or \"summarize chair price status\".",
      ok: false,
      reason: "ambiguous",
    };
  }

  let query = supabase.from("product_templates").select(BROAD_TEMPLATE_SELECT, { count: "exact" });
  if (brand) query = query.eq("brand_id", brand.id);
  if (categories?.length) {
    const mainIds = categories.filter((category) => category.parent_id === null).map((category) => category.id);
    const subIds = categories.filter((category) => category.parent_id !== null).map((category) => category.id);
    const filterParts = [
      ...(mainIds.length ? [`main_category_id.in.(${mainIds.join(",")})`] : []),
      ...(subIds.length ? [`sub_category_id.in.(${subIds.join(",")})`] : []),
    ];
    if (filterParts.length) query = query.or(filterParts.join(","));
  }

  const { data, count } = await query
    .order("template_name", { ascending: true })
    .limit(BROAD_SCAN_LIMIT)
    .returns<BroadTemplateRow[]>();
  const templates = data ?? [];
  const totalMatching = count ?? templates.length;
  // Never silently extrapolate beyond what was actually scanned - only ever evaluate the bounded,
  // stably-ordered set actually returned, and say so when more matched than were scanned.
  const scanCapped = totalMatching > templates.length;
  const phrase = priceResultPhrase(brand, categories);
  const sourceLabel = "Checked product price status";
  const capNote = scanCapped ? ` (showing price status for the first ${templates.length} of ${totalMatching} matching templates)` : "";

  if (!templates.length) {
    return {
      data: { kind: "price_summary", counts: [], deterministicText: `I found no ${phrase} templates to check price status for.`, scanCapped: false, scannedCount: 0, totalMatching: 0 },
      ok: true,
      sources: [{ label: sourceLabel, type: "price_status" }],
    };
  }

  const brandIds = Array.from(new Set(templates.map((template) => template.brand_id)));
  const [{ data: brandRows }, { data: updateRows }] = await Promise.all([
    supabase.from("brands").select("id,name,last_price_list_checked_at").in("id", brandIds).returns<BrandRow[]>(),
    supabase
      .from("brand_price_list_updates")
      .select("brand_id,title,effective_from,received_at,created_at,status")
      .in("brand_id", brandIds)
      .in("status", ["draft", "active"])
      .returns<BroadBrandPriceListUpdateRow[]>(),
  ]);
  const brandsById = new Map((brandRows ?? []).map((row) => [row.id, row]));
  const updatesByBrand = new Map<string, BroadBrandPriceListUpdateRow[]>();
  for (const update of updateRows ?? []) {
    updatesByBrand.set(update.brand_id, [...(updatesByBrand.get(update.brand_id) ?? []), update]);
  }

  const evaluated = templates.map((template) => {
    const brandRow = brandsById.get(template.brand_id);
    const latestUpdate = latestBrandPriceListUpdate(updatesByBrand.get(template.brand_id) ?? []);
    const baseline = brandPriceBaselineDate({
      fallbackCheckedAt: brandRow?.last_price_list_checked_at ?? null,
      latestBrandPriceListUpdate: latestUpdate,
    });
    // Reuses the exact same status calculation the Product Management price badges use - never
    // reimplemented here, called once per evaluated template.
    const status = productTemplatePriceCheckState({
      brandPriceBaselineAt: baseline,
      formatDate,
      latestBrandPriceListUpdate: latestUpdate,
      template,
    });
    return { status, template };
  });

  if (kind === "list") {
    const statusKey = detectStatusAlias(normalizedMessage);
    const matching = statusKey ? evaluated.filter((entry) => entry.status.key === statusKey) : evaluated;
    const rows = matching.slice(0, PRICE_LIST_DISPLAY_LIMIT).map(({ status, template }) => ({
      name: template.internal_selection_name?.trim() || template.template_name,
      statusKey: status.key,
      statusLabel: status.label,
      templateId: template.id,
    }));
    const truncatedCount = Math.max(0, matching.length - rows.length);
    const statusWord = statusKey ? ` ${STATUS_WORD[statusKey]}` : "";

    return {
      data: {
        kind: "price_list",
        returnedCount: rows.length,
        rows,
        scanCapped,
        totalMatching: matching.length,
        truncatedCount,
        deterministicText: `I found ${matching.length} ${phrase} template${matching.length === 1 ? "" : "s"}${statusWord}.${truncatedCount > 0 ? ` Showing ${rows.length}.` : ""}${capNote}`,
      },
      ok: true,
      sources: rows.map((row) => ({ label: sourceLabel, recordId: row.templateId, type: "price_status" })),
    };
  }

  const counts = new Map<PriceStatusKey, number>();
  for (const { status } of evaluated) {
    counts.set(status.key, (counts.get(status.key) ?? 0) + 1);
  }
  const summaryParts = STATUS_ORDER.filter((key) => counts.get(key)).map((key) => `${counts.get(key)} ${STATUS_WORD[key]}`);

  return {
    data: {
      kind: "price_summary",
      counts: STATUS_ORDER.filter((key) => counts.get(key)).map((key) => ({ count: counts.get(key) ?? 0, statusKey: key })),
      scanCapped,
      scannedCount: evaluated.length,
      totalMatching,
      deterministicText: `Checked ${evaluated.length} ${phrase} template${evaluated.length === 1 ? "" : "s"}: ${summaryParts.join(", ")}.${capNote}`,
    },
    ok: true,
    sources: [{ label: sourceLabel, type: "price_status" }],
  };
}

export async function fetchNoaPriceCapability(
  message: string,
  context: NoaPageContext,
  options?: { product?: NoaSemanticProduct },
): Promise<NoaCapabilityResult> {
  // Defense-in-depth: independently re-checked here, reusing the same gate the real price-status
  // UI (Product Management) already requires, not trusted from the route-level auth check.
  try {
    await requireProductLibraryManager();
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const supabase = await createClient();

  // A broad list/summary question ("which LAS products are due", "summarize chair price status")
  // is never about a single quotation's saved price - dispatch it before the quotation-snapshot
  // guard below, mirroring how the Product capability already prioritizes aggregate questions
  // over the current-record context.
  const questionKind = priceQuestionKind(message);
  if (questionKind !== "detail") {
    return fetchBroadPriceResult(supabase, message, context, questionKind, options?.product);
  }

  // A quotation's saved price is a fixed historical snapshot, never the live current price - if
  // the user is asking about a quotation's price with no specific product template in view,
  // explain the distinction instead of silently treating the snapshot as live.
  if (context.quotationId && !context.productTemplateId) {
    return {
      message:
        "A quotation's saved price is a fixed snapshot from when it was quoted, not the live current price. Ask me about the quotation itself for its saved total, or name a specific product to check its current live price status.",
      ok: false,
      reason: "ambiguous",
    };
  }

  let template: TemplateRow | null = null;

  if (context.productTemplateId) {
    const { data } = await supabase
      .from("product_templates")
      .select(TEMPLATE_SELECT)
      .eq("id", context.productTemplateId)
      .maybeSingle<TemplateRow>();
    template = data;
  }

  if (!template) {
    const searchTerm = options?.product?.productText ?? extractSearchTerm(message);
    if (!searchTerm) {
      return NOT_ENOUGH_INFO_RESULT;
    }

    const escapedTerm = searchTerm.replace(/[%,]/g, "");
    const { data } = await supabase
      .from("product_templates")
      .select(TEMPLATE_SELECT)
      .or(`template_name.ilike.%${escapedTerm}%,internal_selection_name.ilike.%${escapedTerm}%`)
      .limit(options?.product?.productText ? 2 : 1)
      .returns<TemplateRow[]>();
    if (options?.product?.productText && (data?.length ?? 0) > 1) {
      return {
        message: "I found more than one matching product. Please provide a more specific product name or code.",
        ok: false,
        reason: "ambiguous",
      };
    }
    template = data?.[0] ?? null;
  }

  if (!template) {
    return NOT_ENOUGH_INFO_RESULT;
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("id,name,last_price_list_checked_at")
    .eq("id", template.brand_id)
    .maybeSingle<BrandRow>();

  const { data: brandUpdates } = await supabase
    .from("brand_price_list_updates")
    .select("title,effective_from,received_at,created_at,status")
    .eq("brand_id", template.brand_id)
    .in("status", ["draft", "active"])
    .order("effective_from", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<BrandPriceListUpdateRow[]>();

  const latestUpdate = latestBrandPriceListUpdate(brandUpdates ?? []);
  const brandPriceListAt = brandPriceBaselineDate({
    fallbackCheckedAt: brand?.last_price_list_checked_at ?? null,
    latestBrandPriceListUpdate: latestUpdate,
  });

  // Reuses the exact same status calculation the Product Management price badges use - never
  // reimplemented here.
  const status = productTemplatePriceCheckState({
    brandPriceBaselineAt: brandPriceListAt,
    formatDate,
    latestBrandPriceListUpdate: latestUpdate,
    template,
  });

  return {
    data: {
      templateId: template.id,
      name: template.internal_selection_name?.trim() || template.template_name,
      brand: brand?.name ?? null,
      statusKey: status.key,
      statusLabel: status.label,
      statusDetail: status.detail,
      statusReason: status.reason,
      lastPriceCheckedAt: template.last_price_checked_at,
      latestBrandPriceListDate: brandPriceListAt,
      latestBrandPriceListTitle: latestUpdate?.title ?? null,
    },
    ok: true,
    sources: [{ label: "Checked product price status", recordId: template.id, type: "price_status" }],
  };
}
