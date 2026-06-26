import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check } from "lucide-react";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CompletedProcurementPageProps = {
  params: Promise<{ orderNo: string }>;
};

type ProcurementQuotationRow = {
  id: string;
  layout_settings: unknown;
};

type ProcurementItemRow = {
  id: string;
  item_name_snapshot: string | null;
  item_code_snapshot: string | null;
  brand_name_snapshot: string | null;
  supplier_name_snapshot: string | null;
  size_snapshot: string | null;
  finish_snapshot: string | null;
  qty: number;
  net_total: number | null;
  currency: string | null;
  sort_order: number;
  is_active: boolean;
};

const VENDOR_STEPS = [
  "RFQ",
  "PO Issued",
  "Deposit Paid",
  "In Production",
  "Quality Check",
  "Ready for Shipment",
  "In Transit",
  "Delivered & Installed",
] as const;

const DOC_SLOTS = [
  { key: "pi", label: "Proforma Invoice (PI)" },
  { key: "oc", label: "Factory Confirmation (OC)" },
  { key: "bl", label: "Shipping / Packing List (BL)" },
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default async function CompletedProcurementDetailPage({
  params,
}: CompletedProcurementPageProps) {
  const [{ profile, displayName, user }, { orderNo }] = await Promise.all([
    requireActiveUser(),
    params,
  ]);

  const userRole = profile?.role ?? null;
  const canAccessProcurement =
    userRole === "system_owner" ||
    userRole === "admin_manager" ||
    userRole === "procurement_manager";

  if (!canAccessProcurement) {
    redirect(
      "/dashboard?message=You+do+not+have+permission+to+access+the+Procurement+Workspace.",
    );
  }

  const decodedOrderNo = decodeURIComponent(orderNo);
  const supabase = await createSupabaseClient();

  const { data: quotations, error } = await supabase
    .from("quotations")
    .select("id,layout_settings")
    .returns<ProcurementQuotationRow[]>();

  if (error) {
    console.error("COMPLETED PROCUREMENT DETAIL ERROR", error.message);
    notFound();
  }

  const entry = (quotations ?? [])
    .map((quotation) => {
      const settings = quotation.layout_settings as Record<string, unknown> | null;
      const completedAt =
        typeof settings?.projectCompletedAt === "string"
          ? settings.projectCompletedAt
          : null;

      const projectFile = projectFileFromLayoutSettings(quotation.layout_settings);
      if (projectFile?.orderNo === decodedOrderNo) {
        return { quotationId: quotation.id, order: projectFile, completedAt };
      }
      const draft = clientApprovalDraftFromLayoutSettings(quotation.layout_settings);
      if (draft?.confirmedOrder?.orderNo === decodedOrderNo) {
        return { quotationId: quotation.id, order: draft.confirmedOrder, completedAt };
      }
      return null;
    })
    .find((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  if (!entry) notFound();
  if (!entry.completedAt) notFound();

  const { data: items } = await supabase
    .from("quotation_items")
    .select(
      "id,item_name_snapshot,item_code_snapshot,brand_name_snapshot,supplier_name_snapshot,size_snapshot,finish_snapshot,qty,net_total,currency,sort_order,is_active",
    )
    .eq("quotation_id", entry.quotationId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<ProcurementItemRow[]>();

  const activeItems = items ?? [];
  const vendorGroups = buildEffectiveDocumentGroups(activeItems);

  const { data: vendorDocRows } = await supabase
    .from("procurement_vendor_docs")
    .select("id,vendor_key,slot_key,file_name,public_url")
    .eq("order_no", decodedOrderNo)
    .returns<Array<{ id: string; vendor_key: string; slot_key: string; file_name: string; public_url: string }>>();

  const vendorDocsMap = new Map<
    string,
    Array<{ id: string; slot_key: string; file_name: string; public_url: string }>
  >();
  for (const row of vendorDocRows ?? []) {
    if (!vendorDocsMap.has(row.vendor_key)) vendorDocsMap.set(row.vendor_key, []);
    vendorDocsMap.get(row.vendor_key)!.push({
      id: row.id,
      slot_key: row.slot_key,
      file_name: row.file_name,
      public_url: row.public_url,
    });
  }

  const { data: vendorProgress } = await supabase
    .from("procurement_vendor_progress")
    .select("vendor_key, active_step, etd, eta")
    .eq("order_no", decodedOrderNo)
    .returns<Array<{ vendor_key: string; active_step: number; etd: string | null; eta: string | null }>>();

  const vendorProgressMap = new Map(
    (vendorProgress ?? []).map((p) => [p.vendor_key, p]),
  );

  return (
    <ErpAppShell
      eyebrow="PROCUREMENT"
      title={`Completed — ${decodedOrderNo}`}
      description="Read-only procurement folder for a completed project file."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-5 py-6 sm:px-8">

        {/* Completed banner + back link */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
          <Link
            href="/procurement/completed"
            className="text-sm font-semibold text-emerald-800 transition hover:text-emerald-950"
          >
            ← Completed Procurement
          </Link>
          <span className="text-sm font-semibold text-emerald-900">
            ✓ Completed {formatDate(entry.completedAt)}
          </span>
        </div>

        {/* Interconnection buttons */}
        <div className="mb-5 flex flex-wrap gap-2">
          <Link
            href={`/projects/orders/${decodedOrderNo}`}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
          >
            📁 Open Project File
          </Link>
        </div>

        {/* Identity card */}
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                Completed Procurement
              </p>
              <h2 className="mt-1 text-xl font-semibold text-zinc-950">{decodedOrderNo}</h2>
              <p className="mt-1 text-sm text-zinc-500">{entry.order.reference}</p>
            </div>
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
              Completed
            </span>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase text-zinc-500">Project File</dt>
              <dd className="mt-1 text-sm font-semibold text-zinc-950">{entry.order.orderNo}</dd>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase text-zinc-500">Total Value</dt>
              <dd className="mt-1 text-sm font-semibold text-zinc-950">
                {formatQuotationMoney(entry.order.currency, entry.order.total)}
              </dd>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <dt className="text-xs font-semibold uppercase text-zinc-500">Vendor Groups</dt>
              <dd className="mt-1 text-sm font-semibold text-zinc-950">{vendorGroups.length}</dd>
            </div>
          </dl>
        </section>

        {/* Per-vendor read-only panels */}
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-zinc-950">Vendor Procurement Folders</h2>
          {vendorGroups.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">
              No supplier-assigned items found for this project.
            </p>
          ) : (
            <div className="space-y-4">
              {vendorGroups.map((group) => {
                const groupDocs = vendorDocsMap.get(group.dedupeKey) ?? [];
                const progress = vendorProgressMap.get(group.dedupeKey);
                const activeStep = progress?.active_step ?? 0;
                const etd = progress?.etd ?? "";
                const eta = progress?.eta ?? "";

                const groupTotal = group.items.reduce((sum, item) => {
                  const val =
                    typeof (item as ProcurementItemRow).net_total === "number"
                      ? ((item as ProcurementItemRow).net_total as number)
                      : 0;
                  return sum + val;
                }, 0);
                const groupCurrency =
                  (
                    group.items.find(
                      (item) =>
                        typeof (item as ProcurementItemRow).currency === "string" &&
                        ((item as ProcurementItemRow).currency ?? "").trim().length > 0,
                    ) as ProcurementItemRow | undefined
                  )?.currency ?? entry.order.currency ?? "AED";

                const formattedTotal = new Intl.NumberFormat("en-AE", {
                  style: "currency",
                  currency: groupCurrency || "AED",
                  minimumFractionDigits: 2,
                }).format(groupTotal);

                return (
                  <div
                    key={group.dedupeKey}
                    className="rounded-lg border border-zinc-200 bg-white shadow-sm"
                  >
                    {/* Vendor header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-base font-bold text-violet-700">
                          {group.displayLabel.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold text-zinc-950">
                            {group.displayLabel}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2">
                            <span className="text-xs uppercase tracking-widest text-zinc-400">
                              {group.displayType}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                              {group.items.length} item{group.items.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-900">
                        {formattedTotal}
                      </span>
                    </div>

                    {/* Body: progress + docs */}
                    <div className="p-4">

                      {/* Read-only 8-step progress tracker */}
                      <div className="mb-4">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                          Procurement Progress
                        </p>
                        <div className="flex items-center gap-0">
                          {VENDOR_STEPS.map((label, index) => {
                            const isCompleted = index < activeStep;
                            const isActive = index === activeStep;
                            const isLast = index === VENDOR_STEPS.length - 1;
                            return (
                              <div key={label} className="flex flex-1 items-center">
                                <div className="flex flex-col items-center gap-1">
                                  <div
                                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${
                                      isCompleted
                                        ? "border-emerald-600 bg-emerald-600 text-white"
                                        : isActive
                                          ? "border-emerald-800 bg-emerald-50 text-emerald-900"
                                          : "border-zinc-300 bg-white text-zinc-400"
                                    }`}
                                  >
                                    {isCompleted ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      String(index + 1)
                                    )}
                                  </div>
                                  <span
                                    className={`text-center text-[9px] font-semibold leading-tight ${
                                      isActive
                                        ? "text-emerald-900"
                                        : isCompleted
                                          ? "text-emerald-700"
                                          : "text-zinc-400"
                                    }`}
                                  >
                                    {label}
                                  </span>
                                </div>
                                {!isLast && (
                                  <div
                                    className={`h-0.5 flex-1 ${
                                      index < activeStep ? "bg-emerald-500" : "bg-zinc-200"
                                    }`}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* ETD / ETA — read-only text */}
                      {(etd || eta) ? (
                        <div className="mb-4 grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                              ETD
                            </p>
                            <p className="mt-1 text-sm font-semibold text-zinc-800">{etd || "—"}</p>
                            <p className="text-[10px] text-zinc-400">Est. Departure</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                              ETA
                            </p>
                            <p className="mt-1 text-sm font-semibold text-zinc-800">{eta || "—"}</p>
                            <p className="text-[10px] text-zinc-400">Est. Arrival</p>
                          </div>
                        </div>
                      ) : null}

                      {/* Vendor documents — view links only, no upload */}
                      <div>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                          Vendor Documents
                        </p>
                        <div className="space-y-1.5">
                          {DOC_SLOTS.map((slot) => {
                            const slotFiles = groupDocs.filter(
                              (d) => d.slot_key === slot.key,
                            );
                            return (
                              <div
                                key={slot.key}
                                className="rounded-md border border-zinc-100 bg-zinc-50 px-2.5 py-1.5"
                              >
                                <p className="text-xs font-medium text-zinc-700">
                                  {slot.label}
                                </p>
                                {slotFiles.length === 0 ? (
                                  <p className="text-[10px] text-zinc-300">No files</p>
                                ) : (
                                  <div className="mt-0.5 space-y-0.5">
                                    {slotFiles.map((f) => (
                                      <div
                                        key={f.id}
                                        className="flex items-center gap-1.5"
                                      >
                                        <span className="min-w-0 truncate text-[10px] font-medium text-emerald-800">
                                          {f.file_name}
                                        </span>
                                        <a
                                          href={f.public_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="ml-0.5 shrink-0 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-zinc-600 transition hover:border-emerald-800 hover:text-emerald-900"
                                        >
                                          View
                                        </a>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </ErpAppShell>
  );
}
