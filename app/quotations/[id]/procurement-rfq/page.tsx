import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import { requireActiveUser } from "@/lib/auth";
import {
  documentItemTitle,
  itemGroupLabel,
  loadQuotationDerivedDocumentData,
  preferredItemImageUrl,
  projectContactLine,
  selectedFinishSummaries,
  type DerivedDocumentItem,
  type DerivedDocumentSection,
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

function groupItems(items: DerivedDocumentItem[]) {
  const groups = new Map<string, { label: string; type: string; items: DerivedDocumentItem[] }>();

  for (const item of items) {
    const group = itemGroupLabel(item);
    const key = `${group.type}:${group.label}`;
    const current = groups.get(key);

    if (current) {
      current.items.push(item);
      continue;
    }

    groups.set(key, { ...group, items: [item] });
  }

  return Array.from(groups.values());
}

function sectionContext(sectionId: string | null, sectionsById: Map<string, DerivedDocumentSection>) {
  const section = sectionId ? sectionsById.get(sectionId) ?? null : null;
  const mainSection = section?.parent_section_id ? sectionsById.get(section.parent_section_id) ?? null : null;
  return {
    area: mainSection?.section_title ?? (section?.section_kind === "main" ? section.section_title : null),
    section: section && section.section_kind !== "main" ? section.section_title : null,
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

  const groupedItems = groupItems(data.items);
  const sectionsById = new Map(data.sections.map((section) => [section.id, section]));
  const generatedDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date());

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-6 print:bg-white print:px-0 print:py-0">
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          html, body { background: #ffffff; }
          .rfq-group { break-before: page; page-break-before: always; }
          .rfq-group:first-of-type { break-before: auto; page-break-before: auto; }
        }
      `}</style>

      <div className={`mx-auto mb-5 w-[210mm] max-w-full print:hidden ${printMode ? "hidden" : "block"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Procurement / Supplier RFQ</p>
            <p className="mt-1 text-sm text-zinc-600">Grouped by supplier, then brand fallback, using the current quotation items.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/quotations/${data.quotation.id}`} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
              Back to Quotation
            </Link>
            <Link href={`/quotations/${data.quotation.id}/download-procurement-rfq`} className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800">
              Download PDF
            </Link>
          </div>
        </div>
      </div>

      {groupedItems.map((group, groupIndex) => (
        <section
          key={`${group.type}:${group.label}`}
          className={`rfq-group mx-auto mb-6 w-[210mm] max-w-full rounded-2xl border border-zinc-200 bg-white px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] print:mb-0 print:w-auto print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none ${groupIndex === 0 ? "" : "print:mt-0"}`}
        >
          <header className="border-b border-zinc-200 pb-4">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Procurement / Supplier RFQ</p>
                <h1 className="mt-2 text-2xl font-semibold text-zinc-950">{group.label}</h1>
                <p className="mt-1 text-sm text-zinc-500">{group.type}</p>
              </div>
              <div className="grid gap-2 text-right text-xs text-zinc-600">
                <p><span className="font-semibold text-zinc-900">Quotation:</span> {data.quotation.quotation_no ?? "Draft"}</p>
                <p><span className="font-semibold text-zinc-900">Project:</span> {data.project?.project_name ?? data.quotation.title}</p>
                <p><span className="font-semibold text-zinc-900">Client:</span> {data.client?.company_name ?? "-"}</p>
                <p><span className="font-semibold text-zinc-900">Generated:</span> {generatedDate}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
              <p><span className="font-semibold text-zinc-900">Prepared By:</span> {data.companyProfile.displayName}</p>
              {projectContactLine(data.project) ? <p><span className="font-semibold text-zinc-900">Project Contact:</span> {projectContactLine(data.project)}</p> : null}
            </div>
          </header>

          <div className="mt-5 overflow-hidden border border-zinc-200">
            <table className="w-full border-collapse text-left text-[11px] text-zinc-700">
              <thead className="bg-zinc-50 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="border-b border-zinc-200 px-3 py-3">Item</th>
                  <th className="border-b border-zinc-200 px-3 py-3">Area / Section</th>
                  <th className="border-b border-zinc-200 px-3 py-3">Product</th>
                  <th className="border-b border-zinc-200 px-3 py-3">Details</th>
                  <th className="border-b border-zinc-200 px-3 py-3">Qty</th>
                  <th className="border-b border-zinc-200 px-3 py-3">Supplier Price</th>
                  <th className="border-b border-zinc-200 px-3 py-3">Lead Time</th>
                  <th className="border-b border-zinc-200 px-3 py-3">Availability</th>
                  <th className="border-b border-zinc-200 px-3 py-3">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item, itemIndex) => {
                  const context = sectionContext(item.section_id, sectionsById);
                  const finishes = selectedFinishSummaries(item);
                  const imageUrl = preferredItemImageUrl(item, data.imageUrlByItemId);

                  return (
                    <tr key={item.id} className={itemIndex % 2 === 0 ? "bg-white" : "bg-zinc-50/50"}>
                      <td className="align-top border-b border-zinc-200 px-3 py-3 text-xs font-semibold text-zinc-900">
                        {item.manual_serial?.trim() || String(itemIndex + 1).padStart(2, "0")}
                      </td>
                      <td className="align-top border-b border-zinc-200 px-3 py-3">
                        <p className="font-medium text-zinc-900">{context.area ?? "-"}</p>
                        {context.section ? <p className="mt-1 text-zinc-500">{context.section}</p> : null}
                      </td>
                      <td className="align-top border-b border-zinc-200 px-3 py-3">
                        <div className="grid gap-2">
                          <div className="h-20 w-20 overflow-hidden border border-zinc-200 bg-white">
                            <QuotationImageFrame
                              alt={documentItemTitle(item)}
                              className="h-full w-full overflow-hidden"
                              emptyContent={<span className="flex h-full items-center justify-center px-2 text-center text-[10px] text-zinc-400">No image</span>}
                              imageUrl={imageUrl}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="align-top border-b border-zinc-200 px-3 py-3">
                        <p className="font-semibold text-zinc-900">{documentItemTitle(item)}</p>
                        <div className="mt-2 grid gap-1 text-[11px] leading-5">
                          {item.item_code_snapshot ? <p><span className="font-semibold text-zinc-900">Code:</span> {item.item_code_snapshot}</p> : null}
                          {item.model_snapshot ? <p><span className="font-semibold text-zinc-900">Model:</span> {item.model_snapshot}</p> : null}
                          {item.brand_name_snapshot ? <p><span className="font-semibold text-zinc-900">Brand:</span> {item.brand_name_snapshot}</p> : null}
                          {item.origin_snapshot ? <p><span className="font-semibold text-zinc-900">Origin:</span> {item.origin_snapshot}</p> : null}
                          {item.size_snapshot ? <p><span className="font-semibold text-zinc-900">Dimensions:</span> {item.size_snapshot}</p> : null}
                          {item.specification_snapshot ? <p><span className="font-semibold text-zinc-900">Specification:</span> {item.specification_snapshot}</p> : null}
                          {finishes.length ? <p><span className="font-semibold text-zinc-900">Finishes:</span> {finishes.join(" | ")}</p> : null}
                        </div>
                      </td>
                      <td className="align-top border-b border-zinc-200 px-3 py-3 text-center font-semibold text-zinc-900">
                        {item.qty}
                      </td>
                      <td className="border-b border-zinc-200 px-3 py-3 align-middle">
                        <div className="h-9 rounded border border-dashed border-zinc-300 bg-white" />
                      </td>
                      <td className="border-b border-zinc-200 px-3 py-3 align-middle">
                        <div className="h-9 rounded border border-dashed border-zinc-300 bg-white" />
                      </td>
                      <td className="border-b border-zinc-200 px-3 py-3 align-middle">
                        <div className="h-9 rounded border border-dashed border-zinc-300 bg-white" />
                      </td>
                      <td className="border-b border-zinc-200 px-3 py-3 align-middle">
                        <div className="h-9 rounded border border-dashed border-zinc-300 bg-white" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}
