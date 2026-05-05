import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PrintActions } from "@/components/quotations/print-actions";
import { requireActiveUser } from "@/lib/auth";
import { COMPANY_PROFILE } from "@/lib/company-profile";
import { formatMoney } from "@/lib/currencies";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type QuotationPdfPageProps = {
  params: Promise<{ id: string }>;
};

type Client = {
  id: string;
  company_name: string;
};

type Project = {
  id: string;
  project_name: string;
  project_year: number | null;
  project_code: string | null;
  location: string | null;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
  po_box: string | null;
  project_address: string | null;
};

type Quotation = {
  id: string;
  client_id: string;
  project_id: string;
  quotation_no: string | null;
  revision_no: number;
  title: string;
  quotation_date: string;
  status: string;
  currency: string;
  vat_percent: number;
  overall_discount_type: string;
  overall_discount_value: number;
  subtotal: number;
  discount_total: number;
  vat_amount: number;
  grand_total: number;
  payment_terms: string | null;
  validity: string | null;
  delivery_terms: string | null;
  warranty_terms: string | null;
  notes: string | null;
};

type QuotationSection = {
  id: string;
  section_title: string;
  section_notes: string | null;
  sort_order: number;
  is_active: boolean;
};

type QuotationItem = {
  id: string;
  section_id: string | null;
  item_type: string;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  specification_snapshot: string | null;
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  warranty_snapshot: string | null;
  supplier_name_snapshot: string | null;
  supplier_notes_snapshot: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  discount_type: string;
  discount_value: number;
  net_price: number;
  net_total: number;
  currency: string;
  sort_order: number;
  line_style: string;
  is_active: boolean;
  notes: string | null;
};

function quotationDocumentTitle(quotation?: Pick<Quotation, "quotation_no" | "title"> | null) {
  const quotationNo = quotation?.quotation_no ?? "Draft";
  const title = quotation?.title ?? "Quotation";

  return `${quotationNo} - ${title}`.replace(/[\\/:*?"<>|]/g, "-");
}

export async function generateMetadata({ params }: QuotationPdfPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createSupabaseClient();
  const { data: quotation } = await supabase
    .from("quotations")
    .select("quotation_no,title")
    .eq("id", id)
    .maybeSingle<Pick<Quotation, "quotation_no" | "title">>();

  return {
    title: quotationDocumentTitle(quotation),
  };
}

function isDirectImageUrl(value: string) {
  return /^(https?:|data:|\/)/i.test(value);
}

async function signedImageUrl(value: string | null, supabase: Awaited<ReturnType<typeof createSupabaseClient>>) {
  if (!value) return null;
  if (isDirectImageUrl(value)) return value;

  const bucket = value.startsWith("product-images:") ? "product-images" : "quote-images";
  const storagePath = value.startsWith("product-images:")
    ? value.slice("product-images:".length)
    : value;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    console.error("QUOTATION PRINT IMAGE SIGN ERROR", error.message);
    return null;
  }

  return data.signedUrl;
}

function projectContactLine(project?: Project | null) {
  return [
    project?.attention_to ? `Attn: ${project.attention_to}` : null,
    project?.attention_mobile ? `Mob: ${project.attention_mobile}` : null,
    project?.attention_landline ? `Tel: ${project.attention_landline}` : null,
    project?.attention_email ? `Email: ${project.attention_email}` : null,
    project?.po_box ? `PO Box: ${project.po_box}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function revisionLabel(quotation: Quotation) {
  if (!quotation.revision_no) return "-";
  return `Rev ${quotation.revision_no}`;
}

function discountAmount(item: QuotationItem) {
  if (item.discount_type === "percent") {
    return (item.unit_price * item.discount_value) / 100;
  }

  return item.discount_value || 0;
}

function tableNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function overallDiscountAmount(quotation: Quotation) {
  const itemNetTotal = Math.max(quotation.subtotal - quotation.discount_total, 0);

  if (quotation.overall_discount_type === "percent") {
    return (itemNetTotal * quotation.overall_discount_value) / 100;
  }

  return quotation.overall_discount_value;
}

function InfoLine({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 text-xs text-zinc-900">{value || "-"}</dd>
    </div>
  );
}

function MetaLine({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <>
      <dt className="text-right text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium text-zinc-900 [overflow-wrap:anywhere]">{value || "-"}</dd>
    </>
  );
}

function ImageBox({ src }: { src: string | null }) {
  return (
    <div className="mx-auto flex h-[78px] w-[105px] items-center justify-center overflow-hidden bg-white">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Proposed item" className="max-h-full max-w-full object-contain" />
      ) : null}
    </div>
  );
}

function SpecificationBlock({ item }: { item: QuotationItem }) {
  return (
    <div className="space-y-1">
      <p className="font-semibold text-zinc-950">
        {item.item_name_snapshot ?? item.model_snapshot ?? "Custom item"}
      </p>
      {item.item_code_snapshot ? (
        <p className="text-[10px] font-semibold uppercase text-zinc-500">{item.item_code_snapshot}</p>
      ) : null}
      {item.specification_snapshot ? (
        <p className="whitespace-pre-wrap text-zinc-700">{item.specification_snapshot}</p>
      ) : null}
      {item.size_snapshot ? <p className="text-zinc-600">Dimension: {item.size_snapshot}</p> : null}
      {item.finish_snapshot ? <p className="text-zinc-600">Finish: {item.finish_snapshot}</p> : null}
      {item.warranty_snapshot ? <p className="text-zinc-600">Warranty: {item.warranty_snapshot}</p> : null}
      {item.room_name_snapshot ? <p className="text-zinc-500">Room: {item.room_name_snapshot}</p> : null}
      {item.notes ? <p className="whitespace-pre-wrap text-zinc-500">{item.notes}</p> : null}
    </div>
  );
}

function sectionSubtotal(items: QuotationItem[]) {
  return items.reduce((total, item) => total + item.net_total, 0);
}

function fullWidthRowText(item: QuotationItem) {
  return [item.item_name_snapshot, item.specification_snapshot, item.notes]
    .filter(Boolean)
    .join(" - ");
}

function isHeadingRow(item: QuotationItem) {
  return item.line_style === "heading";
}

export default async function QuotationPdfPage({ params }: QuotationPdfPageProps) {
  await requireActiveUser();
  const { id } = await params;
  const supabase = await createSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", id)
    .single<Quotation>();

  if (quotationError || !quotation) {
    notFound();
  }

  const [{ data: client }, { data: project }, { data: sections }, { data: items }] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id,company_name")
        .eq("id", quotation.client_id)
        .single<Client>(),
      supabase
        .from("projects")
        .select("id,project_name,project_year,project_code,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
        .eq("id", quotation.project_id)
        .single<Project>(),
      supabase
        .from("quotation_sections")
        .select("id,section_title,section_notes,sort_order,is_active")
        .eq("quotation_id", id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("section_title", { ascending: true })
        .returns<QuotationSection[]>(),
      supabase
        .from("quotation_items")
        .select("id,section_id,item_type,manual_serial,item_code_snapshot,item_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,line_style,is_active,notes")
        .eq("quotation_id", id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .returns<QuotationItem[]>(),
    ]);

  const activeItems = (items ?? []).filter((item) => item.is_active);
  const specifiedImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.specified_image_url_snapshot, supabase),
    ] as const),
  );
  const proposedImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.proposed_image_url_snapshot, supabase),
    ] as const),
  );
  const specifiedImageUrlByItemId = new Map(specifiedImageEntries);
  const proposedImageUrlByItemId = new Map(proposedImageEntries);
  const itemsBySection = new Map<string, QuotationItem[]>();

  for (const item of activeItems) {
    const key = item.section_id ?? "unsectioned";
    const sectionItems = itemsBySection.get(key) ?? [];
    sectionItems.push(item);
    itemsBySection.set(key, sectionItems);
  }

  const printableSections = [
    ...(sections ?? []),
    ...(itemsBySection.has("unsectioned")
      ? [{ id: "unsectioned", section_title: "General Items", section_notes: null, sort_order: 999999, is_active: true }]
      : []),
  ];
  const hasLogo = existsSync(join(process.cwd(), "public", COMPANY_PROFILE.logoPath.replace(/^\//, "")));

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-5 font-sans text-zinc-950 print:bg-white print:p-0">
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          .print-sheet { box-shadow: none !important; border: 0 !important; width: 100% !important; max-width: none !important; padding: 0 !important; }
          thead { display: table-header-group; }
          tr, .avoid-break, .totals-box, .terms-block, .print-section-heading { break-inside: avoid; page-break-inside: avoid; }
          .print-section + .print-section { break-before: page; page-break-before: always; }
          .final-section { break-before: page; page-break-before: always; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-[1280px] flex-wrap items-center justify-between gap-3">
        <Link href={`/quotations/${quotation.id}`} className="text-sm font-semibold text-emerald-900">
          Back to quotation
        </Link>
        <PrintActions />
      </div>

      <article className="print-sheet mx-auto box-border w-full max-w-[1280px] bg-white p-8 shadow-sm ring-1 ring-zinc-200">
        <header className="border-b border-zinc-300 pb-5">
          <div className="grid w-full max-w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-6 box-border">
            <div className="min-w-0 justify-self-start">
              {hasLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={COMPANY_PROFILE.logoPath} alt={COMPANY_PROFILE.name} className="h-[60px] w-[180px] object-contain" />
              ) : (
                <div className="flex h-[60px] w-[180px] items-center justify-center border-2 border-zinc-900 px-4 text-center text-base font-black leading-tight tracking-tight">
                  NOA Office Solutions
                </div>
              )}
              <div className="mt-2">
                <p className="text-base font-bold leading-tight text-zinc-950">{COMPANY_PROFILE.name}</p>
                <p className="hidden">
                  {COMPANY_PROFILE.offices.map((office) => office.location).join(" · ")}
                </p>
                <p className="mt-0.5 text-xs text-zinc-600">
                  {COMPANY_PROFILE.offices.map((office) => office.location).join(" / ")}
                </p>
                <p className="text-xs text-zinc-600">TRN: {COMPANY_PROFILE.trn}</p>
              </div>
            </div>
            <div className="min-w-0 justify-self-center pt-1 text-center">
              <p className="text-[22px] font-bold tracking-[0.08em] text-zinc-950">QUOTATION</p>
            </div>
            <div className="box-border flex w-full min-w-0 justify-end justify-self-end text-right">
              <dl className="grid w-full max-w-[240px] min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <MetaLine label="Ref No." value={quotation.quotation_no ?? "Draft"} />
                <MetaLine label="Date" value={quotation.quotation_date} />
                {quotation.revision_no ? <MetaLine label="Revision" value={revisionLabel(quotation)} /> : null}
                <MetaLine label="Status" value={quotation.status} />
              </dl>
            </div>
          </div>
        </header>

        <section className="mt-5">
          <div className="border-b border-zinc-300 pb-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Client & Project</h2>
            <dl className="mt-3 grid gap-3 md:grid-cols-2">
              <InfoLine label="Client" value={client?.company_name ?? "Unknown client"} />
              <InfoLine label="Project" value={project?.project_name ?? "Unknown project"} />
              <InfoLine label="Location" value={project?.location} />
              <InfoLine label="Project No. / Year" value={[project?.project_code, project?.project_year].filter(Boolean).join(" / ")} />
              <InfoLine label="Attention / Contact" value={projectContactLine(project)} />
              <InfoLine label="Project Address" value={project?.project_address} />
            </dl>
          </div>
        </section>

        <section className="mt-6 space-y-6">
          {printableSections.map((section) => {
            const sectionItems = itemsBySection.get(section.id) ?? [];
            const subtotal = sectionSubtotal(sectionItems);

            return (
              <section key={section.id} className="print-section">
                <div className="print-section-heading border border-zinc-300 bg-zinc-100 px-3 py-2 text-center">
                  <h2 className="text-sm font-bold text-zinc-950">{section.section_title}</h2>
                  {section.section_notes ? (
                    <p className="mt-1 text-xs text-zinc-600">{section.section_notes}</p>
                  ) : null}
                </div>
                <table className="w-full table-fixed border-collapse text-[10px] leading-snug">
                  <colgroup>
                    <col className="w-[5%]" />
                    <col className="w-[13%]" />
                    <col className="w-[13%]" />
                    <col className="w-[24%]" />
                    <col className="w-[11%]" />
                    <col className="w-[6%]" />
                    <col className="w-[8%]" />
                    <col className="w-[7%]" />
                    <col className="w-[7%]" />
                    <col className="w-[6%]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-zinc-100 text-left text-[9px] uppercase tracking-wide text-zinc-600">
                      <th className="border border-zinc-300 px-2 py-2 text-center">S. No.</th>
                      <th className="border border-zinc-300 px-2 py-2 text-center">Specified Item Reference Image</th>
                      <th className="border border-zinc-300 px-2 py-2 text-center">Proposed Item Reference Image</th>
                      <th className="border border-zinc-300 px-2 py-2">Specifications</th>
                      <th className="border border-zinc-300 px-2 py-2">Origin / Supplier</th>
                      <th className="border border-zinc-300 px-2 py-2 text-center">Qty</th>
                      <th className="border border-zinc-300 px-2 py-2 text-center">
                        <span className="block">U.Price</span>
                        <span className="block text-[8px] font-semibold">{quotation.currency}</span>
                      </th>
                      <th className="border border-zinc-300 px-2 py-2 text-center">
                        <span className="block">Disc. Amount</span>
                        <span className="block text-[8px] font-semibold">{quotation.currency}</span>
                      </th>
                      <th className="border border-zinc-300 px-2 py-2 text-center">
                        <span className="block">Net Price</span>
                        <span className="block text-[8px] font-semibold">{quotation.currency}</span>
                      </th>
                      <th className="border border-zinc-300 px-2 py-2 text-center">
                        <span className="block">Net Total</span>
                        <span className="block text-[8px] font-semibold">{quotation.currency}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionItems.map((item, index) => (
                      isHeadingRow(item) ? (
                        <tr key={item.id} className="avoid-break">
                          <td
                            colSpan={10}
                            className="border border-zinc-300 bg-zinc-50 px-3 py-2 text-center text-sm font-bold text-zinc-900"
                          >
                            {fullWidthRowText(item) || "Heading"}
                          </td>
                        </tr>
                      ) : (
                        <tr key={item.id}>
                          <td className="border border-zinc-300 px-2 py-2 text-center align-middle text-zinc-700">
                            {item.manual_serial || `${index + 1}`}
                          </td>
                          <td className="border border-zinc-300 px-2 py-2 text-center align-middle">
                            <ImageBox src={specifiedImageUrlByItemId.get(item.id) ?? null} />
                          </td>
                          <td className="border border-zinc-300 px-2 py-2 text-center align-middle">
                            <ImageBox src={proposedImageUrlByItemId.get(item.id) ?? null} />
                          </td>
                          <td className="border border-zinc-300 px-2 py-2 align-top">
                            <SpecificationBlock item={item} />
                          </td>
                          <td className="border border-zinc-300 px-2 py-2 text-center align-middle text-zinc-700">
                            {item.origin_snapshot ? <p>{item.origin_snapshot}</p> : null}
                            {item.supplier_name_snapshot ? <p className="mt-1">{item.supplier_name_snapshot}</p> : null}
                            {item.supplier_notes_snapshot ? (
                              <p className="mt-1 whitespace-pre-wrap text-zinc-500">{item.supplier_notes_snapshot}</p>
                            ) : null}
                          </td>
                          <td className="border border-zinc-300 px-2 py-2 text-center align-middle">
                            {item.qty} {item.unit_label}
                          </td>
                          <td className="border border-zinc-300 px-2 py-2 text-center align-middle">
                            {tableNumber(item.unit_price)}
                          </td>
                          <td className="border border-zinc-300 px-2 py-2 text-center align-middle">
                            {tableNumber(discountAmount(item))}
                          </td>
                          <td className="border border-zinc-300 px-2 py-2 text-center align-middle">
                            {tableNumber(item.net_price)}
                          </td>
                          <td className="border border-zinc-300 px-2 py-2 text-center align-middle font-semibold">
                            {tableNumber(item.net_total)}
                          </td>
                        </tr>
                      )
                    ))}
                    <tr className="avoid-break bg-zinc-50">
                      <td colSpan={9} className="border border-zinc-300 px-3 py-2 text-right font-bold uppercase tracking-wide text-zinc-600">
                        Section Subtotal
                      </td>
                      <td className="border border-zinc-300 px-2 py-2 text-right font-bold text-zinc-950">
                        {formatMoney(quotation.currency, subtotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>
            );
          })}
        </section>

        <section className="final-section mt-6 grid items-start gap-6 md:grid-cols-[1fr_360px]">
          <div className="terms-block space-y-4">
            {quotation.notes ? (
              <div className="border-l-4 border-emerald-900 bg-zinc-50 p-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Notes</h2>
                <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-700">{quotation.notes}</p>
              </div>
            ) : null}
            <div className="border-t border-zinc-300 pt-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">Commercial Terms</h2>
              <dl className="mt-3 grid gap-3 md:grid-cols-3">
                <InfoLine label="Payment Terms" value={quotation.payment_terms} />
                <InfoLine label="Validity" value={quotation.validity} />
                <InfoLine label="Warranty" value={quotation.warranty_terms} />
                <InfoLine label="Delivery Terms" value={quotation.delivery_terms} />
                <InfoLine label="Currency" value={quotation.currency} />
                <InfoLine label="VAT" value={`${quotation.vat_percent}%`} />
              </dl>
            </div>
          </div>
          <div className="totals-box border border-zinc-900 bg-white">
            <div className="bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white">
              Summary
            </div>
            <div className="flex justify-between border-b border-zinc-200 px-4 py-2 text-xs">
              <span>Total Price</span>
              <span className="font-semibold">{formatMoney(quotation.currency, quotation.subtotal)}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-200 px-4 py-2 text-xs">
              <span>Item Discount</span>
              <span className="font-semibold">{formatMoney(quotation.currency, quotation.discount_total)}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-200 px-4 py-2 text-xs">
              <span>Extra Discount</span>
              <span className="font-semibold">{formatMoney(quotation.currency, overallDiscountAmount(quotation))}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-200 px-4 py-2 text-xs">
              <span>VAT {quotation.vat_percent}%</span>
              <span className="font-semibold">{formatMoney(quotation.currency, quotation.vat_amount)}</span>
            </div>
            <div className="flex justify-between px-4 py-4 text-base font-black text-zinc-950">
              <span>Final Total</span>
              <span>{formatMoney(quotation.currency, quotation.grand_total)}</span>
            </div>
          </div>
        </section>

        <section className="terms-block mt-8 border-t border-zinc-300 pt-6">
          <p className="text-sm text-zinc-700">
            Assuring you of our best cooperation we remain,
          </p>
          <p className="mt-2 text-sm font-semibold text-zinc-950">Yours faithfully,</p>
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">NOA Office Solutions</p>
              <div className="mt-12 border-t border-zinc-400 pt-2 text-xs text-zinc-600">
                Prepared by
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">For Approval</p>
              <div className="mt-12 border-t border-zinc-400 pt-2 text-xs text-zinc-600">
                Authorized signature / stamp
              </div>
            </div>
          </div>
        </section>
      </article>
    </main>
  );
}
