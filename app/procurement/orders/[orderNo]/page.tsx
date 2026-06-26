import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { VendorCard, type VendorCardItem } from "@/components/procurement/vendor-card";
import { type VendorDocRecord } from "@/lib/procurement/vendor-docs-action";
import { NotifyButton } from "@/components/notifications/notify-button";

export const dynamic = "force-dynamic";

type ProcurementWorkspacePageProps = {
  params: Promise<{ orderNo: string }>;
  searchParams?: Promise<{ message?: string }>;
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
  unit_price: number | null;
  net_total: number | null;
  currency: string | null;
  sort_order: number;
  is_active: boolean;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  }).format(new Date(value));
}

export default async function ProcurementWorkspacePage({
  params,
  searchParams,
}: ProcurementWorkspacePageProps) {
  const [{ profile, displayName, user }, { orderNo }, query] = await Promise.all([
    requireActiveUser(),
    params,
    searchParams ?? Promise.resolve({} as { message?: string }),
  ]);

  // RBAC gate — procurement workspace is restricted
  const userRole = profile?.role ?? null;
  const canAccessProcurement =
    userRole === "system_owner" ||
    userRole === "admin_manager" ||
    userRole === "procurement_manager";

  if (!canAccessProcurement) {
    redirect("/dashboard?message=You+do+not+have+permission+to+access+the+Procurement+Workspace.");
  }

  const canGenerateDocs =
    userRole === "system_owner" ||
    userRole === "admin_manager" ||
    userRole === "procurement_manager";

  const decodedOrderNo = decodeURIComponent(orderNo);
  const supabase = await createSupabaseClient();

  // Same twin-lookup pattern as projects page
  const { data: quotations, error } = await supabase
    .from("quotations")
    .select("id,layout_settings")
    .returns<ProcurementQuotationRow[]>();

  if (error) {
    console.error("PROCUREMENT WORKSPACE DETAIL ERROR", error.message);
    notFound();
  }

  const entry = (quotations ?? [])
    .map((quotation) => {
      const projectFile = projectFileFromLayoutSettings(quotation.layout_settings);
      if (projectFile?.orderNo === decodedOrderNo) {
        return { quotationId: quotation.id, order: projectFile };
      }
      const draft = clientApprovalDraftFromLayoutSettings(quotation.layout_settings);
      return draft?.confirmedOrder?.orderNo === decodedOrderNo
        ? { quotationId: quotation.id, order: draft.confirmedOrder }
        : null;
    })
    .find((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  if (!entry) {
    notFound();
  }

  // Fetch live items for this quotation
  const { data: items } = await supabase
    .from("quotation_items")
    .select("id,item_name_snapshot,item_code_snapshot,brand_name_snapshot,supplier_name_snapshot,size_snapshot,finish_snapshot,qty,unit_price,net_total,currency,sort_order,is_active")
    .eq("quotation_id", entry.quotationId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<ProcurementItemRow[]>();

  const activeItems = items ?? [];
  const vendorGroups = buildEffectiveDocumentGroups(activeItems);

  // Fetch persisted vendor doc records for this order
  const { data: vendorDocRows } = await supabase
    .from("procurement_vendor_docs")
    .select("vendor_key,slot_key,id,file_name,storage_path,public_url")
    .eq("order_no", decodedOrderNo)
    .returns<Array<{
      id: string;
      vendor_key: string;
      slot_key: string;
      file_name: string;
      storage_path: string;
      public_url: string;
    }>>();

  const vendorDocsMap = new Map<string, VendorDocRecord[]>();
  for (const row of vendorDocRows ?? []) {
    if (!vendorDocsMap.has(row.vendor_key)) {
      vendorDocsMap.set(row.vendor_key, []);
    }
    vendorDocsMap.get(row.vendor_key)!.push({
      id: row.id,
      slot_key: row.slot_key,
      file_name: row.file_name,
      storage_path: row.storage_path,
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
      title={`Procurement Workspace ${decodedOrderNo}`}
      description="Multi-vendor procurement folder linked to the confirmed project file."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-5 py-6 sm:px-8">

        {query.message ? (
          <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            {query.message}
          </p>
        ) : null}

        {/* Interconnection header buttons */}
        <div className="mb-5 flex flex-wrap gap-2">
          <Link
            href={`/projects/orders/${decodedOrderNo}`}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
          >
            📁 Open Project File
          </Link>
          <Link
            href={`/quotations/${entry.quotationId}`}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
          >
            Open Source Quotation
          </Link>
          <NotifyButton orderNo={decodedOrderNo} />
        </div>

        {/* Identity card */}
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Procurement Workspace</p>
              <h2 className="mt-1 text-xl font-semibold text-zinc-950">{decodedOrderNo}</h2>
              <p className="mt-1 text-sm text-zinc-500">{entry.order.reference}</p>
            </div>
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-800">
              Procurement Active
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

        {/* Multi-vendor procurement panels */}
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-zinc-950">Vendor Procurement Folders</h2>
          {vendorGroups.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">
              No supplier-assigned items found for this project.
            </p>
          ) : (
            <div className="space-y-4">
              {vendorGroups.map((group) => {
                const groupTotal = group.items.reduce((sum, item) => {
                  const val = typeof (item as ProcurementItemRow).net_total === "number"
                    ? (item as ProcurementItemRow).net_total as number
                    : 0;
                  return sum + val;
                }, 0);
                const groupCurrency = (group.items.find((item) =>
                  typeof (item as ProcurementItemRow).currency === "string" &&
                  ((item as ProcurementItemRow).currency ?? "").trim().length > 0
                ) as ProcurementItemRow | undefined)?.currency ?? entry.order.currency ?? "AED";

                const cardItems: VendorCardItem[] = group.items.map((item) => {
                  const row = item as ProcurementItemRow;
                  return {
                    id: row.id,
                    item_name_snapshot: row.item_name_snapshot,
                    item_code_snapshot: row.item_code_snapshot,
                    brand_name_snapshot: row.brand_name_snapshot,
                    size_snapshot: row.size_snapshot,
                    finish_snapshot: row.finish_snapshot,
                    qty: row.qty,
                    net_total: row.net_total,
                  };
                });

                return (
                  <VendorCard
                    key={group.dedupeKey}
                    vendorKey={group.dedupeKey}
                    displayLabel={group.displayLabel}
                    displayType={group.displayType}
                    items={cardItems}
                    totalValue={groupTotal}
                    currency={groupCurrency}
                    quotationId={entry.quotationId}
                    orderNo={decodedOrderNo}
                    canGenerateDocs={canGenerateDocs}
                    initialDocs={vendorDocsMap.get(group.dedupeKey) ?? []}
                    initialStep={vendorProgressMap.get(group.dedupeKey)?.active_step ?? 0}
                    initialEtd={vendorProgressMap.get(group.dedupeKey)?.etd ?? ""}
                    initialEta={vendorProgressMap.get(group.dedupeKey)?.eta ?? ""}
                  />
                );
              })}
            </div>
          )}
        </section>

      </div>
    </ErpAppShell>
  );
}
