import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuotationPresentation } from "@/components/quotations/quotation-presentation";
import { requireActiveUser } from "@/lib/auth";
import {
  loadQuotationPresentationData,
  presentationDocumentTitle,
  type PresentationQuotation,
} from "@/lib/quotations/presentation-document";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PresentationPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: PresentationPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createSupabaseClient();
  const { data: quotation } = await supabase
    .from("quotations")
    .select("quotation_no,title")
    .eq("id", id)
    .maybeSingle<Pick<PresentationQuotation, "quotation_no" | "title">>();

  return {
    title: presentationDocumentTitle(quotation),
  };
}

export default async function QuotationPresentationPage({ params, searchParams }: PresentationPageProps) {
  await requireActiveUser();
  const { id } = await params;
  const query = await searchParams;
  const presentationData = await loadQuotationPresentationData(id);
  const printMode = query.print === "1";

  if (!presentationData) {
    notFound();
  }

  return (
    <QuotationPresentation
      client={presentationData.client}
      companyProfile={presentationData.companyProfile}
      finishImageUrlByItemAndFinishId={presentationData.finishImageUrlByItemAndFinishId}
      imageUrlByItemId={presentationData.imageUrlByItemId}
      initialSettings={presentationData.initialSettings}
      items={presentationData.items}
      mainLayoutImageUrlById={presentationData.mainLayoutImageUrlById}
      presentationOverrideImageUrlByItemId={presentationData.presentationOverrideImageUrlByItemId}
      project={presentationData.project}
      quotation={presentationData.quotation}
      sectionOverrideImageUrlBySectionAndField={presentationData.sectionOverrideImageUrlBySectionAndField}
      sections={presentationData.sections}
      printMode={printMode}
    />
  );
}
