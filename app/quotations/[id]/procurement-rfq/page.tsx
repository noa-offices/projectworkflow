import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProcurementRfqEditor } from "@/components/quotations/procurement-rfq-editor";
import { requireActiveUser } from "@/lib/auth";
import {
  DEFAULT_PROCUREMENT_RFQ_SETTINGS,
  type QuotationProcurementRfqSettings,
} from "@/lib/quotations/procurement-rfq-settings";
import { loadProcurementRfqSettings } from "@/lib/quotations/procurement-rfq-settings-store";
import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";
import {
  loadQuotationDerivedDocumentData,
  supplierPriceListCodeFromSourceData,
} from "@/lib/quotations/derived-document-data";

export const dynamic = "force-dynamic";

type ProcurementRfqPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function procurementRfqTitle(quotation?: { quotation_no: string | null; title: string } | null) {
  const quotationNo = quotation?.quotation_no ?? "Draft";
  const title = quotation?.title ?? "Quotation";
  return `${quotationNo} - ${title} Procurement RFQ`.replace(/[\\/:*?"<>|]/g, "-");
}

function formatDateInput(value: string | null | undefined) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayDateInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultRfqNumber(quotationNo: string | null, quotationId: string) {
  if (quotationNo?.trim()) {
    return `RFQ-${quotationNo.trim()}`;
  }

  return `RFQ-${quotationId.slice(0, 8).toUpperCase()}`;
}

function defaultProjectPhone(project?: {
  attention_mobile: string | null;
  attention_landline: string | null;
} | null) {
  return project?.attention_mobile?.trim() || project?.attention_landline?.trim() || "";
}

function buildDefaultSettings(data: NonNullable<Awaited<ReturnType<typeof loadQuotationDerivedDocumentData>>>): QuotationProcurementRfqSettings {
  return {
    ...DEFAULT_PROCUREMENT_RFQ_SETTINGS,
    selectedGroupKey: "all",
    documentDetails: {
      ...DEFAULT_PROCUREMENT_RFQ_SETTINGS.documentDetails,
      rfqNumber: defaultRfqNumber(data.quotation.quotation_no, data.quotation.id),
      rfqDate: todayDateInput(),
      quotationDate: formatDateInput(data.quotation.quotation_date),
      projectDisplayName: data.project?.project_name ?? data.quotation.title,
      clientDisplayName: data.client?.company_name ?? "",
      preparedBy: data.companyProfile.displayName || "",
      projectContact: data.project?.attention_to?.trim() || "",
      phone: defaultProjectPhone(data.project) || data.companyProfile.phone || "",
      email: data.project?.attention_email?.trim() || data.companyProfile.email || "",
      poBox: data.project?.po_box?.trim() || "",
      companyDisplayName: data.companyProfile.displayName || "",
    },
    notes: {
      ...DEFAULT_PROCUREMENT_RFQ_SETTINGS.notes,
    },
  };
}

export async function generateMetadata({ params }: ProcurementRfqPageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await loadQuotationDerivedDocumentData(id);

  return {
    title: procurementRfqTitle(data?.quotation),
  };
}

export default async function ProcurementRfqPage({ params, searchParams }: ProcurementRfqPageProps) {
  await requireActiveUser();
  const { id } = await params;
  const query = await searchParams;
  const printMode = query.print === "1";
  const data = await loadQuotationDerivedDocumentData(id);

  if (!data) {
    notFound();
  }

  const defaultSettings = buildDefaultSettings(data);
  const storedSettingsResult = await loadProcurementRfqSettings(id);
  const availableGroupKeys = new Set(buildEffectiveDocumentGroups(data.items).map((group) => group.dedupeKey));
  const initialSettings = storedSettingsResult.success && storedSettingsResult.hasStoredSettings
    ? {
        ...storedSettingsResult.settings,
        selectedGroupKey: storedSettingsResult.settings.selectedGroupKey === "all" || availableGroupKeys.has(storedSettingsResult.settings.selectedGroupKey)
          ? storedSettingsResult.settings.selectedGroupKey
          : "all",
      }
    : defaultSettings;

  return (
    <ProcurementRfqEditor
      data={{
        client: data.client,
        companyProfile: {
          displayName: data.companyProfile.displayName,
          phone: data.companyProfile.phone,
          email: data.companyProfile.email,
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
          imageUrl: data.imageUrlByItemId.get(item.id) ?? null,
        })),
        project: data.project
          ? {
              id: data.project.id,
              project_name: data.project.project_name,
              attention_to: data.project.attention_to,
              attention_mobile: data.project.attention_mobile,
              attention_landline: data.project.attention_landline,
              attention_email: data.project.attention_email,
              po_box: data.project.po_box,
              project_address: data.project.project_address,
            }
          : null,
        quotation: {
          id: data.quotation.id,
          quotation_no: data.quotation.quotation_no,
          title: data.quotation.title,
          quotation_date: data.quotation.quotation_date,
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
