import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import { requireActiveUser } from "@/lib/auth";
import {
  documentItemTitle,
  loadQuotationDerivedDocumentData,
  preferredItemImageUrl,
  projectContactLine,
  selectedFinishSummaries,
  type DerivedDocumentSection,
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

function formatDate(value: string | null | undefined) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function sectionContext(sectionId: string | null, sectionsById: Map<string, DerivedDocumentSection>) {
  const section = sectionId ? sectionsById.get(sectionId) ?? null : null;
  const mainSection = section?.parent_section_id ? sectionsById.get(section.parent_section_id) ?? null : null;
  return {
    area: mainSection?.section_title ?? (section?.section_kind === "main" ? section.section_title : null),
    section: section && section.section_kind !== "main" ? section.section_title : null,
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

  const sectionsById = new Map(data.sections.map((section) => [section.id, section]));

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-6 print:bg-white print:px-0 print:py-0">
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>

      <div className={`mx-auto mb-5 w-[210mm] max-w-full print:hidden ${printMode ? "hidden" : "block"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Order Confirmation</p>
            <p className="mt-1 text-sm text-zinc-600">Client-facing approved item confirmation generated from the current quotation.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/quotations/${data.quotation.id}`} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
              Back to Quotation
            </Link>
            <Link href={`/quotations/${data.quotation.id}/download-order-confirmation`} className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800">
              Download PDF
            </Link>
          </div>
        </div>
      </div>

      <section className="mx-auto w-[210mm] max-w-full rounded-2xl border border-zinc-200 bg-white px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] print:w-auto print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none">
        <header className="border-b border-zinc-200 pb-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Order Confirmation</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{data.project?.project_name ?? data.quotation.title}</h1>
              <p className="mt-2 text-sm text-zinc-600">{data.client?.company_name ?? "-"}</p>
            </div>
            <div className="grid gap-2 text-right text-xs text-zinc-600">
              <p><span className="font-semibold text-zinc-900">Quotation:</span> {data.quotation.quotation_no ?? "Draft"}</p>
              <p><span className="font-semibold text-zinc-900">Date:</span> {formatDate(data.quotation.quotation_date)}</p>
              <p><span className="font-semibold text-zinc-900">Prepared By:</span> {data.companyProfile.displayName}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
            {data.project?.location ? <p><span className="font-semibold text-zinc-900">Location:</span> {data.project.location}</p> : null}
            {projectContactLine(data.project) ? <p><span className="font-semibold text-zinc-900">Attention / Contact:</span> {projectContactLine(data.project)}</p> : null}
          </div>
        </header>

        <div className="mt-6 grid gap-4">
          {data.items.map((item, index) => {
            const context = sectionContext(item.section_id, sectionsById);
            const finishes = selectedFinishSummaries(item);
            const imageUrl = preferredItemImageUrl(item, data.imageUrlByItemId);

            return (
              <article key={item.id} className="grid gap-4 border border-zinc-200 p-4 md:grid-cols-[120px_minmax(0,1fr)]">
                <div className="h-[120px] w-[120px] overflow-hidden border border-zinc-200 bg-white">
                  <QuotationImageFrame
                    alt={documentItemTitle(item)}
                    className="h-full w-full overflow-hidden"
                    emptyContent={<span className="flex h-full items-center justify-center px-2 text-center text-[10px] text-zinc-400">No image</span>}
                    imageUrl={imageUrl}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Approved Item {String(index + 1).padStart(2, "0")}</p>
                      <h2 className="mt-1 text-xl font-semibold text-zinc-950">{documentItemTitle(item)}</h2>
                    </div>
                    <div className="text-right text-xs text-zinc-600">
                      <p><span className="font-semibold text-zinc-900">Qty:</span> {item.qty}</p>
                      {context.area ? <p className="mt-1"><span className="font-semibold text-zinc-900">Area:</span> {context.area}</p> : null}
                      {context.section ? <p className="mt-1"><span className="font-semibold text-zinc-900">Section:</span> {context.section}</p> : null}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-x-6 gap-y-2 text-sm text-zinc-700 sm:grid-cols-2">
                    {item.item_code_snapshot ? <p><span className="font-semibold text-zinc-900">Code:</span> {item.item_code_snapshot}</p> : null}
                    {item.model_snapshot ? <p><span className="font-semibold text-zinc-900">Model:</span> {item.model_snapshot}</p> : null}
                    {item.brand_name_snapshot ? <p><span className="font-semibold text-zinc-900">Brand:</span> {item.brand_name_snapshot}</p> : null}
                    {item.origin_snapshot ? <p><span className="font-semibold text-zinc-900">Origin:</span> {item.origin_snapshot}</p> : null}
                    {item.size_snapshot ? <p><span className="font-semibold text-zinc-900">Dimensions:</span> {item.size_snapshot}</p> : null}
                    {finishes.length ? <p><span className="font-semibold text-zinc-900">Selected Finishes:</span> {finishes.join(" | ")}</p> : null}
                  </div>
                  {item.specification_snapshot ? (
                    <p className="mt-3 text-sm leading-6 text-zinc-600">
                      <span className="font-semibold text-zinc-900">Specification:</span> {item.specification_snapshot}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="border border-zinc-200 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Delivery / Installation Notes</p>
            <div className="mt-4 grid gap-3">
              <div className="h-8 border-b border-zinc-200" />
              <div className="h-8 border-b border-zinc-200" />
              <div className="h-8 border-b border-zinc-200" />
            </div>
            {data.quotation.delivery_terms ? (
              <p className="mt-4 text-sm text-zinc-600">
                <span className="font-semibold text-zinc-900">Current Delivery Terms:</span> {data.quotation.delivery_terms}
              </p>
            ) : null}
          </div>
          <div className="border border-zinc-200 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Payment Terms</p>
            <p className="mt-4 text-sm leading-6 text-zinc-700">{data.quotation.payment_terms || "To be confirmed."}</p>
          </div>
        </div>

        <div className="mt-8 border border-zinc-200 p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Approval / Signature</p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="grid gap-8">
              <div>
                <p className="text-xs font-semibold text-zinc-900">Client Name</p>
                <div className="mt-6 border-b border-zinc-300" />
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-900">Signature</p>
                <div className="mt-6 border-b border-zinc-300" />
              </div>
            </div>
            <div className="grid gap-8">
              <div>
                <p className="text-xs font-semibold text-zinc-900">Date</p>
                <div className="mt-6 border-b border-zinc-300" />
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-900">Company Stamp</p>
                <div className="mt-6 border-b border-zinc-300" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
