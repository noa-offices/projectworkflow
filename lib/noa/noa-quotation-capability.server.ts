import "server-only";

import { requireQuotationActionUser } from "@/lib/auth";
import type { NoaCapabilityResult, NoaPageContext } from "@/lib/noa/noa-types";
import { createClient } from "@/lib/supabase/server";

const MAX_ITEM_ROWS = 8;
const MAX_QUOTATION_ROWS = 10;

// Fixed, narrow column list only.
const QUOTATION_SELECT =
  "id,quotation_no,title,client_id,project_id,status,quotation_date,currency,grand_total,revision_no,option_no,is_active";

// Fixed, narrow fields for read-only status summaries and lists.  These intentionally do not
// include quotation_items or any live Product Library fields.
const QUOTATION_STATUS_SELECT = "id,quotation_no,status,created_at,client_id,project_id";

// Deliberately snapshot columns only (item_*_snapshot / model_snapshot / etc.), never live
// product_templates fields - historical quotation questions must answer from what was saved with
// the quotation, not from a live refetch, per the audit's snapshot-preference finding.
const ITEM_SELECT =
  "id,item_type,item_code_snapshot,item_name_snapshot,model_snapshot,supplier_name_snapshot,size_snapshot,origin_snapshot,qty,unit_label,unit_price,currency,net_total,source_template_id,is_active";

type QuotationRow = {
  client_id: string | null;
  currency: string | null;
  grand_total: number | null;
  id: string;
  is_active: boolean;
  option_no: number | null;
  project_id: string | null;
  quotation_date: string | null;
  quotation_no: string | null;
  revision_no: number | null;
  status: string | null;
  title: string | null;
};

type QuotationStatusRow = {
  client_id: string | null;
  created_at: string | null;
  id: string;
  project_id: string | null;
  quotation_no: string | null;
  status: string | null;
};

type ItemRow = {
  currency: string | null;
  id: string;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  item_type: string | null;
  model_snapshot: string | null;
  net_total: number | null;
  origin_snapshot: string | null;
  qty: number | null;
  size_snapshot: string | null;
  source_template_id: string | null;
  supplier_name_snapshot: string | null;
  unit_label: string | null;
  unit_price: number | null;
};

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

const NOT_FOUND_RESULT: NoaCapabilityResult = {
  message: "I couldn't find that quotation.",
  ok: false,
  reason: "not_found",
};

// A quotation number generally looks like Q-2026-0142, a legacy reference, or similar - anything
// with a run of digits at least 3 long is treated as a plausible identifier to search on.
function extractQuotationIdentifier(message: string): string | null {
  const match = message.match(/[A-Za-z]{0,4}-?\d{3,}(?:-\d+)*/);
  return match ? match[0] : null;
}

type QuotationQuestionKind = "count" | "list" | "summary" | "detail";

function b2Target(message: string, relation: "client" | "project") {
  const match = message.match(new RegExp(`\\b${relation}\\s+([^?.,]+)`, "i"));
  const target = match?.[1]
    ?.replace(/^(?:is|has|have)\s+/i, "")
    .replace(/\s+\b(?:has|have|total|value|quotations?|quotes?)\b.*$/i, "")
    .trim();
  return target || null;
}

function quotationIdentifiers(message: string) {
  return [...message.matchAll(/[A-Za-z]{0,4}-?\d{3,}(?:-\d+)*/g)].map((match) => match[0]);
}

type QuotationStatusIntent = "draft" | "client_confirmed" | "waiting";

const STATUS_INTENTS: ReadonlyArray<{
  aliases: RegExp;
  displayLabel: string;
  intent: QuotationStatusIntent;
  persistedKey: string;
}> = [
  { aliases: /\b(?:draft|pending)\b/, displayLabel: "Pending", intent: "draft", persistedKey: "draft" },
  {
    aliases: /\b(?:client[\s-]+confirmed|confirmed)\b/,
    displayLabel: "Client Confirmed",
    intent: "client_confirmed",
    persistedKey: "clientconfirmed",
  },
  // "waiting" is intentionally not assigned a business status until that relationship is defined.
  { aliases: /\bwaiting\b/, displayLabel: "Waiting", intent: "waiting", persistedKey: "" },
];

function quotationQuestionKind(message: string): QuotationQuestionKind {
  const normalized = message.toLowerCase();
  if (/\b(how many|count|number of)\b/.test(normalized)) return "count";
  // An explicit quotation reference remains a detail request even if phrased as "show Q-...".
  if (extractQuotationIdentifier(message)) return "detail";
  if (/\b(show|list|which)\b/.test(normalized)) return "list";
  if (/\bstatus(?:es)?\b/.test(normalized)) return "summary";
  return "detail";
}

function persistedStatusKey(status: string) {
  return status.toLowerCase().replace(/[\s_-]+/g, "");
}

function quotationStatusDisplayLabel(status: string) {
  const key = persistedStatusKey(status);
  if (key === "draft") return "Pending";
  if (key === "clientconfirmed") return "Client Confirmed";
  return status;
}

// This is deliberately a pure mapping against exact, authorized persisted status keys. Approved
// aliases only activate when their target status exists; "waiting" intentionally never maps.
function normalizeQuotationStatusIntent(message: string, availableStatuses: string[]) {
  const normalized = message.toLowerCase();
  const byKey = new Map(availableStatuses.map((status) => [persistedStatusKey(status), status]));
  const requested = STATUS_INTENTS.filter(({ aliases }) => aliases.test(normalized));

  return {
    requested,
    statuses: requested.flatMap(({ persistedKey }) => {
      const status = persistedKey ? byKey.get(persistedKey) : undefined;
      return status ? [status] : [];
    }),
    unsupported: requested.filter(({ persistedKey }) => !persistedKey || !byKey.has(persistedKey)),
  };
}

export async function fetchNoaQuotationCapability(
  message: string,
  context: NoaPageContext,
): Promise<NoaCapabilityResult> {
  // Defense-in-depth: independently re-checked here, not trusted from the route-level auth check.
  try {
    await requireQuotationActionUser();
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const supabase = await createClient();

  const broadAnswer = await buildBroadQuotationAnswer(supabase, message, context);
  if (broadAnswer) return broadAnswer;

  // Aggregate/list intent takes precedence over a quotation page context: a user asking for
  // "how many pending quotations" is not asking about the quotation currently on screen.
  const questionKind = quotationQuestionKind(message);
  if (questionKind !== "detail") {
    return buildQuotationStatusAnswer(supabase, message, questionKind);
  }

  // Page context is the FIRST reference for an ambiguous quotation question (PART 2/9): if the
  // user is looking at a specific quotation, that's authoritative and a stale/inaccessible
  // context id returns a deterministic not-found - it must never silently fall back to a text
  // search or "the most recent quotation" once a specific one was already in view.
  if (context.quotationId) {
    const { data: quotation } = await supabase
      .from("quotations")
      .select(QUOTATION_SELECT)
      .eq("id", context.quotationId)
      .maybeSingle<QuotationRow>();

    return quotation ? buildQuotationAnswer(supabase, quotation) : NOT_FOUND_RESULT;
  }

  const identifier = extractQuotationIdentifier(message);
  if (!identifier) {
    return {
      message: "I couldn't understand that ProjectWorkflow request. Try asking about a product, quotation, or price status.",
      ok: false,
      reason: "ambiguous",
    };
  }

  const { data: quotation } = await supabase
    .from("quotations")
    .select(QUOTATION_SELECT)
    .ilike("quotation_no", `%${identifier}%`)
    .order("quotation_date", { ascending: false })
    .limit(1)
    .maybeSingle<QuotationRow>();

  if (!quotation) {
    return NOT_FOUND_RESULT;
  }

  return buildQuotationAnswer(supabase, quotation);
}

async function buildBroadQuotationAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
  context: NoaPageContext,
): Promise<NoaCapabilityResult | null> {
  const normalized = message.toLowerCase();
  const identifiers = quotationIdentifiers(message);
  if (/\b(compare|difference between)\b/.test(normalized)) {
    if (identifiers.length !== 2) return { message: "Please provide exactly two quotation numbers to compare.", ok: false, reason: "ambiguous" };
    const { data } = await supabase.from("quotations").select(QUOTATION_SELECT).in("quotation_no", identifiers).returns<QuotationRow[]>();
    const rows = data ?? [];
    if (rows.length !== 2) return NOT_FOUND_RESULT;
    const [first, second] = rows;
    return { data: { kind: "quotation_comparison", rows: rows.map((row) => ({ quotationNo: row.quotation_no, status: row.status, currency: row.currency, grandTotal: row.grand_total })), deterministicText: `${first.quotation_no} is ${first.currency ?? ""} ${first.grand_total ?? 0}; ${second.quotation_no} is ${second.currency ?? ""} ${second.grand_total ?? 0}.` }, ok: true, sources: [{ label: "Checked quotations", type: "quotation" }] };
  }
  if (/\b(which quotations used|where was this product quoted|how many quotations used)\b/.test(normalized) && context.productTemplateId) {
    const { data } = await supabase.from("quotation_items").select("quotation_id").eq("source_template_id", context.productTemplateId).eq("is_active", true).returns<Array<{ quotation_id: string }>>();
    const ids = [...new Set((data ?? []).map((item) => item.quotation_id))];
    const { data: rows } = ids.length ? await supabase.from("quotations").select(QUOTATION_STATUS_SELECT).in("id", ids).order("created_at", { ascending: false }).returns<QuotationStatusRow[]>() : { data: [] as QuotationStatusRow[] };
    const listed = (rows ?? []).slice(0, MAX_QUOTATION_ROWS);
    return { data: { kind: "quotation_product_usage", totalMatching: (rows ?? []).length, rows: listed, truncatedCount: Math.max(0, (rows ?? []).length - listed.length), deterministicText: `This product appears in ${(rows ?? []).length} quotation${(rows ?? []).length === 1 ? "" : "s"}.` }, ok: true, sources: [{ label: "Checked quotations", type: "quotation" }] };
  }
  if (/\b(total value|quotation value)\b/.test(normalized) && !/\b(client|project)\b/.test(normalized)) {
    const { data } = await supabase.from("quotations").select(QUOTATION_SELECT).returns<QuotationRow[]>();
    const rows = data ?? [];
    const intent = normalizeQuotationStatusIntent(message, [...new Set(rows.flatMap((row) => row.status ? [row.status] : []))]);
    if (intent.unsupported.length) return { message: "I can check quotation statuses, but that status is not mapped safely yet.", ok: false, reason: "ambiguous" };
    const matching = intent.statuses.length ? rows.filter((row) => row.status && intent.statuses.includes(row.status)) : rows;
    const totals = [...new Set(matching.map((row) => row.currency ?? "Unknown"))].map((currency) => ({ currency, total: matching.filter((row) => (row.currency ?? "Unknown") === currency).reduce((sum, row) => sum + (row.grand_total ?? 0), 0) }));
    return { data: { kind: "quotation_total", totals, deterministicText: `${intent.statuses.length ? `${quotationStatusDisplayLabel(intent.statuses[0])} ` : ""}quotations total ${totals.map((total) => `${total.currency} ${total.total}`).join(" and ")}.` }, ok: true, sources: [{ label: "Checked quotations", type: "quotation" }] };
  }
  const relation = /\bclient\b/.test(normalized) ? "client" : /\bproject\b/.test(normalized) ? "project" : null;
  if (!relation || !/\b(quotation|quote|total|how many|show|list)\b/.test(normalized)) return null;
  const target = b2Target(message, relation);
  if (!target) return null;
  const table = relation === "client" ? "clients" : "projects";
  const field = relation === "client" ? "company_name" : "project_name";
  const foreignKey = relation === "client" ? "client_id" : "project_id";
  const { data: relationRow } = await supabase.from(table).select(`id,${field}`).ilike(field, `%${target}%`).limit(1).maybeSingle<{ id: string }>();
  if (!relationRow) return { message: `I couldn't find that ${relation}.`, ok: false, reason: "not_found" };
  const { data } = await supabase.from("quotations").select(QUOTATION_SELECT).eq(foreignKey, relationRow.id).order("quotation_date", { ascending: false }).returns<QuotationRow[]>();
  const rows = data ?? [];
  const statusIntent = normalizeQuotationStatusIntent(message, [...new Set(rows.flatMap((row) => row.status ? [row.status] : []))]);
  if (statusIntent.unsupported.length) return { message: "I can check quotation statuses, but that status is not mapped safely yet.", ok: false, reason: "ambiguous" };
  const matching = statusIntent.statuses.length ? rows.filter((row) => row.status && statusIntent.statuses.includes(row.status)) : rows;
  const totals = [...new Set(matching.map((row) => row.currency ?? "Unknown"))].map((currency) => ({ currency, total: matching.filter((row) => (row.currency ?? "Unknown") === currency).reduce((sum, row) => sum + (row.grand_total ?? 0), 0) }));
  const wantsTotal = /\b(total|value)\b/.test(normalized);
  const listed = matching.slice(0, MAX_QUOTATION_ROWS).map((row) => ({ id: row.id, quotationNo: row.quotation_no, status: row.status, currency: row.currency, grandTotal: row.grand_total }));
  const label = relation === "client" ? "Client" : "Project";
  const statusLabel = statusIntent.statuses.length ? ` ${quotationStatusDisplayLabel(statusIntent.statuses[0]).toLowerCase()}` : "";
  return { data: { kind: "quotation_relation_read", relation, totalMatching: matching.length, returnedCount: listed.length, truncatedCount: Math.max(0, matching.length - listed.length), rows: listed, totals, deterministicText: wantsTotal ? `${label} has ${totals.map((total) => `${total.currency} ${total.total}`).join(" and ")} in${statusLabel} quotation value.` : `${label} has ${matching.length}${statusLabel} quotation${matching.length === 1 ? "" : "s"}. Showing ${listed.length}.` }, ok: true, sources: [{ label: "Checked quotations", type: "quotation" }] };
}

async function buildQuotationStatusAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
  questionKind: Exclude<QuotationQuestionKind, "detail">,
): Promise<NoaCapabilityResult> {
  const { data } = await supabase
    .from("quotations")
    .select(QUOTATION_STATUS_SELECT)
    .order("created_at", { ascending: false })
    .returns<QuotationStatusRow[]>();
  const quotations = data ?? [];
  const availableStatuses = [...new Set(quotations.flatMap((quotation) => quotation.status ? [quotation.status] : []))];
  const statusIntent = normalizeQuotationStatusIntent(message, availableStatuses);

  if (statusIntent.unsupported.length > 0) {
    const requested = statusIntent.unsupported[0].intent === "client_confirmed"
      ? "confirmed"
      : statusIntent.unsupported[0].intent;
    return {
      message: `I can check quotation statuses, but '${requested}' is not a status I can map safely in ProjectWorkflow yet.`,
      ok: false,
      reason: "ambiguous",
    };
  }

  const matching = statusIntent.statuses.length > 0
    ? quotations.filter((quotation) => quotation.status && statusIntent.statuses.includes(quotation.status))
    : quotations;
  const sourceStatus = statusIntent.statuses.length === 1
    ? ` ${quotationStatusDisplayLabel(statusIntent.statuses[0]).toLowerCase()}`
    : "";

  if (questionKind === "list") {
    const rows = await Promise.all(matching.slice(0, MAX_QUOTATION_ROWS).map(async (quotation) => ({
      id: quotation.id,
      quotationNo: quotation.quotation_no,
      status: quotation.status,
      client: quotation.client_id ? await clientNameFor(supabase, quotation.client_id) : null,
      project: quotation.project_id ? await projectNameFor(supabase, quotation.project_id) : null,
      createdAt: quotation.created_at,
    })));
    const totalMatching = matching.length;
    return {
      data: {
        kind: "quotation_status_list",
        requestedStatus: statusIntent.statuses.length === 1 ? statusIntent.statuses[0] : null,
        requestedDisplayLabel: statusIntent.statuses.length === 1
          ? quotationStatusDisplayLabel(statusIntent.statuses[0])
          : null,
        totalMatching,
        rows: rows.map((row) => ({ ...row, displayLabel: row.status ? quotationStatusDisplayLabel(row.status) : null, persistedStatus: row.status })),
        truncatedCount: Math.max(0, totalMatching - rows.length),
        emptyMessage: totalMatching === 0 ? `No${sourceStatus} quotations were found.` : null,
        deterministicText: totalMatching === 0
          ? `No${sourceStatus} quotations were found.`
          : `${totalMatching} ${sourceStatus.trim() || "quotation"}${totalMatching === 1 ? "" : "s"}: ${rows.map((row) => row.quotationNo ?? row.id).join(", ")}.`,
      },
      ok: true,
      sources: [{ label: `Checked${sourceStatus} quotations`, type: "quotation" }],
    };
  }

  const statusesToCount = statusIntent.statuses.length > 0 ? statusIntent.statuses : availableStatuses;
  const counts = statusesToCount.map((status) => ({
    displayLabel: quotationStatusDisplayLabel(status),
    persistedStatus: status,
    count: quotations.filter((quotation) => quotation.status === status).length,
  }));
  const totalCount = statusIntent.statuses.length > 0 ? matching.length : quotations.length;
  const countText = counts.map(({ count, displayLabel }) => `${count} ${displayLabel}`).join(" and ");
  const filteredCountText = counts
    .map(({ count, displayLabel }) => `${count} ${displayLabel} quotation${count === 1 ? "" : "s"}`)
    .join(" and ");
  return {
    data: {
      kind: "quotation_status_count",
      totalCount,
      counts,
      emptyMessage: totalCount === 0 && statusIntent.statuses.length === 1
        ? `No${sourceStatus} quotations were found.`
        : null,
      deterministicText: totalCount === 0 && statusIntent.statuses.length === 1
        ? `No${sourceStatus} quotations were found.`
        : statusIntent.statuses.length > 0
          ? `There ${totalCount === 1 ? "is" : "are"} ${filteredCountText}.`
          : `There ${totalCount === 1 ? "is" : "are"} ${totalCount} quotation${totalCount === 1 ? "" : "s"}${countText ? `: ${countText}.` : "."}`,
    },
    ok: true,
    sources: [{ label: `Checked${sourceStatus} quotations`, type: "quotation" }],
  };
}

async function buildQuotationAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quotation: QuotationRow,
): Promise<NoaCapabilityResult> {
  const [clientName, projectName, items, itemCount] = await Promise.all([
    quotation.client_id ? clientNameFor(supabase, quotation.client_id) : Promise.resolve(null),
    quotation.project_id ? projectNameFor(supabase, quotation.project_id) : Promise.resolve(null),
    quotationItemsFor(supabase, quotation.id),
    quotationItemCountFor(supabase, quotation.id),
  ]);

  const label = `Checked quotation ${quotation.quotation_no ?? quotation.id}`;

  return {
    data: {
      id: quotation.id,
      quotationNo: quotation.quotation_no,
      title: quotation.title,
      client: clientName,
      project: projectName,
      status: quotation.status,
      quotationDate: quotation.quotation_date,
      currency: quotation.currency,
      grandTotal: quotation.grand_total,
      revisionNo: quotation.revision_no,
      optionNo: quotation.option_no,
      isActive: quotation.is_active,
      itemCount,
      // Snapshot fields only - see ITEM_SELECT comment. `sourceLinkAvailable` tells the model
      // whether live source navigation/repricing still exists for that row (it may not, if the
      // originating product template was later permanently deleted).
      items: items.map((item) => ({
        itemType: item.item_type,
        name: item.item_name_snapshot,
        code: item.item_code_snapshot,
        model: item.model_snapshot,
        supplierName: item.supplier_name_snapshot,
        origin: item.origin_snapshot,
        size: item.size_snapshot,
        qty: item.qty,
        unitLabel: item.unit_label,
        unitPrice: item.unit_price,
        currency: item.currency,
        netTotal: item.net_total,
        sourceLinkAvailable: Boolean(item.source_template_id),
      })),
      truncatedItemCount: Math.max(0, itemCount - items.length),
      note: "All product fields above are the quotation's saved snapshot at the time it was quoted, not necessarily the current live Product Library values.",
    },
    ok: true,
    sources: [{ label, recordId: quotation.id, type: "quotation" }],
  };
}

async function clientNameFor(supabase: Awaited<ReturnType<typeof createClient>>, clientId: string) {
  const { data } = await supabase
    .from("clients")
    .select("company_name")
    .eq("id", clientId)
    .maybeSingle<{ company_name: string | null }>();
  return data?.company_name ?? null;
}

async function projectNameFor(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string) {
  const { data } = await supabase
    .from("projects")
    .select("project_name")
    .eq("id", projectId)
    .maybeSingle<{ project_name: string | null }>();
  return data?.project_name ?? null;
}

async function quotationItemsFor(supabase: Awaited<ReturnType<typeof createClient>>, quotationId: string) {
  const { data } = await supabase
    .from("quotation_items")
    .select(ITEM_SELECT)
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(MAX_ITEM_ROWS)
    .returns<ItemRow[]>();
  return data ?? [];
}

async function quotationItemCountFor(supabase: Awaited<ReturnType<typeof createClient>>, quotationId: string) {
  const { count } = await supabase
    .from("quotation_items")
    .select("id", { count: "exact", head: true })
    .eq("quotation_id", quotationId)
    .eq("is_active", true);
  return count ?? 0;
}
