import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { loadQuotationDerivedDocumentData } from "@/lib/quotations/derived-document-data";
import { loadDeliveryNoteSettings } from "@/lib/quotations/delivery-note-settings-store";
import {
  DEFAULT_DELIVERY_NOTE_SETTINGS,
  type DeliveryNoteSettings,
} from "@/lib/quotations/delivery-note-settings";
import { DeliveryNoteEditor, type DeliveryNoteEditorData } from "@/components/quotations/delivery-note-editor";

export const dynamic = "force-dynamic";

type DeliveryNotePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function todayDateInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDnNumber(quotationNo: string | null) {
  const base = quotationNo?.trim().replace(/^QN-/i, "") ?? "";
  return base ? `DN-${base}-001` : "";
}

function buildDefaultSettings(
  data: NonNullable<Awaited<ReturnType<typeof loadQuotationDerivedDocumentData>>>,
): DeliveryNoteSettings {
  return {
    ...DEFAULT_DELIVERY_NOTE_SETTINGS,
    dnNumber: defaultDnNumber(data.quotation.quotation_no),
    dnDate: todayDateInput(),
    projectDisplayName: data.project?.project_name ?? data.quotation.title,
    clientDisplayName: data.client?.company_name ?? "",
    deliveryAddress: data.project?.project_address?.trim() ?? "",
  };
}

function deliveryNoteTitle(quotation?: { quotation_no: string | null; title: string } | null) {
  const no = quotation?.quotation_no ?? "Draft";
  return `${no} - Delivery Note`.replace(/[\\/:*?"<>|]/g, "-");
}

export async function generateMetadata({ params }: DeliveryNotePageProps): Promise<Metadata> {
  const { id } = await params;
  const data = await loadQuotationDerivedDocumentData(id);
  return { title: deliveryNoteTitle(data?.quotation) };
}

export default async function DeliveryNotePage({ params, searchParams }: DeliveryNotePageProps) {
  await requireActiveUser();
  const { id } = await params;
  const query = await searchParams;
  const printMode = query.print === "1";

  const [data, settingsResult] = await Promise.all([
    loadQuotationDerivedDocumentData(id),
    loadDeliveryNoteSettings(id),
  ]);

  if (!data) {
    notFound();
  }

  const defaultSettings = buildDefaultSettings(data);
  const initialSettings =
    settingsResult.success && settingsResult.hasStoredSettings
      ? settingsResult.settings
      : defaultSettings;

  const editorData: DeliveryNoteEditorData = {
    client: data.client,
    companyProfile: {
      companyName: data.companyProfile.displayName,
      phone: data.companyProfile.phone ?? null,
      email: data.companyProfile.email ?? null,
      website: data.companyProfile.website ?? null,
    },
    project: data.project
      ? {
          id: data.project.id,
          project_name: data.project.project_name,
          project_address: data.project.project_address,
        }
      : null,
    quotation: {
      id: data.quotation.id,
      quotation_no: data.quotation.quotation_no,
      title: data.quotation.title,
    },
    items: data.items.map((item) => ({
      id: item.id,
      item_name_snapshot: item.item_name_snapshot,
      item_code_snapshot: item.item_code_snapshot,
      brand_name_snapshot: item.brand_name_snapshot,
      specification_snapshot: item.specification_snapshot,
      finish_snapshot: item.finish_snapshot,
      size_snapshot: item.size_snapshot,
      model_snapshot: item.model_snapshot,
      origin_snapshot: item.origin_snapshot,
      supplier_name_snapshot: item.supplier_name_snapshot,
      qty: item.qty,
      imageUrl: data.imageUrlByItemId.get(item.id) ?? null,
    })),
  };

  return (
    <DeliveryNoteEditor
      data={editorData}
      defaultLogoUrl="/noa-logo.png"
      defaultSettings={defaultSettings}
      initialSettings={initialSettings}
      printMode={printMode}
    />
  );
}
