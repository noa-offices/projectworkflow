import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderConfirmationEditor } from "@/components/quotations/order-confirmation-editor";
import { requireActiveUser } from "@/lib/auth";
import {
  DEFAULT_ORDER_CONFIRMATION_SETTINGS,
  type QuotationOrderConfirmationSettings,
} from "@/lib/quotations/order-confirmation-settings";
import { loadOrderConfirmationSettings } from "@/lib/quotations/order-confirmation-settings-store";
import {
  loadQuotationDerivedDocumentData,
  projectContactLine,
} from "@/lib/quotations/derived-document-data";

export const dynamic = "force-dynamic";

type OrderConfirmationPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function orderConfirmationTitle(quotation?: { quotation_no: string | null; title: string } | null) {
  const quotationNo = quotation?.quotation_no ?? "Draft";
  const title = quotation?.title ?? "Quotation";
  return `${quotationNo} - ${title} Order Confirmation`.replace(/[\\/:*?"<>|]/g, "-");
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

function defaultConfirmationNumber(quotationNo: string | null, quotationId: string) {
  if (quotationNo?.trim()) {
    return `OC-${quotationNo.trim()}`;
  }

  return `OC-${quotationId.slice(0, 8).toUpperCase()}`;
}

function buildDefaultSettings(data: NonNullable<Awaited<ReturnType<typeof loadQuotationDerivedDocumentData>>>): QuotationOrderConfirmationSettings {
  const address = [data.companyProfile.addressLine1, data.companyProfile.addressLine2, data.companyProfile.city, data.companyProfile.country]
    .filter(Boolean)
    .join(", ");

  return {
    ...DEFAULT_ORDER_CONFIRMATION_SETTINGS,
    documentDetails: {
      ...DEFAULT_ORDER_CONFIRMATION_SETTINGS.documentDetails,
      confirmationNumber: defaultConfirmationNumber(data.quotation.quotation_no, data.quotation.id),
      confirmationDate: formatDateInput(data.quotation.quotation_date) || todayDateInput(),
      quotationReference: data.quotation.quotation_no ?? "",
      projectDisplayName: data.project?.project_name ?? data.quotation.title,
      clientDisplayName: data.client?.company_name ?? "",
      location: data.project?.location?.trim() || "",
      attentionContact: projectContactLine(data.project),
      preparedBy: data.companyProfile.displayName || "Noa Offices",
      companyDisplayName: data.companyProfile.displayName || "Noa Offices",
      companyPhone: data.companyProfile.phone || "",
      companyEmail: data.companyProfile.email || "",
      companyWebsite: data.companyProfile.website || "www.noaoffices.com",
      companyAddress: address,
    },
    terms: {
      ...DEFAULT_ORDER_CONFIRMATION_SETTINGS.terms,
      deliveryInstallationNote: data.quotation.delivery_terms?.trim() || DEFAULT_ORDER_CONFIRMATION_SETTINGS.terms.deliveryInstallationNote,
      paymentTerms: data.quotation.payment_terms?.trim() || DEFAULT_ORDER_CONFIRMATION_SETTINGS.terms.paymentTerms,
      clientName: data.client?.company_name ?? "",
    },
  };
}

export async function generateMetadata({ params }: OrderConfirmationPageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await loadQuotationDerivedDocumentData(id);

  return {
    title: orderConfirmationTitle(data?.quotation),
  };
}

export default async function OrderConfirmationPage({ params, searchParams }: OrderConfirmationPageProps) {
  await requireActiveUser();
  const { id } = await params;
  const query = await searchParams;
  const printMode = query.print === "1";
  const data = await loadQuotationDerivedDocumentData(id);

  if (!data) {
    notFound();
  }

  const defaultSettings = buildDefaultSettings(data);
  const storedSettingsResult = await loadOrderConfirmationSettings(id);
  const initialSettings = storedSettingsResult.success && storedSettingsResult.hasStoredSettings
    ? {
        ...defaultSettings,
        ...storedSettingsResult.settings,
        documentDetails: {
          ...defaultSettings.documentDetails,
          ...storedSettingsResult.settings.documentDetails,
        },
        columnVisibility: {
          ...defaultSettings.columnVisibility,
          ...storedSettingsResult.settings.columnVisibility,
        },
        terms: {
          ...defaultSettings.terms,
          ...storedSettingsResult.settings.terms,
        },
      }
    : defaultSettings;

  return (
    <OrderConfirmationEditor
      data={{
        client: data.client,
        companyProfile: {
          address: [data.companyProfile.addressLine1, data.companyProfile.addressLine2, data.companyProfile.city, data.companyProfile.country].filter(Boolean).join(", "),
          displayName: data.companyProfile.displayName,
          email: data.companyProfile.email,
          phone: data.companyProfile.phone,
          website: data.companyProfile.website,
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
          qty: item.qty,
          imageUrl: data.imageUrlByItemId.get(item.id) ?? null,
        })),
        project: data.project
          ? {
              id: data.project.id,
              project_name: data.project.project_name,
              location: data.project.location,
              attention_to: data.project.attention_to,
              attention_mobile: data.project.attention_mobile,
              attention_landline: data.project.attention_landline,
              attention_email: data.project.attention_email,
            }
          : null,
        quotation: {
          id: data.quotation.id,
          quotation_no: data.quotation.quotation_no,
          title: data.quotation.title,
          quotation_date: data.quotation.quotation_date,
          payment_terms: data.quotation.payment_terms,
          delivery_terms: data.quotation.delivery_terms,
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
