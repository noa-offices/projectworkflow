import Link from "next/link";
import { notFound } from "next/navigation";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ProjectActivityTimeline, type ProjectActivityVendor } from "@/components/projects/project-activity-timeline";
import { ProjectExecutionStatus } from "@/components/projects/project-execution-status";
import { canAccessProcurement, canManageClientPaymentReceiptAttachments, canViewClientPayments, canVoidClientPaymentReceipts, requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type React from "react";
import { DocumentRow, ProjectDocumentsDirectory, type VendorDocEntry } from "@/components/projects/project-document-row";
import { type ProjectDocRecord } from "@/lib/projects/project-doc-action";
import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";
import { MarkCompletedButton } from "@/components/projects/mark-completed-button";
import { CancelProjectButton } from "@/components/projects/cancel-project-button";
import { ReopenProjectButton } from "@/components/projects/reopen-project-button";
import { NotifyButton } from "@/components/notifications/notify-button";
import { ProjectFileResponsiveLayout } from "@/components/projects/project-file-responsive-layout";
import { ProjectVendorOperations, type ProjectVendorOperationsSummary } from "@/components/projects/project-vendor-operations";
import { ClientPaymentNoAccess, ClientPaymentPanel } from "@/components/projects/client-payment-panel";
import { formatPaymentMoney, moneyToFils, type ClientPaymentAttachmentRow, type ClientPaymentInstallmentRow, type ClientPaymentReceiptRow, type ClientPaymentScheduleRow } from "@/lib/projects/client-payment-model";

export const dynamic = "force-dynamic";

type ConfirmedOrderPageProps = {
  params: Promise<{ orderNo: string }>;
  searchParams?: Promise<{ message?: string }>;
};

type ConfirmedOrderQuotationRow = {
  id: string;
  layout_settings: unknown;
  quotation_no: string | null;
  title: string;
  currency: string;
  grand_total: number;
  vat_percent: number;
  overall_discount_type: string;
  overall_discount_value: number;
  subtotal: number;
  discount_total: number;
  vat_amount: number;
  payment_terms: string | null;
  delivery_terms: string | null;
  notes: string | null;
  status: string;
};

type QuotationItemRow = {
  id: string;
  item_name_snapshot: string | null;
  item_code_snapshot: string | null;
  brand_name_snapshot: string | null;
  size_snapshot: string | null;
  finish_snapshot: string | null;
  supplier_name_snapshot: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  net_price: number;
  net_total: number;
  currency: string;
  sort_order: number;
  is_optional: boolean;
  is_active: boolean;
  line_style: string;
};

type VendorProgressRow = { vendor_key: string; active_step: number; etd: string | null; eta: string | null };
type ProcurementVendorDocRow = { id: string; vendor_key: string; slot_key: string; file_name: string; public_url: string };

const PROCUREMENT_STAGE_LABELS = [
  "RFQ",
  "PO Issued",
  "Deposit Paid",
  "In Production",
  "Quality Check",
  "Ready for Shipment",
  "In Transit",
  "Delivered & Installed",
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default async function ConfirmedOrderPage({ params, searchParams }: ConfirmedOrderPageProps) {
  const [{ user, profile, displayName }, { orderNo }, query] = await Promise.all([
    requireActiveUser(),
    params,
    searchParams ?? Promise.resolve({} as { message?: string }),
  ]);
  const decodedOrderNo = decodeURIComponent(orderNo);
  const canProcure = canAccessProcurement(profile?.role);
  const canEditExecutionStatus = profile?.role === "system_owner" || profile?.role === "admin_manager";
  const mayViewClientPayments = canViewClientPayments(profile?.role);
  // System Owner and Admin Manager only.
  // procurement_manager gets full activity control in Procurement tab (Phase 3B).
  const canLog =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager";
  const supabase = await createSupabaseClient();

  const { data: quotations, error } = await supabase
    .from("quotations")
    .select("id,layout_settings,quotation_no,title,currency,grand_total,vat_percent,overall_discount_type,overall_discount_value,subtotal,discount_total,vat_amount,payment_terms,delivery_terms,notes,status")
    .eq("status", "client_confirmed")
    .limit(200)
    .returns<ConfirmedOrderQuotationRow[]>();

  if (error) {
    console.error("CONFIRMED ORDER DETAIL ERROR", error.message);
    notFound();
  }

  const entry = (quotations ?? [])
    .map((quotation) => {
      const projectFile = projectFileFromLayoutSettings(quotation.layout_settings);
      if (projectFile?.orderNo === decodedOrderNo) {
        return { quotationId: quotation.id, draft: null, order: projectFile, quotationRow: quotation };
      }
      const draft = clientApprovalDraftFromLayoutSettings(quotation.layout_settings);
      return draft?.confirmedOrder?.orderNo === decodedOrderNo
        ? { quotationId: quotation.id, draft, order: draft.confirmedOrder, quotationRow: quotation }
        : null;
    })
    .find((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  if (!entry) {
    notFound();
  }

  const { data: items, error: itemsError } = await supabase
    .from("quotation_items")
    .select("id,item_name_snapshot,item_code_snapshot,brand_name_snapshot,size_snapshot,finish_snapshot,supplier_name_snapshot,qty,unit_label,unit_price,net_price,net_total,currency,sort_order,is_optional,is_active,line_style")
    .eq("quotation_id", entry.quotationId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<QuotationItemRow[]>();

  if (itemsError) {
    console.error("CONFIRMED ORDER ITEMS ERROR", itemsError.message);
  }

  const procurementVendorGroups = buildEffectiveDocumentGroups(items ?? []);

  const { data: projectDocs } = await supabase
    .from("project_document_attachments")
    .select("id, slot_key, file_name, storage_path, public_url")
    .eq("order_no", decodedOrderNo)
    .returns<ProjectDocRecord[]>();

  const projectDocsMap = new Map<string, ProjectDocRecord[]>();
  for (const doc of projectDocs ?? []) {
    const existing = projectDocsMap.get(doc.slot_key) ?? [];
    projectDocsMap.set(doc.slot_key, [...existing, doc]);
  }

  const { data: activityLogs } = await supabase
    .from("audit_activity_log")
    .select("id, entity_type, action, title, description, created_at, created_by, metadata")
    .or(`parent_entity_id.eq.${entry.quotationId},metadata->>orderNo.eq.${decodedOrderNo}`)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<Array<{
      id: string;
      entity_type: string;
      action: string;
      title: string;
      description: string | null;
      created_at: string;
      created_by: string | null;
      metadata: unknown;
    }>>();

  const { data: rawVendorProgress } = await supabase
    .from("procurement_vendor_progress")
    .select("vendor_key, active_step, etd, eta")
    .eq("order_no", decodedOrderNo)
    .returns<VendorProgressRow[]>();

  const layoutSettingsObj = entry.quotationRow.layout_settings as Record<string, unknown> | null;
  const completedAt = typeof layoutSettingsObj?.projectCompletedAt === "string"
    ? layoutSettingsObj.projectCompletedAt
    : null;
  const cancelledAt = typeof layoutSettingsObj?.projectCancelledAt === "string"
    ? layoutSettingsObj.projectCancelledAt
    : null;

  let clientPaymentSchedule: ClientPaymentScheduleRow | null = null;
  let clientPaymentInstallments: ClientPaymentInstallmentRow[] = [];
  let clientPaymentReceipts: ClientPaymentReceiptRow[] = [];
  let clientPaymentAttachments: ClientPaymentAttachmentRow[] = [];
  if (mayViewClientPayments) {
    const { data: schedule, error: scheduleError } = await supabase
      .from("client_payment_schedules")
      .select("id, quotation_id, order_no")
      .eq("quotation_id", entry.quotationId)
      .eq("order_no", decodedOrderNo)
      .maybeSingle<ClientPaymentScheduleRow>();
    if (scheduleError) console.error("CLIENT PAYMENT SCHEDULE READ ERROR", scheduleError.message);
    clientPaymentSchedule = schedule ?? null;
    if (clientPaymentSchedule) {
      const [installmentsResult, receiptsResult] = await Promise.all([
        supabase
          .from("client_payment_installments")
          .select("id, schedule_id, sequence_no, title, calculation_type, percentage, expected_amount, due_type, due_date, custom_due_description, due_triggered_at, status_override, note, created_at, updated_at")
          .eq("schedule_id", clientPaymentSchedule.id)
          .order("sequence_no", { ascending: true })
          .returns<ClientPaymentInstallmentRow[]>(),
        supabase
          .from("client_payment_receipts")
          .select("id, schedule_id, installment_id, amount_received, received_on, payment_method, reference_number, bank_account_note, comment, recorded_by, created_at, voided_at, voided_by, void_reason")
          .eq("schedule_id", clientPaymentSchedule.id)
          .order("received_on", { ascending: false })
          .order("created_at", { ascending: false })
          .returns<ClientPaymentReceiptRow[]>(),
      ]);
      if (installmentsResult.error) console.error("CLIENT PAYMENT INSTALLMENTS READ ERROR", installmentsResult.error.message);
      if (receiptsResult.error) console.error("CLIENT PAYMENT RECEIPTS READ ERROR", receiptsResult.error.message);
      clientPaymentInstallments = installmentsResult.data ?? [];
      clientPaymentReceipts = receiptsResult.data ?? [];
      const receiptIds = clientPaymentReceipts.map((receipt) => receipt.id);
      const attachmentsResult = receiptIds.length > 0
        ? await supabase
            .from("client_payment_receipt_attachments")
            .select("id, receipt_id, file_name, mime_type, file_size_bytes, created_by, created_at")
            .in("receipt_id", receiptIds)
            .order("created_at", { ascending: true })
            .returns<Array<Omit<ClientPaymentAttachmentRow, "uploader_label">>>()
        : { data: [] as Array<Omit<ClientPaymentAttachmentRow, "uploader_label">>, error: null };
      if (attachmentsResult.error) console.error("CLIENT PAYMENT ATTACHMENTS READ ERROR", attachmentsResult.error.message);
      const attachmentRows = attachmentsResult.data ?? [];
      const uploaderIds = [...new Set(attachmentRows.map((attachment) => attachment.created_by))];
      const uploaderLabels = new Map<string, string>();
      if (uploaderIds.length > 0) {
        const { data: uploaders } = await supabase
          .from("profiles")
          .select("id, full_name, role")
          .in("id", uploaderIds)
          .returns<Array<{ id: string; full_name: string | null; role: string | null }>>();
        for (const uploader of uploaders ?? []) {
          const roleLabel = uploader.role === "system_owner" ? "System Owner" : uploader.role === "admin_manager" ? "Admin Manager" : "Authorised user";
          uploaderLabels.set(uploader.id, uploader.full_name?.trim() || roleLabel);
        }
      }
      clientPaymentAttachments = attachmentRows.map((attachment) => ({
        ...attachment,
        uploader_label: uploaderLabels.get(attachment.created_by) ?? "Authorised user",
      }));
    }
  }

  const { data: rawPiOcDocs } = await supabase
    .from("procurement_vendor_docs")
    .select("id, vendor_key, slot_key, file_name, public_url")
    .eq("order_no", decodedOrderNo)
    .in("slot_key", ["pi", "oc"])
    .returns<ProcurementVendorDocRow[]>();

  const vendorLabelMap = new Map(
    procurementVendorGroups.map((group) => [group.dedupeKey, group.displayLabel]),
  );

  const piOcVendorDocs: VendorDocEntry[] = (rawPiOcDocs ?? []).map((d: ProcurementVendorDocRow) => ({
    id: d.id,
    vendorKey: d.vendor_key,
    vendorLabel: vendorLabelMap.get(d.vendor_key) ?? d.vendor_key.toUpperCase(),
    slotKey: d.slot_key,
    fileName: d.file_name,
    publicUrl: d.public_url,
  }));

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-AE", { style: "currency", currency: entry.order.currency }).format(value);

  const vendorProgressMap = new Map(
    (rawVendorProgress ?? []).map((progress: VendorProgressRow) => [progress.vendor_key, progress]),
  );
  const vendorOperations: ProjectVendorOperationsSummary[] = procurementVendorGroups.map((group) => {
    const groupItems = group.items as QuotationItemRow[];
    const totalValue = groupItems.reduce((sum, item) => sum + (typeof item.net_total === "number" ? item.net_total : 0), 0);
    const currency = groupItems.find((item) => item.currency?.trim())?.currency ?? entry.order.currency;
    const progress = vendorProgressMap.get(group.dedupeKey);
    const activeStep = Math.min(Math.max(progress?.active_step ?? 0, 0), PROCUREMENT_STAGE_LABELS.length - 1);
    return {
      vendorKey: group.dedupeKey,
      vendorLabel: group.displayLabel,
      itemCount: groupItems.filter((item) => item.line_style !== "heading").length,
      formattedTotal: formatQuotationMoney(currency, totalValue),
      currentStage: PROCUREMENT_STAGE_LABELS[activeStep],
      activeStep,
      etd: progress?.etd ?? null,
      eta: progress?.eta ?? null,
    };
  });
  const activityVendors: ProjectActivityVendor[] = vendorOperations.map((vendor) => ({
    vendorKey: vendor.vendorKey,
    vendorLabel: vendor.vendorLabel,
    itemCount: vendor.itemCount,
    formattedTotal: vendor.formattedTotal,
    currentStage: vendor.currentStage,
  }));
  const storedProjectStatus = completedAt ? "Completed" : cancelledAt ? "Cancelled" : "Confirmed";
  const vendorSteps = vendorOperations.map((vendor) => vendor.activeStep);
  const suggestedProjectStatus = completedAt
    ? "Completed"
    : cancelledAt
      ? "Cancelled"
      : vendorSteps.length === 0
        ? "Confirmed"
        : vendorSteps.every((step) => step >= 7)
          ? "Handover pending"
          : vendorSteps.some((step) => step >= 7)
            ? "Installation in progress"
            : vendorSteps.some((step) => step >= 6)
              ? "Logistics in progress"
              : vendorSteps.some((step) => step >= 3)
                ? "Production in progress"
                : "Procurement in progress";
  const today = new Date().toISOString().slice(0, 10);
  const nextExpectedEta = vendorOperations
    .filter((vendor) => vendor.eta && vendor.eta >= today)
    .sort((left, right) => (left.eta ?? "").localeCompare(right.eta ?? ""))[0] ?? null;

  const numberedItems = (items ?? []).map((item, index, allItems) => {
    const isHeading = item.line_style === "heading";
    const rowNumber = isHeading
      ? null
      : allItems.slice(0, index + 1).filter((candidate) => candidate.line_style !== "heading").length;
    return { item, rowNumber };
  });
  const rowCounter = numberedItems.filter(({ rowNumber }) => rowNumber !== null).length;

  // ── Shared JSX blocks (used in both active and completed layouts) ──────
  const lockedItemsSection = (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-3 py-3 xl:px-5 xl:py-4">
        <h2 className="text-lg font-semibold text-zinc-950">Locked Items</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Snapshot from the approved quotation {entry.order.quotationNo ?? entry.order.orderNo}.
        </p>
      </div>
      <div className="px-3 py-2 xl:px-5 xl:py-3">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
          This is a locked snapshot of the approved quotation. Items cannot be edited here.
        </p>
      </div>
      <div className="min-w-0 xl:hidden">
        {numberedItems.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-400">No items found for this project file.</p>
        ) : numberedItems.map(({ item, rowNumber }) => {
          if (item.line_style === "heading") {
            return (
              <p key={item.id} className="border-t border-zinc-100 bg-zinc-50 px-3 py-2 text-xs font-bold uppercase text-zinc-700">
                {item.item_name_snapshot ?? item.item_code_snapshot ?? ""}
              </p>
            );
          }
          const sizeFinish = [item.size_snapshot, item.finish_snapshot].filter(Boolean).join(" / ");
          return (
            <div key={item.id} className={`grid min-h-16 min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-2 border-t border-zinc-100 px-3 py-2 ${item.is_optional ? "bg-zinc-50" : "bg-white"}`}>
              <span className="pt-0.5 text-xs font-semibold text-zinc-400">{rowNumber}</span>
              <div className="min-w-0">
                <div className="flex min-w-0 items-start gap-2">
                  <p className={`line-clamp-2 min-w-0 flex-1 text-sm font-medium ${item.is_optional ? "italic text-zinc-600" : "text-zinc-900"}`}>
                    {item.item_name_snapshot ?? item.item_code_snapshot ?? "-"}
                  </p>
                  {item.is_optional ? <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">Optional</span> : null}
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500" title={item.brand_name_snapshot ?? undefined}>{item.brand_name_snapshot ?? "No brand"}</p>
                <p className="mt-0.5 truncate text-xs text-zinc-500" title={sizeFinish || undefined}>Size / Finish: {sizeFinish || "-"}</p>
                <p className="mt-0.5 truncate text-xs text-zinc-500" title={item.supplier_name_snapshot ?? undefined}>Supplier: {item.supplier_name_snapshot ?? "-"}</p>
                <p className="mt-1 text-xs font-semibold text-zinc-700">Qty: {item.qty} {item.unit_label} &middot; Net: {formatCurrency(item.net_total)}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden max-h-[450px] overflow-y-auto rounded-md border border-zinc-200 xl:block">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50">
            <tr className="bg-zinc-50">
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">#</th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">Item Description</th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">Brand</th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">Size / Finish</th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">Supplier</th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Qty</th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Unit Price</th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">Net Total</th>
            </tr>
          </thead>
          <tbody>
            {numberedItems.map(({ item, rowNumber }) => {
              if (item.line_style === "heading") {
                return (
                  <tr key={item.id} className="bg-zinc-50">
                    <td colSpan={8} className="px-4 py-2 text-sm font-semibold text-zinc-950">
                      {item.item_name_snapshot ?? item.item_code_snapshot ?? ""}
                    </td>
                  </tr>
                );
              }
              const sizeFinish = [item.size_snapshot, item.finish_snapshot].filter(Boolean).join(" / ");
              return (
                <tr
                  key={item.id}
                  className={`border-b border-zinc-100 ${item.is_optional ? "opacity-70" : ""}`}
                >
                  <td className="px-4 py-3 text-sm text-zinc-400">{rowNumber}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={item.is_optional ? "italic text-zinc-500" : "text-zinc-900"}>
                      {item.item_name_snapshot ?? item.item_code_snapshot ?? "-"}
                    </span>
                    {item.is_optional ? (
                      <span className="ml-2 inline-flex rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500">
                        Optional
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-600">{item.brand_name_snapshot ?? "-"}</td>
                  <td className="px-4 py-3 text-sm text-zinc-600">{sizeFinish || "-"}</td>
                  <td className="px-4 py-3 text-sm text-zinc-600">{item.supplier_name_snapshot ?? "-"}</td>
                  <td className="px-4 py-3 text-right text-sm text-zinc-900">
                    {item.qty} {item.unit_label}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-zinc-900">{formatCurrency(item.unit_price)}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-zinc-950">{formatCurrency(item.net_total)}</td>
                </tr>
              );
            })}
            {numberedItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-zinc-400">
                  No items found for this project file.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-200">
              <td colSpan={7} className="px-4 py-3 text-right text-sm font-semibold text-zinc-500">
                Subtotal
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-zinc-950">
                {formatCurrency(entry.quotationRow.subtotal)}
              </td>
            </tr>
            <tr>
              <td colSpan={7} className="px-4 py-3 text-right text-sm font-semibold text-zinc-500">
                VAT {entry.quotationRow.vat_percent}%
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-zinc-950">
                {formatCurrency(entry.quotationRow.vat_amount)}
              </td>
            </tr>
            <tr className="border-t border-zinc-200 bg-zinc-50">
              <td colSpan={7} className="px-4 py-3 text-right text-sm font-bold text-zinc-950">
                Grand Total
              </td>
              <td className="px-4 py-3 text-right text-sm font-bold text-zinc-950">
                {formatCurrency(entry.quotationRow.grand_total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );

  const documentsSection = (
    <ProjectDocumentsDirectory>
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-3 py-3 xl:px-5 xl:py-4">
        <h2 className="text-base font-semibold text-zinc-950">Project Documents</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Segregated document directory for this project file.
        </p>
      </div>
      <div className="grid xl:grid-cols-2">
        {/* ─── ROW 1 LEFT: CORE SALES ──────────────────────────── */}
        <div className="border-b border-zinc-100 px-3 py-3 xl:border-r xl:px-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            📄 Core Sales
          </p>
          <div className="grid gap-2">
            <DocumentRow
              iconKey="file-text"
              label="Approved Quotation"
              hint="Signed or client-confirmed quotation PDF"
              orderNo={decodedOrderNo}
              initialDoc={projectDocsMap.get("approved_quotation") ?? []}
            />
            <DocumentRow
              iconKey="clipboard-list"
              label="Technical Specifications"
              hint="Spec sheets, material finishes, custom requirements"
              orderNo={decodedOrderNo}
              initialDoc={projectDocsMap.get("technical_specifications") ?? []}
            />
            <DocumentRow
              iconKey="shopping-cart"
              label="Approved PO"
              hint="Client-issued purchase order. Manual upload only."
              slotKeyOverride="purchase_orders_(po)"
              orderNo={decodedOrderNo}
              initialDoc={projectDocsMap.get("purchase_orders_(po)") ?? []}
            />
          </div>
        </div>
        {/* ─── ROW 1 RIGHT: DESIGN & DRAWINGS ─────────────────── */}
        <div className="border-b border-zinc-100 px-3 py-3 xl:px-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            📐 Design & Drawings
          </p>
          <div className="grid gap-2">
            <DocumentRow
              iconKey="ruler"
              label="Floor Plans & Furniture Layouts"
              hint="CAD files, DWG, PDF layout drawings"
              orderNo={decodedOrderNo}
              initialDoc={projectDocsMap.get("floor_plans_&_furniture_layouts") ?? []}
            />
          </div>
        </div>
        {/* ─── ROW 2 LEFT: PROCUREMENT ─────────────────────────── */}
        <div className="border-b border-zinc-100 px-3 py-3 xl:border-r xl:px-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            🏭 Procurement
          </p>
          <div className="grid gap-2">
            <DocumentRow
              iconKey="package-check"
              label="PI/OC"
              hint="Proforma Invoices and Order Confirmations from all vendors. Auto-linked from Procurement."
              procurementLinked
              slotKeyOverride="order_confirmations_(oc)"
              vendorDocs={piOcVendorDocs}
              orderNo={decodedOrderNo}
              initialDoc={projectDocsMap.get("order_confirmations_(oc)") ?? []}
            />
          </div>
        </div>
        {/* ─── ROW 2 RIGHT: LOGISTICS ──────────────────────────── */}
        <div className="border-b border-zinc-100 px-3 py-3 xl:px-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            🚚 Logistics
          </p>
          <div className="grid gap-2">
            <DocumentRow
              iconKey="truck"
              label="Delivery Notes & Installation Sign-offs"
              hint="Signed delivery receipts, installation completion forms"
              orderNo={decodedOrderNo}
              initialDoc={projectDocsMap.get("delivery_notes_&_installation_sign-offs") ?? []}
            />
          </div>
        </div>
        {/* ─── ROW 3 LEFT: WARRANTY & MAINTENANCE ─────────────── */}
        <div className="border-b border-zinc-100 px-3 py-3 xl:border-r xl:px-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            🛠️ Warranty & Maintenance
          </p>
          <div className="grid gap-2">
            <DocumentRow
              iconKey="wrench"
              label="Warranty & Care Manuals"
              hint="Chair mechanism warranties, fabric care sheets, product guarantees"
              accept=".pdf,.doc,.docx"
              orderNo={decodedOrderNo}
              initialDoc={projectDocsMap.get("warranty_&_care_manuals") ?? []}
            />
          </div>
        </div>
        {/* ─── ROW 3 RIGHT: SITE EXECUTION ─────────────────────── */}
        <div className="border-b border-zinc-100 px-3 py-3 xl:px-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            📝 Site Execution
          </p>
          <div className="grid gap-2">
            <DocumentRow
              iconKey="sticky-note"
              label="Snag / Punch Lists"
              hint="Site damage notes, replacement tracking, pre-sign-off punch items"
              accept=".pdf,.doc,.docx,.jpg,.png"
              orderNo={decodedOrderNo}
              initialDoc={projectDocsMap.get("snag_/_punch_lists") ?? []}
            />
          </div>
        </div>
        {/* ─── ROW 4 LEFT: MISCELLANEOUS (alone) ───────────────── */}
        <div className="px-3 py-3 xl:px-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            📁 Miscellaneous
          </p>
          <div className="grid gap-2">
            <DocumentRow
              iconKey="folder-open"
              label="Other Documents"
              hint="General correspondence, custom attachments, any additional files"
              orderNo={decodedOrderNo}
              initialDoc={projectDocsMap.get("other_documents") ?? []}
            />
          </div>
        </div>
      </div>
    </section>
    </ProjectDocumentsDirectory>
  );

  const overviewHighlights = (
    <section className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm xl:p-5">
      <h2 className="text-sm font-semibold text-zinc-950">Operational Summary</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Vendor progress", `${vendorOperations.length} vendor ${vendorOperations.length === 1 ? "group" : "groups"}`],
          ["Suggested next stage", suggestedProjectStatus],
          ["Next recorded ETA", nextExpectedEta ? `${nextExpectedEta.vendorLabel} - ${formatDate(nextExpectedEta.eta!)}` : "No upcoming ETA recorded"],
          ["Outstanding client payment", mayViewClientPayments
            ? formatPaymentMoney(entry.order.currency, (() => {
                const received = clientPaymentReceipts.reduce((total, receipt) => receipt.voided_at ? total : total + moneyToFils(receipt.amount_received), BigInt(0));
                const contract = moneyToFils(String(entry.order.total));
                return contract > received ? contract - received : BigInt(0);
              })())
            : "Restricted"],
          ["Active delay / risk", "Unavailable - no stored risk field"],
          ["Recent activity", activityLogs?.[0]?.title ?? "No activity recorded"],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 border-b border-zinc-100 pb-2">
            <dt className="font-semibold text-zinc-500">{label}</dt>
            <dd className="mt-1 break-words text-zinc-800">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );

  const vendorsSection = <ProjectVendorOperations mode="vendors" orderNo={decodedOrderNo} vendors={vendorOperations} />;
  const scheduleSection = <ProjectVendorOperations mode="schedule" orderNo={decodedOrderNo} vendors={vendorOperations} />;
  const paymentsSection = mayViewClientPayments ? (
    <ClientPaymentPanel
      schedule={clientPaymentSchedule}
      installments={clientPaymentInstallments}
      receipts={clientPaymentReceipts}
      attachments={clientPaymentAttachments}
      quotationId={entry.quotationId}
      orderNo={decodedOrderNo}
      contractTotal={String(entry.order.total)}
      currency={entry.order.currency}
      paymentTerms={entry.quotationRow.payment_terms}
      scheduleReadOnly={Boolean(completedAt || cancelledAt)}
      receiptsAllowed={!cancelledAt}
      canVoid={canVoidClientPaymentReceipts(profile?.role)}
      canManageAttachments={canManageClientPaymentReceiptAttachments(profile?.role)}
    />
  ) : <ClientPaymentNoAccess />;

  const projectActions = (
    <>
      <Link href={`/quotations/${entry.quotationId}`} className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800">
        Open Quotation
      </Link>
      {canProcure ? (
        <Link href={`/quotations/${entry.quotationId}/order-confirmation`} className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
          Order Confirmation
        </Link>
      ) : (
        <p className="text-xs text-zinc-400">Procurement documents require Procurement Manager access.</p>
      )}
      <Link href={`/procurement/orders/${decodedOrderNo}`} className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-4 text-sm font-semibold text-violet-800 transition hover:bg-violet-100">
        {"\uD83C\uDF10"} Open Procurement Workspace
      </Link>
      {canEditExecutionStatus ? (
        <>
          <MarkCompletedButton quotationId={entry.quotationId} orderNo={decodedOrderNo} completedAt={completedAt} />
          <CancelProjectButton quotationId={entry.quotationId} orderNo={decodedOrderNo} />
        </>
      ) : null}
      <NotifyButton orderNo={decodedOrderNo} />
    </>
  );

  const renderActivity = (allowLogging: boolean) => (
    <ProjectActivityTimeline
      orderNo={decodedOrderNo}
      quotationId={entry.quotationId}
      canLog={allowLogging}
      initialEvents={activityLogs ?? []}
      vendors={activityVendors}
    />
  );
  const renderExecutionStatus = (allowEditing: boolean) => (
    <ProjectExecutionStatus
      orderNo={decodedOrderNo}
      quotationId={entry.quotationId}
      canEdit={allowEditing}
      storedStatus={storedProjectStatus}
      suggestedStatus={suggestedProjectStatus}
    />
  );

  // ── Completed project — simplified read-only view ─────────────────────
  if (completedAt) {
    return (
      <ErpAppShell
        eyebrow="PROJECTS"
        title={`Project File ${entry.order.orderNo}`}
        description="Completed project — read-only view."
        role={profile?.role ?? null}
        userDisplayName={displayName}
        userEmail={user.email}
        userAvatarUrl={profile?.avatar_url ?? null}
        userRole={profile?.role ?? null}
        isCompletedProject
      >
        <div className="px-3 py-4 xl:px-8 xl:py-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
            <Link
              href="/projects/completed"
              className="text-sm font-semibold text-emerald-800 transition hover:text-emerald-950"
            >
              ← Back to Completed Projects
            </Link>
            <span className="text-sm font-semibold text-emerald-900">
              ✓ Completed {formatDate(completedAt)}
            </span>
            {canEditExecutionStatus && (
              <ReopenProjectButton
                quotationId={entry.quotationId}
                orderNo={decodedOrderNo}
              />
            )}
          </div>
          <ProjectFileResponsiveLayout
            activity={renderActivity(false)}
            clientName={entry.order.clientName}
            createdAt={formatDate(entry.order.createdAt)}
            documents={documentsSection}
            executionStatus={renderExecutionStatus(false)}
            itemCount={rowCounter}
            items={lockedItemsSection}
            overviewHighlights={overviewHighlights}
            orderNo={entry.order.orderNo}
            quotationNo={entry.order.quotationNo}
            reference={entry.order.reference}
            sourceFolder={entry.order.folderNo}
            status="Completed"
            schedule={scheduleSection}
            total={formatQuotationMoney(entry.order.currency, entry.order.total)}
            vendors={vendorsSection}
            payments={paymentsSection}
          />
        </div>
      </ErpAppShell>
    );
  }

  // ── Cancelled project — simplified read-only view ────────────────────
  if (cancelledAt) {
    return (
      <ErpAppShell
        eyebrow="PROJECTS"
        title={`Project File ${entry.order.orderNo}`}
        description="Cancelled project — read-only view."
        role={profile?.role ?? null}
        userDisplayName={displayName}
        userEmail={user.email}
        userAvatarUrl={profile?.avatar_url ?? null}
        userRole={profile?.role ?? null}
      >
        <div className="px-3 py-4 xl:px-8 xl:py-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <Link
              href="/projects/orders"
              className="text-sm font-semibold text-red-800 transition hover:text-red-950"
            >
              ← Back to Active Projects
            </Link>
            <span className="text-sm font-semibold text-red-900">
              ✕ Cancelled {formatDate(cancelledAt)}
            </span>
          </div>
          <ProjectFileResponsiveLayout
            activity={renderActivity(false)}
            clientName={entry.order.clientName}
            createdAt={formatDate(entry.order.createdAt)}
            documents={documentsSection}
            executionStatus={renderExecutionStatus(false)}
            itemCount={rowCounter}
            items={lockedItemsSection}
            overviewHighlights={overviewHighlights}
            orderNo={entry.order.orderNo}
            quotationNo={entry.order.quotationNo}
            reference={entry.order.reference}
            sourceFolder={entry.order.folderNo}
            status="Cancelled"
            schedule={scheduleSection}
            total={formatQuotationMoney(entry.order.currency, entry.order.total)}
            vendors={vendorsSection}
            payments={paymentsSection}
          />
        </div>
      </ErpAppShell>
    );
  }

  // ── Active project — full workspace ──────────────────────────────────
  return (
    <ErpAppShell
      eyebrow="PROJECTS"
      title={`Project File ${entry.order.orderNo}`}
      description="Project file from a client-approved quotation. Procurement documents come later."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-3 py-4 xl:px-8 xl:py-6">
        {query.message ? (
          <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            {query.message}
          </p>
        ) : null}

        <ProjectFileResponsiveLayout
          actions={projectActions}
          activity={renderActivity(canLog)}
          clientName={entry.order.clientName}
          createdAt={formatDate(entry.order.createdAt)}
          documents={documentsSection}
          executionStatus={renderExecutionStatus(canEditExecutionStatus)}
          itemCount={rowCounter}
          items={lockedItemsSection}
          overviewHighlights={overviewHighlights}
          orderNo={entry.order.orderNo}
          quotationNo={entry.order.quotationNo}
          reference={entry.order.reference}
          sourceFolder={entry.order.folderNo}
          status="Confirmed"
          schedule={scheduleSection}
          total={formatQuotationMoney(entry.order.currency, entry.order.total)}
          vendors={vendorsSection}
          payments={paymentsSection}
        />
      </div>
    </ErpAppShell>
  );
}
