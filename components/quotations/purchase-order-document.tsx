import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import { DocumentFooter, DocumentHeader, DocumentMetaList, DocumentPage } from "@/components/quotations/document-page";
import { formatPurchaseOrderMoney } from "@/lib/quotations/purchase-order-currency";
import { buildPurchaseOrderPages, type PurchaseOrderClosingContent, type PurchaseOrderDocumentItem, type PurchaseOrderDocumentSupplier, type PurchaseOrderPage } from "@/lib/quotations/purchase-order-pages";
import type { PurchaseOrderColumnVisibility, PurchaseOrderDocumentDetails, PurchaseOrderTerms } from "@/lib/quotations/purchase-order-settings";

type PurchaseOrderDocumentProps = {
  companyLogoUrl: string | null;
  hasPriceValues: boolean;
  poCurrency: string;
  settings: {
    columnVisibility: PurchaseOrderColumnVisibility;
    documentDetails: PurchaseOrderDocumentDetails;
    terms: PurchaseOrderTerms;
  };
  subtotal: number;
  supplier: PurchaseOrderDocumentSupplier;
  supplierLabel: string;
  items: PurchaseOrderDocumentItem[];
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

function LogoBlock({
  companyDisplayName,
  logoDisplayMode,
  logoUrl,
  showLogo,
}: {
  companyDisplayName: string;
  logoDisplayMode: PurchaseOrderDocumentDetails["logoDisplayMode"];
  logoUrl: string | null;
  showLogo: boolean;
}) {
  if (!showLogo || logoDisplayMode === "text_wordmark_fallback" || !logoUrl) {
    return <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-900">{companyDisplayName || "Noa Offices"}</p>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt={companyDisplayName || "Noa Offices"} className="max-h-9 max-w-[115px] w-auto object-contain" />
  );
}

function CompactHeader({
  companyLogoUrl,
  details,
  page,
  poCurrency,
  supplier,
  supplierLabel,
}: {
  companyLogoUrl: string | null;
  details: PurchaseOrderDocumentDetails;
  page: PurchaseOrderPage;
  poCurrency: string;
  supplier: PurchaseOrderDocumentSupplier;
  supplierLabel: string;
}) {
  const supplierName = supplier.displayName || supplierLabel || "Supplier";

  if (page.isFirstPage) {
    return (
      <DocumentHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
              {details.title || "PURCHASE ORDER"}
            </p>
            <h1 className="mt-1 text-[19px] font-semibold leading-tight text-zinc-950">{supplierName}</h1>
          </div>
          <div className="shrink-0 pt-1">
            <LogoBlock
              companyDisplayName={details.companyDisplayName}
              logoDisplayMode={details.logoDisplayMode}
              logoUrl={companyLogoUrl}
              showLogo={details.showLogo}
            />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-x-5 gap-y-2">
          <DocumentMetaList entries={[
            { label: "Client", value: details.clientDisplayName },
            { label: "Project", value: details.projectDisplayName },
            { label: "PO No", value: details.poNumber },
          ]} />
          <DocumentMetaList entries={[
            { label: "PO Date", value: formatDate(details.poDate) },
            { label: "Currency", value: poCurrency },
            { label: "Prepared By", value: details.preparedBy },
            { label: "TRN / VAT", value: details.trn },
          ]} />
          <DocumentMetaList entries={[
            { label: "Company", value: details.companyDisplayName },
            { label: "Phone", value: details.phone },
            { label: "Email", value: details.email },
          ]} />
        </div>
      </DocumentHeader>
    );
  }

  return null;
}

function ItemTable({
  columnVisibility,
  page,
  poCurrency,
}: {
  columnVisibility: PurchaseOrderColumnVisibility;
  page: PurchaseOrderPage;
  poCurrency: string;
}) {
  return (
    <table className="w-full border-collapse text-left text-[8px] text-zinc-700">
      <thead className="bg-zinc-50 text-[7px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        <tr>
          <th className="w-[6%] border-b border-zinc-200 px-2 py-2">S.No</th>
          {columnVisibility.image ? <th className="w-[11%] border-b border-zinc-200 px-2 py-2">Image</th> : null}
          <th className="border-b border-zinc-200 px-2 py-2">Description</th>
          {columnVisibility.finish ? <th className="w-[15%] border-b border-zinc-200 px-2 py-2">Finish</th> : null}
          <th className="w-[7%] border-b border-zinc-200 px-2 py-2 text-center">Qty</th>
          {columnVisibility.unitPrice ? <th className="w-[11%] border-b border-zinc-200 px-2 py-2 text-right">Unit Price</th> : null}
          {columnVisibility.lineTotal ? <th className="w-[11%] border-b border-zinc-200 px-2 py-2 text-right">Total</th> : null}
        </tr>
      </thead>
      <tbody>
        {page.items.map((item, index) => (
          <tr key={item.id} className={index % 2 === 0 ? "bg-white" : "bg-zinc-50/40"}>
            <td className="align-top border-b border-zinc-200 px-2 py-2 font-semibold text-zinc-900">{String(item.rowNumber).padStart(2, "0")}</td>
            {columnVisibility.image ? (
              <td className="align-top border-b border-zinc-200 px-2 py-2">
                <div className="h-12 w-12 overflow-hidden border border-zinc-200 bg-white">
                  <QuotationImageFrame
                    alt={item.description}
                    className="h-full w-full overflow-hidden"
                    emptyContent={<span className="flex h-full items-center justify-center px-1 text-center text-[8px] text-zinc-400">No image</span>}
                    imageUrl={item.imageUrl}
                  />
                </div>
              </td>
            ) : null}
            <td className="align-top border-b border-zinc-200 px-2 py-2">
              <p className="font-semibold text-zinc-900">{item.description}</p>
              {item.context ? <p className="mt-0.5 text-[7.5px] text-zinc-500">{item.context}</p> : null}
              {columnVisibility.code && item.code ? <p className="mt-0.5 text-[7.5px]"><span className="font-semibold text-zinc-900">Code:</span> {item.code}</p> : null}
              {columnVisibility.supplierPriceListCode && item.supplierPriceListCode ? <p className="text-[7.5px]"><span className="font-semibold text-zinc-900">Supplier Code:</span> {item.supplierPriceListCode}</p> : null}
              {columnVisibility.model && item.model ? <p className="text-[7.5px]"><span className="font-semibold text-zinc-900">Model:</span> {item.model}</p> : null}
              {columnVisibility.brandOrigin && item.brandOrigin ? <p className="text-[7.5px]"><span className="font-semibold text-zinc-900">Brand / Origin:</span> {item.brandOrigin}</p> : null}
              {item.specification ? <p className="mt-0.5 line-clamp-2 text-[7.5px] leading-3.5 text-zinc-600">{item.specification}</p> : null}
              {columnVisibility.remarks && item.remark ? <p className="mt-0.5 line-clamp-2 text-[7.5px] leading-3.5 text-zinc-600"><span className="font-semibold text-zinc-900">Remark:</span> {item.remark}</p> : null}
            </td>
            {columnVisibility.finish ? <td className="align-top border-b border-zinc-200 px-2 py-2 text-[7.5px] leading-3.5"><p className="line-clamp-4 whitespace-pre-wrap">{item.finish || "-"}</p></td> : null}
            <td className="align-top border-b border-zinc-200 px-2 py-2 text-center font-semibold text-zinc-900">{item.quantity}</td>
            {columnVisibility.unitPrice ? <td className="align-top border-b border-zinc-200 px-2 py-2 text-right">{formatPurchaseOrderMoney(poCurrency, item.unitPrice)}</td> : null}
            {columnVisibility.lineTotal ? <td className="align-top border-b border-zinc-200 px-2 py-2 text-right font-semibold text-zinc-900">{formatPurchaseOrderMoney(poCurrency, item.lineTotal)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClosingSections({
  closing,
  poCurrency,
}: {
  closing: PurchaseOrderClosingContent | null;
  poCurrency: string;
}) {
  if (!closing) {
    return null;
  }

  return (
    <div className="space-y-3">
      {(closing.supplier.contactPerson || closing.supplier.phone || closing.supplier.email || closing.supplier.address || closing.supplier.trn || closing.supplier.deliveryContact) ? (
        <section className="border-t border-zinc-200 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Supplier Details</p>
          <div className="mt-2 grid gap-x-8 gap-y-2 md:grid-cols-2">
            <DocumentMetaList entries={[
              { label: "Contact", value: closing.supplier.contactPerson },
              { label: "Phone", value: closing.supplier.phone },
              { label: "Email", value: closing.supplier.email },
            ]} />
            <DocumentMetaList entries={[
              { label: "Address", value: closing.supplier.address },
              { label: "TRN", value: closing.supplier.trn },
              { label: "Delivery Contact", value: closing.supplier.deliveryContact },
            ]} />
          </div>
        </section>
      ) : null}

      <section className="border-t border-zinc-200 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Terms / Notes</p>
        <div className="mt-2 grid gap-1.5 text-[11px] text-zinc-700">
          {closing.terms.deliveryLocation ? <p><span className="font-semibold text-zinc-900">Delivery Location:</span> {closing.terms.deliveryLocation}</p> : null}
          {closing.terms.deliveryDate ? <p><span className="font-semibold text-zinc-900">Delivery Date:</span> {formatDate(closing.terms.deliveryDate)}</p> : null}
          {closing.terms.paymentTerms ? <p><span className="font-semibold text-zinc-900">Payment Terms:</span> {closing.terms.paymentTerms}</p> : null}
          {closing.terms.warrantyNote ? <p><span className="font-semibold text-zinc-900">Warranty:</span> {closing.terms.warrantyNote}</p> : null}
          {closing.terms.installationNote ? <p><span className="font-semibold text-zinc-900">Installation:</span> {closing.terms.installationNote}</p> : null}
          {splitLines(closing.terms.generalNote).map((line, index) => (
            <p key={`po-term-${index}`}>{line}</p>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="border-t border-zinc-200 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Prepared By</p>
            <p className="mt-4 text-sm font-semibold text-zinc-900">{closing.preparedBy || "-"}</p>
          </div>
          <div className="border-t border-zinc-200 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Authorized Signature</p>
            <p className="mt-4 text-sm font-semibold text-zinc-900">{closing.terms.authorizedBy || "-"}</p>
            {closing.terms.authorizedDesignation ? <p className="mt-1 text-xs text-zinc-500">{closing.terms.authorizedDesignation}</p> : null}
          </div>
          <div className="border-t border-zinc-200 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Date</p>
            <p className="mt-4 text-sm font-semibold text-zinc-900">{formatDate(closing.poDate)}</p>
          </div>
        </div>
        <div className="border-t border-zinc-200 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Totals</p>
          <div className="mt-3 grid gap-2 text-sm text-zinc-700">
            <div className="flex items-center justify-between gap-4">
              <span>Subtotal</span>
              <span className="font-semibold text-zinc-900">{closing.hasPriceValues ? formatPurchaseOrderMoney(poCurrency, closing.subtotal) : "-"}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-2">
              <span className="font-semibold text-zinc-900">Grand Total</span>
              <span className="font-semibold text-zinc-900">{closing.hasPriceValues ? formatPurchaseOrderMoney(poCurrency, closing.subtotal) : "-"}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function PurchaseOrderDocument({
  companyLogoUrl,
  hasPriceValues,
  items,
  poCurrency,
  settings,
  subtotal,
  supplier,
  supplierLabel,
}: PurchaseOrderDocumentProps) {
  const pages = buildPurchaseOrderPages({
    closing: {
      hasPriceValues,
      poDate: settings.documentDetails.poDate,
      preparedBy: settings.documentDetails.preparedBy,
      subtotal,
      supplier,
      terms: settings.terms,
    },
    columnVisibility: settings.columnVisibility,
    items,
  });

  return (
    <>
      {pages.map((page) => (
        <DocumentPage key={`po-page-${page.pageIndex}-${page.isClosingPage ? "closing" : "items"}`}>
          <CompactHeader
            companyLogoUrl={companyLogoUrl}
            details={settings.documentDetails}
            page={page}
            poCurrency={poCurrency}
            supplier={supplier}
            supplierLabel={supplierLabel}
          />

          <div className="mt-3 flex-1 overflow-hidden">
            {page.isItemPage && page.items.length > 0 ? (
              <div className="space-y-3">
                <ItemTable
                  columnVisibility={settings.columnVisibility}
                  page={page}
                  poCurrency={poCurrency}
                />
                <ClosingSections closing={page.closing} poCurrency={poCurrency} />
              </div>
            ) : page.isItemPage ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">No visible items for the selected supplier / brand.</div>
            ) : (
              <ClosingSections closing={page.closing} poCurrency={poCurrency} />
            )}
          </div>

          <DocumentFooter pageNumber={page.pageIndex + 1} totalPages={page.totalPages} />
        </DocumentPage>
      ))}
    </>
  );
}
