import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PurchaseOrderEditor } from "@/components/quotations/purchase-order-editor";
import { requireActiveUser } from "@/lib/auth";
import {
  DEFAULT_PURCHASE_ORDER_SETTINGS,
  type QuotationPurchaseOrderSettings,
} from "@/lib/quotations/purchase-order-settings";
import { loadPurchaseOrderSettings } from "@/lib/quotations/purchase-order-settings-store";
import { loadQuotationDerivedDocumentData } from "@/lib/quotations/derived-document-data";

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

function normalizeGroupName(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9]/g, "")
    .trim()
    .toLowerCase();
}

function selectedSupplierKeyFromItems(items: Array<{ supplier_name_snapshot: string | null; brand_name_snapshot: string | null }>) {
  const keys = new Set<string>();

  for (const item of items) {
    const label = item.supplier_name_snapshot?.trim() || item.brand_name_snapshot?.trim() || "Unassigned Supplier";
    const normalizedLabel = normalizeGroupName(label) || "unassigned";
    const dedupeKey = normalizedLabel === "unassignedsupplier" ? "unassigned" : normalizedLabel;
    keys.add(dedupeKey);
  }

  return Array.from(keys)[0] ?? "";
}

function defaultPurchaseOrderNumber(quotationNo: string | null, quotationId: string) {
  if (quotationNo?.trim()) return `PO-${quotationNo.trim()}`;
  return `PO-${quotationId.slice(0, 8).toUpperCase()}`;
}

function buildDefaultSettings(data: NonNullable<Awaited<ReturnType<typeof loadQuotationDerivedDocumentData>>>): QuotationPurchaseOrderSettings {
  const address = [data.companyProfile.addressLine1, data.companyProfile.addressLine2, data.companyProfile.city, data.companyProfile.country]
    .filter(Boolean)
    .join(", ");

  return {
    ...DEFAULT_PURCHASE_ORDER_SETTINGS,
    selectedSupplierKey: selectedSupplierKeyFromItems(data.items),
    documentDetails: {
      ...DEFAULT_PURCHASE_ORDER_SETTINGS.documentDetails,
      poNumber: defaultPurchaseOrderNumber(data.quotation.quotation_no, data.quotation.id),
      poDate: todayDateInput(),
      quotationReference: data.quotation.quotation_no ?? "",
      projectDisplayName: data.project?.project_name ?? data.quotation.title,
      clientDisplayName: data.client?.company_name ?? "",
      preparedBy: "Noa Offices",
      companyDisplayName: "Noa Offices",
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
  await requireActiveUser();
  const { id } = await params;
  const query = await searchParams;
  const printMode = query.print === "1";
  const data = await loadQuotationDerivedDocumentData(id);

  if (!data) {
    notFound();
  }

  const defaultSettings = buildDefaultSettings(data);
  const storedSettingsResult = await loadPurchaseOrderSettings(id);
  const initialSettings = storedSettingsResult.success && storedSettingsResult.hasStoredSettings
    ? storedSettingsResult.settings
    : defaultSettings;

  return (
    <PurchaseOrderEditor
      data={{
        client: data.client,
        companyProfile: {
          displayName: data.companyProfile.displayName,
          phone: data.companyProfile.phone,
          email: data.companyProfile.email,
          address: [data.companyProfile.addressLine1, data.companyProfile.addressLine2, data.companyProfile.city, data.companyProfile.country].filter(Boolean).join(", "),
          trn: data.companyProfile.trn,
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
          supplier_name_snapshot: item.supplier_name_snapshot,
          qty: item.qty,
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
  );
}
