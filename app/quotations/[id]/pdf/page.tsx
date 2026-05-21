import type { Metadata } from "next";
import { requireActiveUser } from "@/lib/auth";
import { QuotationPdfPreviewEditor } from "@/components/quotations/quotation-pdf-preview-editor";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  QuotationPdfDocument,
  quotationDocumentTitle,
  serializeQuotationPdfDocumentData,
} from "@/components/quotations/quotation-pdf-document";
import { loadQuotationPdfDocumentData } from "@/lib/quotations/quotation-pdf-document-data";
import {
  DEFAULT_QUOTATION_PDF_SETTINGS,
  normalizeQuotationPdfSettings,
} from "@/lib/quotations/quotation-pdf-settings";
import { loadQuotationPdfSettings } from "@/lib/quotations/quotation-pdf-settings-store";

export const dynamic = "force-dynamic";

type QuotationPdfPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function isPrintModeValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.includes("1");
  }

  return value === "1";
}

export async function generateMetadata({ params }: QuotationPdfPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createSupabaseClient();
  const { data: quotation } = await supabase
    .from("quotations")
    .select("quotation_no,title")
    .eq("id", id)
    .maybeSingle<{ quotation_no: string | null; title: string }>();

  return {
    title: quotationDocumentTitle(quotation),
  };
}

export default async function QuotationPdfPage({ params, searchParams }: QuotationPdfPageProps) {
  await requireActiveUser();
  const { id } = await params;
  const query = await searchParams;
  const [data, settingsResult] = await Promise.all([
    loadQuotationPdfDocumentData(id),
    loadQuotationPdfSettings(id),
  ]);
  const savedSettings = settingsResult.success
    ? settingsResult.settings
    : DEFAULT_QUOTATION_PDF_SETTINGS;
  const settingsLoadWarning = settingsResult.success
    ? null
    : "Using default PDF settings. Save may fail until quotation PDF settings storage is available.";
  const printMode = isPrintModeValue(query.print);

  if (printMode) {
    return <QuotationPdfDocument data={data} printMode settings={savedSettings} showToolbar={false} />;
  }

  return (
    <QuotationPdfPreviewEditor
      defaultSettings={normalizeQuotationPdfSettings(DEFAULT_QUOTATION_PDF_SETTINGS)}
      initialSettings={savedSettings}
      initialWarning={settingsLoadWarning}
      serializedData={serializeQuotationPdfDocumentData(data)}
    />
  );
}
