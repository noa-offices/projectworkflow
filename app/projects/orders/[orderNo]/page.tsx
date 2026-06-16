import Link from "next/link";
import { notFound } from "next/navigation";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ProjectActivityTimeline } from "@/components/projects/project-activity-timeline";
import { ProjectExecutionStatus } from "@/components/projects/project-execution-status";
import { canAccessProcurement, requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
      <dt className="text-xs font-semibold uppercase text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-zinc-950">{value}</dd>
    </div>
  );
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
  // System Owner and Admin Manager only.
  // procurement_manager gets full activity control in Procurement tab (Phase 3B).
  const canLog =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager";
  const supabase = await createSupabaseClient();

  const { data: quotations, error } = await supabase
    .from("quotations")
    .select("id,layout_settings,quotation_no,title,currency,grand_total,vat_percent,overall_discount_type,overall_discount_value,subtotal,discount_total,vat_amount,payment_terms,delivery_terms,notes,status")
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

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-AE", { style: "currency", currency: entry.order.currency }).format(value);

  let rowCounter = 0;
  const numberedItems = (items ?? []).map((item) => {
    const isHeading = item.line_style === "heading";
    if (!isHeading) rowCounter += 1;
    return { item, rowNumber: isHeading ? null : rowCounter };
  });

  return (
    <ErpAppShell
      eyebrow="PROJECTS"
      title={`Project File ${entry.order.orderNo}`}
      description="Project file from a client-approved quotation. Procurement documents come later."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        {query.message ? (
          <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            {query.message}
          </p>
        ) : null}

        {/* Section 1: Action buttons */}
        <div className="mb-6 flex flex-wrap gap-2">
          <Link
            href={`/quotations/${entry.quotationId}`}
            className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Open Quotation
          </Link>
          {canProcure ? (
            <>
              <Link
                href={`/quotations/${entry.quotationId}/procurement-rfq`}
                className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                Procurement RFQ
              </Link>
              <Link
                href={`/quotations/${entry.quotationId}/purchase-order`}
                className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                Purchase Order
              </Link>
              <Link
                href={`/quotations/${entry.quotationId}/order-confirmation`}
                className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                Order Confirmation
              </Link>
            </>
          ) : (
            <p className="text-xs text-zinc-400">Procurement documents require Procurement Manager access.</p>
          )}
        </div>

        {/* Section 2: Project File metadata */}
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">{entry.order.orderNo}</h2>
              <p className="mt-1 text-sm text-zinc-500">{entry.order.reference}</p>
            </div>
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
              Confirmed
            </span>
          </div>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DetailValue label="CO no" value={entry.order.orderNo} />
            <DetailValue label="Quotation no" value={entry.order.quotationNo} />
            <DetailValue label="Client" value={entry.order.clientName} />
            <DetailValue label="Reference" value={entry.order.reference} />
            <DetailValue label="Total" value={formatQuotationMoney(entry.order.currency, entry.order.total)} />
            <DetailValue label="Created" value={formatDate(entry.order.createdAt)} />
            <DetailValue label="Status" value={entry.order.status} />
            <DetailValue label="Source Quotation Folder" value={entry.order.folderNo ?? "-"} />
          </dl>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_280px]">

          {/* LEFT: Locked Items Matrix */}
          <div>
            <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-100 px-5 py-4">
                <h2 className="text-lg font-semibold text-zinc-950">Locked Items</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Snapshot from the approved quotation {entry.order.quotationNo ?? entry.order.orderNo}.
                </p>
              </div>
              <div className="px-5 py-3">
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
                  This is a locked snapshot of the approved quotation. Items cannot be edited here.
                </p>
              </div>
              <div className="max-h-[450px] overflow-y-auto rounded-md border border-zinc-200">
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
          </div>

          {/* RIGHT: Execution Status sidebar */}
          <div className="space-y-4">
            <ProjectExecutionStatus
              orderNo={decodedOrderNo}
              quotationId={entry.quotationId}
              canEdit={canEditExecutionStatus}
            />
          </div>

        </div>

        <div className="mt-6">
          <ProjectActivityTimeline
            orderNo={decodedOrderNo}
            quotationId={entry.quotationId}
            canLog={canLog}
          />
        </div>

        {/* Section 5: Project Documents */}
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-zinc-950">Project Documents</h2>
          <p className="mt-1 text-sm text-zinc-500">Upload and manage client and supplier documents for this project.</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">

            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Client Documents</p>
              <p className="mt-1 text-xs text-zinc-400">Floor plans, signed specs, site check photos.</p>
              <div className="mt-3 flex flex-col items-center justify-center rounded-md border border-dashed border-zinc-300 bg-white px-4 py-6 text-center">
                <p className="text-sm font-medium text-zinc-600">Drop files here</p>
                <p className="mt-1 text-xs text-zinc-400">PDF, JPG, PNG up to 20MB</p>
                <button type="button" className="mt-3 inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                  Browse files
                </button>
              </div>
              <p className="mt-2 text-[11px] text-zinc-400">Storage wiring will be added in Phase 3C.</p>
            </div>

            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Supplier Documents</p>
              <p className="mt-1 text-xs text-zinc-400">Factory order confirmations, proforma invoices, shipping bills.</p>
              <div className="mt-3 flex flex-col items-center justify-center rounded-md border border-dashed border-zinc-300 bg-white px-4 py-6 text-center">
                <p className="text-sm font-medium text-zinc-600">Drop files here</p>
                <p className="mt-1 text-xs text-zinc-400">PDF, JPG, PNG up to 20MB</p>
                <button type="button" className="mt-3 inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                  Browse files
                </button>
              </div>
              <p className="mt-2 text-[11px] text-zinc-400">Storage wiring will be added in Phase 3C.</p>
            </div>

          </div>
        </section>
      </div>
    </ErpAppShell>
  );
}
