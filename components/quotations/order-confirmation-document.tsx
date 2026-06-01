import type { ReactNode } from "react";
import { DocumentFooter } from "@/components/quotations/document-page";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import { buildOrderConfirmationPages, type OrderConfirmationDocumentItem, type OrderConfirmationPage } from "@/lib/quotations/order-confirmation-pages";
import type { OrderConfirmationColumnVisibility, OrderConfirmationDocumentDetails, OrderConfirmationTerms } from "@/lib/quotations/order-confirmation-settings";
import {
  DEFAULT_PORTRAIT_PRINT_SETTINGS,
  type DocumentPrintSettings,
} from "@/lib/quotations/document-print-settings";

type OrderConfirmationDocumentProps = {
  companyLogoUrl: string | null;
  defaultEmptyMessage?: string;
  items: OrderConfirmationDocumentItem[];
  settings: {
    columnVisibility: OrderConfirmationColumnVisibility;
    documentDetails: OrderConfirmationDocumentDetails;
    print?: DocumentPrintSettings;
    terms: OrderConfirmationTerms;
  };
};

function formatDate(value: string | null | undefined) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function splitLines(value: string | null | undefined) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizedText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function PrintPage({ children, orientation }: { children: ReactNode; orientation: DocumentPrintSettings["orientation"] }) {
  const pageClassName = orientation === "landscape"
    ? "h-[210mm] min-h-[210mm] w-[297mm] print:h-[210mm] print:min-h-[210mm] print:w-[297mm]"
    : "h-[297mm] min-h-[297mm] w-[210mm] print:h-[297mm] print:min-h-[297mm] print:w-[210mm]";

  return (
    <section className={`doc-page mx-auto mb-6 flex max-w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white px-[10mm] py-[10mm] shadow-[0_20px_60px_rgba(15,23,42,0.08)] print:mb-0 print:max-w-none print:rounded-none print:border-0 print:px-[10mm] print:py-[10mm] print:shadow-none ${pageClassName}`}>
      {children}
    </section>
  );
}

function LogoBlock({
  companyDisplayName,
  logoDisplayMode,
  logoUrl,
  showLogo,
}: {
  companyDisplayName: string;
  logoDisplayMode: OrderConfirmationDocumentDetails["logoDisplayMode"];
  logoUrl: string | null;
  showLogo: boolean;
}) {
  if (!showLogo || logoDisplayMode === "text_wordmark_fallback" || !logoUrl) {
    return <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-900">{companyDisplayName || "Noa Offices"}</p>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt={companyDisplayName || "Noa Offices"} className="max-h-10 max-w-[140px] w-auto object-contain" />
  );
}

function Header({
  companyLogoUrl,
  details,
  page,
  print,
}: {
  companyLogoUrl: string | null;
  details: OrderConfirmationDocumentDetails;
  page: OrderConfirmationPage;
  print: DocumentPrintSettings;
}) {
  if (!page.isFirstPage && print.showFullHeaderOnlyFirstPage) return null;

  return (
    <header className="shrink-0 border-b border-zinc-200 pb-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[8px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            {details.title || "ORDER CONFIRMATION"}
          </p>
          <p className="mt-0.5 text-[9px] font-semibold leading-4 text-zinc-950">{details.projectDisplayName || "Project"}</p>
          <p className="mt-0.5 text-[8px] text-zinc-600">{details.clientDisplayName || "-"}</p>
        </div>
        <div className="grid gap-2 text-right">
          <div className="justify-self-end">
            <LogoBlock
              companyDisplayName={details.companyDisplayName}
              logoDisplayMode={details.logoDisplayMode}
              logoUrl={companyLogoUrl}
              showLogo={details.showLogo}
            />
          </div>
          <div className="grid gap-0.5 text-[8px] leading-4 text-zinc-600">
            <p><span className="text-[7px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Confirmation No</span><span className="ml-2 text-[9px] text-zinc-900">{details.confirmationNumber || "-"}</span></p>
            <p><span className="text-[7px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Date</span><span className="ml-2 text-[9px] text-zinc-900">{formatDate(details.confirmationDate) || "-"}</span></p>
            <p><span className="text-[7px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Prepared By</span><span className="ml-2 text-[9px] text-zinc-900">{details.preparedBy || "-"}</span></p>
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-[8px]">
        <div>
          <p className="text-[7px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Location</p>
          <p className="mt-px text-[8px] text-zinc-900">{details.location || "-"}</p>
        </div>
        <div>
          <p className="text-[7px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Attention / Contact</p>
          <p className="mt-px text-[8px] text-zinc-900">{details.attentionContact || "-"}</p>
        </div>
        <div>
          <p className="text-[7px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Quotation Ref</p>
          <p className="mt-px text-[8px] text-zinc-900">{details.quotationReference || "-"}</p>
        </div>
      </div>
    </header>
  );
}

function ItemCard({
  columnVisibility,
  item,
  print,
}: {
  columnVisibility: OrderConfirmationColumnVisibility;
  item: OrderConfirmationDocumentItem & { rowNumber: number };
  print: DocumentPrintSettings;
}) {
  const showDescription = Boolean(item.description) && normalizedText(item.description) !== normalizedText(item.specification);
  const showSpecification = columnVisibility.specification && Boolean(item.specification);
  const imageSizeClassName = print.imageSize === "small"
    ? "h-[56px] w-[56px]"
    : print.imageSize === "large"
      ? "h-[84px] w-[84px]"
      : "h-[68px] w-[68px]";

  return (
    <article className="border border-zinc-200 px-2 py-1.5" key={item.id}>
      <div className={`grid items-start gap-2 ${columnVisibility.image ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"}`}>
        {columnVisibility.image ? (
          <div className={`flex ${imageSizeClassName} items-center justify-center overflow-hidden border border-zinc-200 bg-white`}>
            <QuotationImageFrame
              alt={item.title}
              className="h-full w-full overflow-hidden"
              emptyContent={<span className="flex h-full items-center justify-center px-1 text-center text-[7px] text-zinc-400">No image</span>}
              imageUrl={item.imageUrl}
            />
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[7px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Approved Item {String(item.rowNumber).padStart(2, "0")}</p>
              <h2 className="mt-px text-[10px] font-semibold leading-[1.2] text-zinc-950">{item.title}</h2>
            </div>
            {columnVisibility.quantity ? (
              <p className="text-[7.5px] text-zinc-600"><span className="font-semibold text-zinc-900">Qty:</span> {item.quantity}</p>
            ) : null}
          </div>
          <div className="mt-1 grid gap-x-3 gap-y-0 text-[7.5px] leading-3.5 text-zinc-700 sm:grid-cols-2">
            {columnVisibility.code && item.code ? <p><span className="font-semibold text-zinc-900">Code:</span> {item.code}</p> : null}
            {columnVisibility.model && item.model ? <p><span className="font-semibold text-zinc-900">Model:</span> {item.model}</p> : null}
            {columnVisibility.brand && item.brand ? <p><span className="font-semibold text-zinc-900">Brand:</span> {item.brand}</p> : null}
            {columnVisibility.origin && item.origin ? <p><span className="font-semibold text-zinc-900">Origin:</span> {item.origin}</p> : null}
            {columnVisibility.dimensions && item.dimensions ? <p><span className="font-semibold text-zinc-900">Dimensions:</span> {item.dimensions}</p> : null}
            {columnVisibility.areaSection && item.areaSection ? <p><span className="font-semibold text-zinc-900">Area / Section:</span> {item.areaSection}</p> : null}
            {columnVisibility.selectedFinishes && item.finish ? <p className="sm:col-span-2"><span className="font-semibold text-zinc-900">Selected Finishes:</span> {item.finish}</p> : null}
          </div>
          {showDescription ? <p className="mt-1 text-[7.5px] leading-3.5 text-zinc-600">{item.description}</p> : null}
          {showSpecification ? <p className="mt-0.5 text-[7.5px] leading-3.5 text-zinc-600"><span className="font-semibold text-zinc-900">Specification:</span> {item.specification}</p> : null}
          {item.note ? <p className="mt-0.5 text-[7.5px] leading-3.5 text-zinc-600"><span className="font-semibold text-zinc-900">Client Note:</span> {item.note}</p> : null}
        </div>
      </div>
    </article>
  );
}

function ClosingSections({ terms }: { terms: OrderConfirmationTerms | null }) {
  if (!terms) return null;

  return (
    <div className="space-y-3">
      <section className="border-t border-zinc-200 pt-2.5">
        <p className="text-[7px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Delivery / Installation Note</p>
        <div className="mt-1.5 grid gap-0.5 text-[7.5px] leading-4 text-zinc-700">
          {splitLines(terms.deliveryInstallationNote).map((line, index) => (
            <p key={`delivery-${index}`}>{line}</p>
          ))}
        </div>
      </section>
      <section className="border-t border-zinc-200 pt-2.5">
        <p className="text-[7px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Payment Terms</p>
        <div className="mt-1.5 grid gap-0.5 text-[7.5px] leading-4 text-zinc-700">
          {splitLines(terms.paymentTerms).map((line, index) => (
            <p key={`payment-${index}`}>{line}</p>
          ))}
        </div>
      </section>
      <section className="border-t border-zinc-200 pt-2.5">
        <p className="text-[7px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Confirmation Notes</p>
        <div className="mt-1.5 grid gap-0.5 text-[7.5px] leading-4 text-zinc-700">
          {splitLines(terms.generalConfirmationNote).map((line, index) => (
            <p key={`general-${index}`}>{line}</p>
          ))}
          {splitLines(terms.approvalStatement).map((line, index) => (
            <p key={`approval-${index}`} className="font-medium text-zinc-900">{line}</p>
          ))}
        </div>
      </section>
      <section className="border-t border-zinc-200 pt-2.5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-5">
            <div>
              <p className="text-[7.5px] font-semibold text-zinc-900">Client Name</p>
              <p className="mt-0.5 text-[7.5px] text-zinc-600">{terms.clientName || "-"}</p>
            </div>
            <div>
              <p className="text-[7.5px] font-semibold text-zinc-900">{terms.signatureLabel}</p>
              <div className="mt-4 border-b border-zinc-300" />
            </div>
          </div>
          <div className="grid gap-5">
            <div>
              <p className="text-[7.5px] font-semibold text-zinc-900">Authorized Person</p>
              <p className="mt-0.5 text-[7.5px] text-zinc-600">{terms.authorizedPerson || "-"}</p>
            </div>
            <div>
              <p className="text-[7.5px] font-semibold text-zinc-900">{terms.dateLabel}</p>
              <div className="mt-4 border-b border-zinc-300" />
            </div>
            <div>
              <p className="text-[7.5px] font-semibold text-zinc-900">{terms.companyStampLabel}</p>
              <div className="mt-4 border-b border-zinc-300" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function OrderConfirmationDocument({
  companyLogoUrl,
  defaultEmptyMessage = "No approved items available for this order confirmation.",
  items,
  settings,
}: OrderConfirmationDocumentProps) {
  const print = settings.print ?? DEFAULT_PORTRAIT_PRINT_SETTINGS;

  if (items.length === 0) {
    return (
      <PrintPage orientation={print.orientation}>
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">{defaultEmptyMessage}</div>
        <DocumentFooter pageNumber={1} totalPages={1} />
      </PrintPage>
    );
  }

  const pages = buildOrderConfirmationPages({
    closing: { terms: settings.terms },
    columnVisibility: settings.columnVisibility,
    items,
    print,
  });

  return (
    <>
      {pages.map((page) => (
        <PrintPage key={`oc-page-${page.pageIndex}-${page.isClosingPage ? "closing" : "items"}`} orientation={print.orientation}>
          <Header companyLogoUrl={companyLogoUrl} details={settings.documentDetails} page={page} print={print} />
          <div className={`flex-1 overflow-hidden ${page.isFirstPage ? "mt-2" : ""}`}>
            {page.isItemPage && page.items.length > 0 ? (
              <div className="space-y-1.5">
                {page.items.map((item) => <ItemCard key={item.id} columnVisibility={settings.columnVisibility} item={item} print={print} />)}
                <ClosingSections terms={page.closing?.terms ?? null} />
              </div>
            ) : (
              <ClosingSections terms={page.closing?.terms ?? null} />
            )}
          </div>
          <DocumentFooter pageNumber={page.pageIndex + 1} totalPages={page.totalPages} />
        </PrintPage>
      ))}
    </>
  );
}
