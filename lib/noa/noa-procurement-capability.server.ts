import "server-only";

import { requireProcurementManager } from "@/lib/auth";
import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { vendorDocSlotLabel, vendorStepLabel } from "@/lib/procurement/vendor-steps";
import { createClient } from "@/lib/supabase/server";
import type { NoaCapabilityResult, NoaPageContext } from "./noa-types";

const MAX_PROCUREMENT_ORDER_ROWS = 20;
const MAX_PROCUREMENT_VENDOR_ROWS = 20;
const MAX_PROCUREMENT_DOCS_PER_VENDOR = 10;

type QuotationLayoutRow = { id: string; layout_settings: unknown };
type QuotationItemRow = {
  brand_name_snapshot: string | null;
  supplier_name_snapshot: string | null;
};
type VendorProgressRow = { active_step: number; eta: string | null; etd: string | null; vendor_key: string };
type VendorDocRow = { file_name: string; slot_key: string; vendor_key: string };

type ProcurementOrder = {
  clientName: string;
  completedAt: string | null;
  createdAt: string;
  currency: string;
  orderNo: string;
  quotationId: string;
  reference: string;
  total: number;
};

const UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "I couldn't access Procurement records for this account.",
  ok: false,
  reason: "unauthorized",
};

function isNextRedirectError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}

// Every confirmed order (regardless of vendor step) comes from quotations.layout_settings, never
// from the vendor-progress step counter - a vendor at the last step does not mean the order
// itself is completed. This mirrors the Project capability's own order-status resolution exactly,
// since both read the same source of truth.
async function allProcurementOrders(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ProcurementOrder[]> {
  const { data } = await supabase
    .from("quotations")
    .select("id,layout_settings")
    .returns<QuotationLayoutRow[]>();

  return (data ?? [])
    .flatMap((quotation) => {
      const settings = quotation.layout_settings as Record<string, unknown> | null;
      const completedAt = typeof settings?.projectCompletedAt === "string" ? settings.projectCompletedAt : null;
      const cancelledAt = typeof settings?.projectCancelledAt === "string" ? settings.projectCancelledAt : null;
      if (cancelledAt) return [];
      const order = projectFileFromLayoutSettings(quotation.layout_settings) ??
        clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder;
      return order ? [{
        clientName: order.clientName,
        completedAt,
        createdAt: order.createdAt,
        currency: order.currency,
        orderNo: order.orderNo,
        quotationId: quotation.id,
        reference: order.reference,
        total: order.total,
      }] : [];
    })
    .filter((order, index, all) => all.findIndex((candidate) => candidate.orderNo === order.orderNo) === index);
}

type ProcurementQuestionKind = "detail" | "list";

function procurementQuestionKind(message: string): ProcurementQuestionKind {
  const normalized = message.toLowerCase();
  if (/\b(order details?|status of (?:the )?(?:procurement )?order|vendors? for|documents? for|vendor progress|eta|etd)\b/.test(normalized)) {
    return "detail";
  }
  // A message naming a specific order-number-shaped token ("PW-2024-001") is a detail question
  // even without an explicit "order details" phrase - same heuristic already used for Quotation
  // identifiers in lib/noa/noa-intent-router.ts's compare/difference check.
  if (/\b[a-z]{0,4}-?\d{3,}[a-z0-9-]*\b/i.test(message)) return "detail";
  return "list";
}

function procurementOrderTarget(message: string): string | null {
  const patterns = [
    /order details? for (.+)$/i,
    /status of (?:the )?(?:procurement )?order (.+)$/i,
    /vendors? for (?:order )?(.+)$/i,
    /documents? for (?:order )?(.+)$/i,
    /where is (?:order |procurement order )?(.+)$/i,
    /procurement order (.+)$/i,
  ];
  for (const pattern of patterns) {
    const target = message.match(pattern)?.[1]?.trim();
    if (target) return target;
  }
  // Fall back to a bare order-number-shaped token in the raw message.
  const token = message.match(/\b[a-z]{0,4}-?\d{3,}[a-z0-9-]*\b/i)?.[0];
  return token ?? null;
}

function safeOrderRow(order: ProcurementOrder) {
  return {
    clientName: order.clientName,
    createdAt: order.createdAt,
    currency: order.currency,
    orderNo: order.orderNo,
    reference: order.reference,
    status: order.completedAt ? "completed" : "active",
    total: order.total,
  };
}

async function procurementOrderListAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const normalized = message.toLowerCase();
  const completed = /\bcompleted\b/.test(normalized);
  const countOnly = /\b(how many|count|number of)\b/.test(normalized);

  const orders = (await allProcurementOrders(supabase))
    .filter((order) => (completed ? Boolean(order.completedAt) : !order.completedAt))
    .sort((a, b) => new Date(completed ? b.completedAt! : b.createdAt).getTime() - new Date(completed ? a.completedAt! : a.createdAt).getTime());

  const rows = countOnly ? [] : orders.slice(0, MAX_PROCUREMENT_ORDER_ROWS).map(safeOrderRow);
  const label = completed ? "completed" : "active";

  return {
    data: {
      kind: countOnly ? "procurement_order_count" : "procurement_order_list",
      returnedCount: rows.length,
      rows,
      totalMatching: orders.length,
      truncatedCount: Math.max(0, orders.length - rows.length),
      deterministicText: `I found ${orders.length} ${label} Procurement order${orders.length === 1 ? "" : "s"}.${countOnly ? "" : ` Showing ${rows.length}.`}`,
    },
    ok: true,
    sources: [{ label: "Procurement · Checked procurement orders", type: "procurement_order" }],
  };
}

async function procurementOrderDetailAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const target = procurementOrderTarget(message);
  if (!target) {
    return { message: "Please specify the Procurement order number.", ok: false, reason: "ambiguous" };
  }

  const normalizedTarget = target.trim().toLowerCase();
  const order = (await allProcurementOrders(supabase))
    .find((candidate) => candidate.orderNo.toLowerCase() === normalizedTarget);

  if (!order) {
    return { message: "I couldn't find that Procurement order.", ok: false, reason: "not_found" };
  }

  const { data: items } = await supabase
    .from("quotation_items")
    .select("brand_name_snapshot,supplier_name_snapshot")
    .eq("quotation_id", order.quotationId)
    .eq("is_active", true)
    .returns<QuotationItemRow[]>();

  const vendorGroups = buildEffectiveDocumentGroups(items ?? []).slice(0, MAX_PROCUREMENT_VENDOR_ROWS);

  const [{ data: progressRows }, { data: docRows }] = await Promise.all([
    supabase
      .from("procurement_vendor_progress")
      .select("vendor_key,active_step,etd,eta")
      .eq("order_no", order.orderNo)
      .returns<VendorProgressRow[]>(),
    // Selects only vendor_key/slot_key/file_name - documents are surfaced by file name and slot
    // label only, never by a signed/hosted file location or internal row id (both excluded from
    // every provider-facing payload per the Procurement audit's safe-field list).
    supabase
      .from("procurement_vendor_docs")
      .select("vendor_key,slot_key,file_name")
      .eq("order_no", order.orderNo)
      .returns<VendorDocRow[]>(),
  ]);

  const progressByVendor = new Map((progressRows ?? []).map((row) => [row.vendor_key, row]));
  const docsByVendor = new Map<string, VendorDocRow[]>();
  for (const row of docRows ?? []) {
    const existing = docsByVendor.get(row.vendor_key) ?? [];
    existing.push(row);
    docsByVendor.set(row.vendor_key, existing);
  }

  const vendors = vendorGroups.map((group) => {
    const progress = progressByVendor.get(group.dedupeKey);
    const docs = (docsByVendor.get(group.dedupeKey) ?? []).slice(0, MAX_PROCUREMENT_DOCS_PER_VENDOR);
    return {
      // vendor_key/dedupeKey is an internal grouping key and is deliberately never included here -
      // only the human-facing displayLabel is surfaced, matching the Procurement audit's rule.
      documentCount: docs.length,
      documents: docs.map((doc) => ({ fileName: doc.file_name, slotLabel: vendorDocSlotLabel(doc.slot_key) })),
      eta: progress?.eta ?? null,
      etd: progress?.etd ?? null,
      stepLabel: vendorStepLabel(progress?.active_step ?? 0),
      vendorLabel: group.displayLabel,
    };
  });

  const vendorSummary = vendors.map((vendor) => `${vendor.vendorLabel} (${vendor.stepLabel})`).join(", ");
  const status = order.completedAt ? "completed" : "active";

  return {
    data: {
      kind: "procurement_order_detail",
      order: safeOrderRow(order),
      vendors,
      deterministicText: vendors.length
        ? `Order ${order.orderNo} is ${status} with ${vendors.length} vendor${vendors.length === 1 ? "" : "s"}: ${vendorSummary}.`
        : `Order ${order.orderNo} is ${status} with no vendor groups yet.`,
    },
    ok: true,
    sources: [{ label: "Procurement · Checked procurement order", type: "procurement_order" }],
  };
}

// PART 2 entry point: deterministic classification, its own requireProcurementManager() gate
// (a stricter role check than the other capabilities use - matches the app's own Procurement
// pages), user-scoped Supabase reads only, no writes anywhere in this file, no cross-capability
// chaining.
export async function fetchNoaProcurementCapability(
  message: string,
  _context: NoaPageContext,
): Promise<NoaCapabilityResult> {
  try {
    await requireProcurementManager();
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const supabase = await createClient();
  return procurementQuestionKind(message) === "detail"
    ? procurementOrderDetailAnswer(supabase, message)
    : procurementOrderListAnswer(supabase, message);
}
