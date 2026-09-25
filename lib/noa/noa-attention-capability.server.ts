import "server-only";

import { canViewClientPayments, requireActiveUser, requireProcurementManager, requireProductLibraryManager } from "@/lib/auth";
import type { AppRole } from "@/lib/supabase/types";
import {
  brandPriceBaselineDate,
  latestBrandPriceListUpdate,
  productTemplatePriceCheckState,
} from "@/lib/product-price-check";
import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";
import { allProjectFiles } from "@/lib/noa/noa-project-capability.server";
import {
  calculateClientPaymentSummary,
  clientPaymentDueLabel,
  deriveClientPaymentStatus,
  formatPaymentMoney,
  moneyToFils,
  type ClientPaymentInstallmentRow,
  type ClientPaymentReceiptRow,
  type ClientPaymentScheduleRow,
} from "@/lib/projects/client-payment-model";
import { createClient } from "@/lib/supabase/server";
import type { NoaCapabilityResult, NoaPageContext } from "./noa-types";

// N2A1: bounded scan sizes reused from the proven Insights/Procurement patterns audited in A0 -
// never a new unbounded scan (A0 flagged Insights' own procurementSummaryAnswer() quotations scan
// as having no .limit() at all; that shape is never copied here).
const MAX_PRICE_SCAN = 200; // matches Insights' productPriceSummaryAnswer()
const MAX_ATTENTION_ORDER_SCAN = 20; // matches the existing MAX_PROCUREMENT_ORDER_ROWS elsewhere
const MAX_ATTENTION_ITEMS = 10; // bounded structured items + deterministicText bullet count

// N2A2: "ClientPayment" is an Attention-LOCAL source category only - never added to the global
// NoaDomain (that stays Product/Quotation/Price/.../Attention, unchanged).
type NoaAttentionSourceDomain = "Price" | "Procurement" | "ClientPayment";
type NoaAttentionKind = "price_needs_check" | "price_due" | "procurement_missing_eta" | "procurement_missing_etd" | "payment_overdue";
type NoaAttentionEntityType = "product_template" | "vendor" | "installment";

// PART 3: the small, local Attention finding contract - deliberately no severity/score/priority/
// rank field (A0 proved no authoritative source exists for any of those). `sourceDomain` is a
// plain descriptive tag on the finding, never a second NoaDomain/routing concept. `entityLabel`
// is always a safe display string; `entityIdentifier` (when present) is a business identifier
// (orderNo) only - never a UUID.
export type NoaAttentionItem = {
  key: string;
  sourceDomain: NoaAttentionSourceDomain;
  kind: NoaAttentionKind;
  title: string;
  detail: string;
  entityType: NoaAttentionEntityType;
  entityLabel: string;
  entityIdentifier?: string;
};

const UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "I couldn't access ProjectWorkflow attention checks for this account.",
  ok: false,
  reason: "unauthorized",
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

// Trivial display-only formatting (never a business-rule calculation) - mirrors the same
// "unknown date" fallback Insights already uses for this exact field, not a new convention.
function formatAttentionDate(value: string | null) {
  return value ?? "unknown date";
}

type PriceScanTemplateRow = {
  brand_id: string;
  created_at: string | null;
  id: string;
  internal_selection_name: string | null;
  last_price_checked_at: string | null;
  price_check_interval_days: number | null;
  template_name: string;
};
type PriceScanBrandRow = { id: string; last_price_list_checked_at: string | null; name: string };
type PriceScanBrandUpdateRow = { brand_id: string; created_at: string | null; effective_from: string | null; received_at: string | null; status: string; title: string | null };

// PART 7/8/9: exact fields/helper chain proven by A0 and already used identically by Insights'
// productPriceSummaryAnswer() - product_templates -> brands/brand_price_list_updates (batched by
// brand_id) -> latestBrandPriceListUpdate() -> brandPriceBaselineDate() ->
// productTemplatePriceCheckState() per template. The status calculation itself is never
// reimplemented here. Findings are created ONLY for "needs_check"/"due" (PART 8); every other
// status key is silently skipped. Caller (fetchNoaAttentionCapability) already gates this behind
// requireProductLibraryManager() before it is ever invoked.
async function productPriceFindings(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaAttentionItem[]> {
  const { data } = await supabase
    .from("product_templates")
    .select("id,template_name,internal_selection_name,brand_id,created_at,last_price_checked_at,price_check_interval_days")
    .eq("is_active", true)
    .order("template_name", { ascending: true })
    .limit(MAX_PRICE_SCAN)
    .returns<PriceScanTemplateRow[]>();

  const templates = data ?? [];
  if (templates.length === 0) return [];

  const brandIds = Array.from(new Set(templates.map((template) => template.brand_id)));
  const [{ data: brandRows }, { data: updateRows }] = await Promise.all([
    supabase.from("brands").select("id,name,last_price_list_checked_at").in("id", brandIds).returns<PriceScanBrandRow[]>(),
    supabase.from("brand_price_list_updates").select("brand_id,title,effective_from,received_at,created_at,status").in("brand_id", brandIds).in("status", ["draft", "active"]).returns<PriceScanBrandUpdateRow[]>(),
  ]);
  const brandsById = new Map((brandRows ?? []).map((row) => [row.id, row]));
  const updatesByBrand = new Map<string, PriceScanBrandUpdateRow[]>();
  for (const update of updateRows ?? []) {
    updatesByBrand.set(update.brand_id, [...(updatesByBrand.get(update.brand_id) ?? []), update]);
  }

  // PART 18 #1: template-name order preserved (the query's own `.order("template_name", ...)`) -
  // never re-sorted/ranked.
  const findings: NoaAttentionItem[] = [];
  for (const template of templates) {
    const brandRow = brandsById.get(template.brand_id);
    const latestUpdate = latestBrandPriceListUpdate(updatesByBrand.get(template.brand_id) ?? []);
    const baseline = brandPriceBaselineDate({ fallbackCheckedAt: brandRow?.last_price_list_checked_at ?? null, latestBrandPriceListUpdate: latestUpdate });
    const status = productTemplatePriceCheckState({
      brandPriceBaselineAt: baseline,
      formatDate: formatAttentionDate,
      latestBrandPriceListUpdate: latestUpdate,
      template,
    });

    if (status.key !== "needs_check" && status.key !== "due") continue;

    const name = template.internal_selection_name?.trim() || template.template_name;
    const label = brandRow?.name ? `${brandRow.name} ${name}` : name;

    findings.push({
      key: `${status.key === "due" ? "price_due" : "price_needs_check"}:${template.id}`,
      sourceDomain: "Price",
      kind: status.key === "due" ? "price_due" : "price_needs_check",
      title: status.key === "due" ? `${name} is due for a price check` : `${name} needs a price check`,
      // PART 9: only facts already returned by productTemplatePriceCheckState() - never invented
      // urgency wording.
      detail: status.detail,
      entityType: "product_template",
      entityLabel: label,
    });
  }

  return findings;
}

type ActiveProjectFile = Awaited<ReturnType<typeof allProjectFiles>>[number];
type ActiveOrderItemRow = { brand_name_snapshot: string | null; quotation_id: string; supplier_name_snapshot: string | null };
type VendorProgressRow = { eta: string | null; etd: string | null; order_no: string; vendor_key: string };

// N2A2 PART 3: hoisted out of procurementFindings() so the Procurement and Client Payment
// subsections share this ONE bounded ERP Project File read instead of each doing their own -
// never a second independent (unbounded or otherwise) quotation scan. "Active" = neither
// cancelled nor completed, exactly matching allProjectFiles()'s own status derivation - never a
// second status rule. Bounded to MAX_ATTENTION_ORDER_SCAN, sorted by orderNo for a stable,
// deterministic order (allProjectFiles() itself has no order guarantee beyond created_at desc
// from its own query - this makes the order explicit rather than relying on it incidentally).
async function boundedActiveProjectFiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ActiveProjectFile[]> {
  return (await allProjectFiles(supabase))
    .filter((order) => order.status === "active")
    .sort((a, b) => a.orderNo.localeCompare(b.orderNo))
    .slice(0, MAX_ATTENTION_ORDER_SCAN);
}

// PART 11/12/13/14/15: ERP Project Files only, via the shared bounded set above - never a second
// extraction path. Vendor identity reuses buildEffectiveDocumentGroups() - the exact same grouping
// the real Procurement UI/capability already uses - never a new/invented vendor alias. Caller
// already gates this behind requireProcurementManager() before it is ever invoked.
async function procurementFindings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  activeOrders: ActiveProjectFile[],
): Promise<NoaAttentionItem[]> {
  if (activeOrders.length === 0) return [];

  const quotationIds = activeOrders.map((order) => order.quotationId);
  const orderNos = activeOrders.map((order) => order.orderNo);

  const [{ data: itemRows }, { data: progressRows }] = await Promise.all([
    supabase
      .from("quotation_items")
      .select("quotation_id,brand_name_snapshot,supplier_name_snapshot")
      .in("quotation_id", quotationIds)
      .eq("is_active", true)
      .returns<ActiveOrderItemRow[]>(),
    supabase
      .from("procurement_vendor_progress")
      .select("order_no,vendor_key,eta,etd")
      .in("order_no", orderNos)
      .returns<VendorProgressRow[]>(),
  ]);

  const itemsByQuotationId = new Map<string, ActiveOrderItemRow[]>();
  for (const row of itemRows ?? []) {
    itemsByQuotationId.set(row.quotation_id, [...(itemsByQuotationId.get(row.quotation_id) ?? []), row]);
  }
  const progressByOrder = new Map<string, Map<string, VendorProgressRow>>();
  for (const row of progressRows ?? []) {
    const forOrder = progressByOrder.get(row.order_no) ?? new Map<string, VendorProgressRow>();
    forOrder.set(row.vendor_key, row);
    progressByOrder.set(row.order_no, forOrder);
  }

  // PART 18 #2: bounded Project File order (orderNo ascending, per the sort above), then vendor
  // order (buildEffectiveDocumentGroups()'s own stable insertion order), then missing ETA before
  // missing ETD - a fixed, documented order, never a severity ranking.
  const findings: NoaAttentionItem[] = [];
  for (const order of activeOrders) {
    const items = itemsByQuotationId.get(order.quotationId) ?? [];
    if (items.length === 0) continue;

    const vendorGroups = buildEffectiveDocumentGroups(items);
    const progressForOrder = progressByOrder.get(order.orderNo) ?? new Map<string, VendorProgressRow>();
    const detail = `${order.orderNo} · ${order.reference}`;

    for (const group of vendorGroups) {
      const progress = progressForOrder.get(group.dedupeKey);

      // PART 15: a real vendor group with no matching progress row, or with a null field, both
      // mean the same fact - that field is missing. No "late"/"stalled"/duration wording (PART
      // 16) - no timing rule exists to support it.
      if (!progress?.eta) {
        findings.push({
          key: `procurement_missing_eta:${order.orderNo}:${group.dedupeKey}`,
          sourceDomain: "Procurement",
          kind: "procurement_missing_eta",
          title: `${group.displayLabel} — ETA missing`,
          detail,
          entityType: "vendor",
          entityLabel: group.displayLabel,
          entityIdentifier: order.orderNo,
        });
      }
      if (!progress?.etd) {
        findings.push({
          key: `procurement_missing_etd:${order.orderNo}:${group.dedupeKey}`,
          sourceDomain: "Procurement",
          kind: "procurement_missing_etd",
          title: `${group.displayLabel} — ETD missing`,
          detail,
          entityType: "vendor",
          entityLabel: group.displayLabel,
          entityIdentifier: order.orderNo,
        });
      }
    }
  }

  return findings;
}

// N2A2 PART 3/4/5/6/7/8/9: same shared bounded ERP Project File set as Procurement - never a
// second unbounded scan. Schedule/installment/receipt reads are all scoped to that bounded set's
// quotation ids / the resulting schedule ids (PART 4/5/6), matching the exact authoritative field
// list and query shape the real payment panel (app/projects/orders/[orderNo]/page.tsx,
// components/projects/client-payment-panel.tsx) already uses - never a second/duplicated shape.
// `todayIso` uses that same panel's own convention (server-process local date, no invented
// timezone handling). Received-amount calculation reuses calculateClientPaymentSummary() -
// contractTotal is the ERP Project File's own authoritative order.total, the same value the real
// payment UI's contractTotal prop carries - never a second fils/currency calculation. A finding is
// created ONLY when deriveClientPaymentStatus() returns exactly "Overdue"; every other status
// (Planned/Due/Partially paid/Paid/Waived/Cancelled) is silently skipped. Caller already gates
// this behind canViewClientPayments(profile.role) before it is ever invoked.
async function clientPaymentFindings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  activeOrders: ActiveProjectFile[],
): Promise<NoaAttentionItem[]> {
  if (activeOrders.length === 0) return [];

  const quotationIds = activeOrders.map((order) => order.quotationId);
  const { data: scheduleRows } = await supabase
    .from("client_payment_schedules")
    .select("id,quotation_id,order_no")
    .in("quotation_id", quotationIds)
    .returns<ClientPaymentScheduleRow[]>();

  const schedules = scheduleRows ?? [];
  if (schedules.length === 0) return [];

  const scheduleByQuotationId = new Map(schedules.map((schedule) => [schedule.quotation_id, schedule]));
  const scheduleIds = schedules.map((schedule) => schedule.id);

  const [{ data: installmentRows }, { data: receiptRows }] = await Promise.all([
    supabase
      .from("client_payment_installments")
      .select("id,schedule_id,sequence_no,title,calculation_type,percentage,expected_amount,due_type,due_date,custom_due_description,due_triggered_at,status_override,note,created_at,updated_at")
      .in("schedule_id", scheduleIds)
      .order("sequence_no", { ascending: true })
      .returns<ClientPaymentInstallmentRow[]>(),
    supabase
      .from("client_payment_receipts")
      .select("id,schedule_id,installment_id,amount_received,received_on,payment_method,reference_number,bank_account_note,comment,recorded_by,created_at,voided_at,voided_by,void_reason")
      .in("schedule_id", scheduleIds)
      .returns<ClientPaymentReceiptRow[]>(),
  ]);

  const installmentsBySchedule = new Map<string, ClientPaymentInstallmentRow[]>();
  for (const row of installmentRows ?? []) {
    installmentsBySchedule.set(row.schedule_id, [...(installmentsBySchedule.get(row.schedule_id) ?? []), row]);
  }
  const receiptsBySchedule = new Map<string, ClientPaymentReceiptRow[]>();
  for (const row of receiptRows ?? []) {
    receiptsBySchedule.set(row.schedule_id, [...(receiptsBySchedule.get(row.schedule_id) ?? []), row]);
  }

  // PART 8: the same todayIso convention already used by client-payment-panel.tsx - a plain
  // server-process local date, no timezone conversion invented here.
  const todayIso = new Date().toISOString().slice(0, 10);

  // PART 11: bounded Project File order (already orderNo-ascending, the shared boundedActiveProjectFiles()
  // order), then installment sequence_no order (the installments query's own `.order(...)`) -
  // never a severity ranking.
  const findings: NoaAttentionItem[] = [];
  for (const order of activeOrders) {
    const schedule = scheduleByQuotationId.get(order.quotationId);
    if (!schedule) continue;

    const installments = installmentsBySchedule.get(schedule.id) ?? [];
    if (installments.length === 0) continue;
    const receipts = receiptsBySchedule.get(schedule.id) ?? [];

    const summary = calculateClientPaymentSummary(order.total, installments, receipts, todayIso);

    for (const installment of installments) {
      const receivedFils = summary.receivedByInstallment.get(installment.id) ?? BigInt(0);
      // PART 7/16: the existing pure helper decides Overdue - never reimplemented, never a new
      // date comparison here.
      const status = deriveClientPaymentStatus(installment, receivedFils, todayIso);
      if (status !== "Overdue") continue;

      findings.push({
        key: `payment_overdue:${order.orderNo}:${installment.id}`,
        sourceDomain: "ClientPayment",
        kind: "payment_overdue",
        title: `${installment.title} is overdue`,
        // PART 9/10: expected_amount only (never expected-minus-received arithmetic), formatted
        // via the existing money helper; the due label reuses clientPaymentDueLabel() - no
        // "late"/"critical"/"risk" wording, no severity interpretation.
        detail: `${order.orderNo} · ${formatPaymentMoney(order.currency, moneyToFils(installment.expected_amount))} · Due ${clientPaymentDueLabel(installment)}`,
        entityType: "installment",
        entityLabel: installment.title,
        entityIdentifier: order.orderNo,
      });
    }
  }

  return findings;
}

// PART 2 entry point: requireActiveUser() gates the whole response; each subsection independently
// re-checks its OWN existing domain gate before it reads anything, mirroring
// noa-insights-capability.server.ts's overviewAnswer() exactly - a permission gap in one
// subsection contributes zero findings from that subsection and never fails the other. No provider
// call anywhere in this file (PART 20) - `deterministicOnly: true` below makes the orchestrator's
// own existing generic short-circuit skip the provider entirely, the same mechanism UserActivity's
// deterministic-only answers already rely on.
export async function fetchNoaAttentionCapability(
  _message: string,
  _context: NoaPageContext,
): Promise<NoaCapabilityResult> {
  let profileRole: AppRole | null | undefined;
  try {
    const { profile } = await requireActiveUser();
    profileRole = profile?.role;
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const supabase = await createClient();

  let productPriceAvailable = true;
  let priceItems: NoaAttentionItem[] = [];
  try {
    await requireProductLibraryManager();
    priceItems = await productPriceFindings(supabase);
  } catch (error) {
    if (!isNextRedirectError(error)) throw error;
    productPriceAvailable = false;
  }

  // N2A2 PART 3: fetched once here and shared by both Procurement and Client Payment - never a
  // second independent Project File scan.
  const activeOrders = await boundedActiveProjectFiles(supabase);

  let procurementAvailable = true;
  let procurementItems: NoaAttentionItem[] = [];
  try {
    await requireProcurementManager();
    procurementItems = await procurementFindings(supabase, activeOrders);
  } catch (error) {
    if (!isNextRedirectError(error)) throw error;
    procurementAvailable = false;
  }

  // N2A2 PART 2: canViewClientPayments() is a plain boolean helper (never a redirect-throwing
  // requireX()) - reused directly against the role already returned by the base
  // requireActiveUser() call above, per the explicit "do not create a new requireClientPayments()
  // helper" instruction. Denial contributes zero findings and never queries a payment table.
  const clientPaymentsAvailable = canViewClientPayments(profileRole);
  const paymentItems = clientPaymentsAvailable ? await clientPaymentFindings(supabase, activeOrders) : [];

  // PART 11/18: Price findings, then Procurement, then Client Payment overdue - a fixed,
  // documented order, never a severity ranking. PART 19: the display/structured list is bounded
  // to MAX_ATTENTION_ITEMS - `count` is this same bounded array's length (never a separate "total
  // matches" figure).
  const items = [...priceItems, ...procurementItems, ...paymentItems].slice(0, MAX_ATTENTION_ITEMS);
  const count = items.length;

  // N2A2.1: the same vendor can legitimately recur across different ERP Project Files (a real,
  // non-duplicate finding each time - PART 1, never deduplicated). Only the bullet TEXT lacked
  // that Project File identity, making distinct findings look like repeats. Procurement's own
  // `detail` field already carries `entityIdentifier` (order.orderNo); this only decides how the
  // bullet line is RENDERED, never the underlying item/title/detail/key - Price and Client
  // Payment bullets are deliberately left exactly as before (PART 4/5).
  // N2A3.3: Procurement bullets now lead with the SAME `detail` text already built in
  // procurementFindings() (`${order.orderNo} · ${order.reference}`, e.g. "CO-0003-001 ·
  // Galleria Mall Boutique Refurbishment") instead of the bare orderNo, so the Project File is
  // immediately identifiable without the user needing to remember which CO belongs to which
  // project - zero new data, reusing the exact field already present on every procurement item.
  // Client name is deliberately left out of the bullet (Part 3: available at zero cost, but
  // omitted here to avoid clutter - it remains only in `items[].detail` for a consumer that wants
  // it). Price/Payment bullets are untouched.
  const attentionBulletText = (item: NoaAttentionItem) => item.sourceDomain === "Procurement" && item.detail
    ? `${item.detail} · ${item.title}`
    : item.title;

  const deterministicText = count === 0
    ? "Nothing currently matches the Attention checks available to you."
    : [
      `I found ${count} item${count === 1 ? "" : "s"} that need attention.`,
      "",
      ...items.map((item) => `• ${attentionBulletText(item)}.`),
    ].join("\n");

  return {
    data: {
      count,
      deterministicOnly: true,
      items,
      kind: "attention",
      sections: { clientPaymentsAvailable, procurementAvailable, productPriceAvailable },
      deterministicText,
    },
    ok: true,
    sources: [{ label: "Attention · Checked authorized ProjectWorkflow records", type: "attention" }],
  };
}
