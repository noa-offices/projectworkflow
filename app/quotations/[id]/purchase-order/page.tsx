import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PurchaseOrderEditor } from "@/components/quotations/purchase-order-editor";
import { requireActiveUser } from "@/lib/auth";
import {
  DEFAULT_PURCHASE_ORDER_SETTINGS,
  type QuotationPurchaseOrderSettings,
} from "@/lib/quotations/purchase-order-settings";
import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";
import { normalizePurchaseOrderCurrency } from "@/lib/quotations/purchase-order-currency";
import { loadPurchaseOrderSettings } from "@/lib/quotations/purchase-order-settings-store";
import { loadQuotationDerivedDocumentData, supplierPriceListCodeFromSourceData } from "@/lib/quotations/derived-document-data";

export const dynamic = "force-dynamic";

type PurchaseOrderPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function purchaseOrderTitle(quotation?: { quotation_no: string | null; title: string } | null) {
  const quotationNo = quotation?.quotation_no ?? "Draft";
  const title = quotation?.title ?? "Quotation";
  return `${quotationNo} - ${title} Purchase Order`.replace(/[\\/:*?"<>|]/g, "-");
}

function todayDateInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function selectedSupplierKeyFromItems(items: Array<{ supplier_name_snapshot: string | null; brand_name_snapshot: string | null }>) {
  return buildEffectiveDocumentGroups(items)[0]?.dedupeKey ?? "";
}

function defaultPurchaseOrderNumber(quotationNo: string | null, quotationId: string) {
  if (quotationNo?.trim()) return `PO-${quotationNo.trim()}`;
  return `PO-${quotationId.slice(0, 8).toUpperCase()}`;
}

function defaultPurchaseOrderCurrency(
  data: NonNullable<Awaited<ReturnType<typeof loadQuotationDerivedDocumentData>>>,
  selectedSupplierKey: string,
) {
  if (data.quotation.currency?.trim()) {
    return normalizePurchaseOrderCurrency(data.quotation.currency);
  }

  const selectedGroup = buildEffectiveDocumentGroups(data.items).find((group) => group.dedupeKey === selectedSupplierKey) ?? null;
  const groupCurrency = selectedGroup?.items.find((item) => item.currency?.trim())?.currency ?? null;
  return normalizePurchaseOrderCurrency(groupCurrency);
}

function buildDefaultSettings(data: NonNullable<Awaited<ReturnType<typeof loadQuotationDerivedDocumentData>>>): QuotationPurchaseOrderSettings {
  const address = [data.companyProfile.addressLine1, data.companyProfile.addressLine2, data.companyProfile.city, data.companyProfile.country]
    .filter(Boolean)
    .join(", ");
  const selectedSupplierKey = selectedSupplierKeyFromItems(data.items);

  return {
    ...DEFAULT_PURCHASE_ORDER_SETTINGS,
    selectedSupplierKey,
    documentDetails: {
      ...DEFAULT_PURCHASE_ORDER_SETTINGS.documentDetails,
      poNumber: defaultPurchaseOrderNumber(data.quotation.quotation_no, data.quotation.id),
      poDate: todayDateInput(),
      currency: defaultPurchaseOrderCurrency(data, selectedSupplierKey),
      quotationReference: data.quotation.quotation_no ?? "",
      projectDisplayName: data.project?.project_name ?? data.quotation.title,
      clientDisplayName: data.client?.company_name ?? "",
      preparedBy: data.companyProfile.displayName || "",
      companyDisplayName: data.companyProfile.displayName || "",
      phone: data.companyProfile.phone ?? "",
      email: data.companyProfile.email ?? "",
      address,
      trn: data.companyProfile.trn ?? "",
    },
    terms: {
      ...DEFAULT_PURCHASE_ORDER_SETTINGS.terms,
      paymentTerms: data.quotation.payment_terms ?? "",
    },
  };
}

export async function generateMetadata({ params }: PurchaseOrderPageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await loadQuotationDerivedDocumentData(id);

  return {
    title: purchaseOrderTitle(data?.quotation),
  };
}

export default async function PurchaseOrderPage({ params, searchParams }: PurchaseOrderPageProps) {
  const { profile } = await requireActiveUser();
  const userRole = profile?.role ?? null;
  const canAccessThisPage =
    userRole === "system_owner" ||
    userRole === "admin_manager" ||
    userRole === "procurement_manager" ||
    userRole === "sales_coordinator";

  if (!canAccessThisPage) {
    redirect("/dashboard?message=You+do+not+have+permission+to+access+Purchase+Orders.");
  }
  const { id } = await params;
  const query = await searchParams;
  const printMode = query.print === "1";
  const data = await loadQuotationDerivedDocumentData(id);

  if (!data) {
    notFound();
  }

  const defaultSettings = buildDefaultSettings(data);
  const storedSettingsResult = await loadPurchaseOrderSettings(id);
  const availableGroupKeys = new Set(buildEffectiveDocumentGroups(data.items).map((group) => group.dedupeKey));
  const initialSettings = storedSettingsResult.success && storedSettingsResult.hasStoredSettings
    ? {
        ...storedSettingsResult.settings,
        selectedSupplierKey: availableGroupKeys.has(storedSettingsResult.settings.selectedSupplierKey)
          ? storedSettingsResult.settings.selectedSupplierKey
          : defaultSettings.selectedSupplierKey,
        documentDetails: {
          ...storedSettingsResult.settings.documentDetails,
          currency: normalizePurchaseOrderCurrency(
            storedSettingsResult.settings.documentDetails.currency || defaultSettings.documentDetails.currency,
          ),
        },
      }
    : defaultSettings;

  // Build vendor summary for the overview panel
  // FUTURE PROCUREMENT HOOK (Phase 3B): Each vendor group here will link to its
  // own generated PO record in quotation_purchase_orders once multi-PO splitting
  // is implemented. Currently one settings record covers the selected supplier.
  const vendorGroups = buildEffectiveDocumentGroups(data.items).map((group) => ({
    dedupeKey: group.dedupeKey,
    displayLabel: group.displayLabel,
    displayType: group.displayType,
    itemCount: group.items.length,
    total: group.items.reduce((sum, item) => {
      const lineTotal = typeof (item as { net_total?: unknown }).net_total === "number"
        ? (item as { net_total: number }).net_total
        : 0;
      return sum + lineTotal;
    }, 0),
    currency: group.items.find((item) => (item as { currency?: unknown }).currency)
      ? String((group.items.find((item) => (item as { currency?: unknown }).currency) as { currency: unknown }).currency)
      : (data.quotation.currency ?? "AED"),
  }));

  return (
    <>
    {!printMode ? (
      <div className="mx-auto mb-6 max-w-[calc(297mm+2rem+440px+1.25rem)]">
        <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-950">Vendor Breakdown for this Quotation</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Items are split by supplier. Use the editor below to switch between
            suppliers and generate individual Purchase Orders.
          </p>
          {/* FUTURE PROCUREMENT HOOK (Phase 3B): Replace this summary with
              a multi-PO generator where each vendor row has its own
              "Generate PO" button that creates a separate numbered record
              (PO-XXXX-001, PO-XXXX-002) in quotation_purchase_orders. */}
          <div className="mt-4 divide-y divide-zinc-100 rounded-md border border-zinc-200">
            {vendorGroups.map((group) => (
              <div key={group.dedupeKey} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-800">{group.displayLabel}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {group.displayType} · {group.itemCount} item{group.itemCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-zinc-950">
                    {new Intl.NumberFormat("en-AE", {
                      style: "currency",
                      currency: group.currency || "AED",
                      minimumFractionDigits: 2,
                    }).format(group.total)}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-widest text-zinc-400">
                    Subtotal
                  </p>
                </div>
              </div>
            ))}
          </div>
          {vendorGroups.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">No supplier-assigned items found in this quotation.</p>
          ) : null}
        </div>
      </div>
    ) : null}
    <PurchaseOrderEditor
      data={{
        client: data.client,
        companyProfile: {
          displayName: data.companyProfile.displayName,
          phone: data.companyProfile.phone,
          email: data.companyProfile.email,
          address: [data.companyProfile.addressLine1, data.companyProfile.addressLine2, data.companyProfile.city, data.companyProfile.country].filter(Boolean).join(", "),
          trn: data.companyProfile.trn,
          website: data.companyProfile.website ?? null,
        },
        items: data.items.map((item) => ({
          id: item.id,
          section_id: item.section_id,
          manual_serial: item.manual_serial,
          item_code_snapshot: item.item_code_snapshot,
          item_name_snapshot: item.item_name_snapshot,
          brand_name_snapshot: item.brand_name_snapshot,
          specification_snapshot: item.specification_snapshot,
          finish_selections_snapshot: item.finish_selections_snapshot,
          model_snapshot: item.model_snapshot,
          finish_snapshot: item.finish_snapshot,
          size_snapshot: item.size_snapshot,
          origin_snapshot: item.origin_snapshot,
          is_optional: item.is_optional,
          include_in_total: item.include_in_total,
          is_rate_only: item.is_rate_only,
          supplier_name_snapshot: item.supplier_name_snapshot,
          supplier_price_list_code_snapshot: supplierPriceListCodeFromSourceData(item),
          qty: item.qty,
          currency: item.currency,
          imageUrl: data.imageUrlByItemId.get(item.id) ?? null,
        })),
        project: data.project
          ? {
              id: data.project.id,
              project_name: data.project.project_name,
            }
          : null,
        quotation: {
          id: data.quotation.id,
          quotation_no: data.quotation.quotation_no,
          title: data.quotation.title,
          quotation_date: data.quotation.quotation_date,
          currency: data.quotation.currency,
        },
        sections: data.sections.map((section) => ({
          id: section.id,
          section_title: section.section_title,
          parent_section_id: section.parent_section_id,
          section_kind: section.section_kind,
        })),
      }}
      defaultLogoUrl="/noa-logo.png"
      defaultSettings={defaultSettings}
      initialSettings={initialSettings}
      printMode={printMode}
    />
    </>
  );
}
