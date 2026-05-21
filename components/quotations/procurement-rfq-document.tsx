import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import { DocumentFooter, DocumentHeader, DocumentMetaList, DocumentPage } from "@/components/quotations/document-page";
import { buildProcurementRfqPages, type ProcurementRfqDocumentGroup, type ProcurementRfqPage } from "@/lib/quotations/procurement-rfq-pages";
import type { ProcurementRfqColumnVisibility, ProcurementRfqDocumentDetails, ProcurementRfqNotes } from "@/lib/quotations/procurement-rfq-settings";

type ProcurementRfqDocumentProps = {
  companyLogoUrl: string | null;
  currentScopeLabel: string;
  defaultEmptyMessage?: string;
  groups: ProcurementRfqDocumentGroup[];
  notes: ProcurementRfqNotes;
  settings: {
    columnVisibility: ProcurementRfqColumnVisibility;
    documentDetails: ProcurementRfqDocumentDetails;
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

function LogoBlock({
  companyDisplayName,
  logoDisplayMode,
  logoUrl,
  showLogo,
}: {
  companyDisplayName: string;
  logoDisplayMode: ProcurementRfqDocumentDetails["logoDisplayMode"];
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
  currentScopeLabel,
  details,
  page,
}: {
  companyLogoUrl: string | null;
  currentScopeLabel: string;
  details: ProcurementRfqDocumentDetails;
  page: ProcurementRfqPage;
}) {
  if (page.isFirstPage) {
    return (
      <DocumentHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
              {details.title || "REQUEST FOR QUOTATION"}
            </p>
            <h1 className="mt-1 text-[19px] font-semibold leading-tight text-zinc-950">{page.group.label}</h1>
            <p className="mt-1 text-[8px] font-medium uppercase tracking-[0.14em] text-zinc-500">
              Supplier: {page.group.label} | Showing: {currentScopeLabel}
            </p>
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
            { label: "Prepared By", value: details.preparedBy },
            { label: "Phone", value: details.phone },
            { label: "Email", value: details.email },
          ]} />
          <DocumentMetaList entries={[
            { label: "Project", value: details.projectDisplayName },
            { label: "Project Contact", value: details.projectContact },
            { label: "PO Box", value: details.poBox },
          ]} />
          <DocumentMetaList entries={[
            { label: "RFQ No", value: details.rfqNumber },
            { label: "RFQ Date", value: formatDate(details.rfqDate) },
            { label: "Quotation Date", value: formatDate(details.quotationDate) },
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
}: {
  columnVisibility: ProcurementRfqColumnVisibility;
  page: ProcurementRfqPage;
}) {
  return (
    <table className="w-full border-collapse text-left text-[8px] text-zinc-700">
      <thead className="bg-zinc-50 text-[7px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        <tr>
          <th className="w-[6%] border-b border-zinc-200 px-2 py-2">SR</th>
          {columnVisibility.image ? <th className="w-[11%] border-b border-zinc-200 px-2 py-2">Image</th> : null}
          <th className="border-b border-zinc-200 px-2 py-2">Description</th>
          {columnVisibility.size ? <th className="w-[14%] border-b border-zinc-200 px-2 py-2">Size</th> : null}
          {columnVisibility.finish ? <th className="w-[14%] border-b border-zinc-200 px-2 py-2">Finish</th> : null}
          {columnVisibility.quantity ? <th className="w-[8%] border-b border-zinc-200 px-2 py-2 text-center">Total Qty</th> : null}
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
              {columnVisibility.specification && item.specification ? <p className="mt-0.5 line-clamp-3 text-[7.5px] leading-3.5 text-zinc-600">{item.specification}</p> : null}
              {item.remark ? <p className="mt-0.5 line-clamp-2 text-[7.5px] leading-3.5 text-zinc-600"><span className="font-semibold text-zinc-900">Supplier Note:</span> {item.remark}</p> : null}
            </td>
            {columnVisibility.size ? <td className="align-top border-b border-zinc-200 px-2 py-2 text-[7.5px] leading-3.5">{item.size || "-"}</td> : null}
            {columnVisibility.finish ? <td className="align-top border-b border-zinc-200 px-2 py-2 text-[7.5px] leading-3.5"><p className="line-clamp-4 whitespace-pre-wrap">{item.finish || "-"}</p></td> : null}
            {columnVisibility.quantity ? <td className="align-top border-b border-zinc-200 px-2 py-2 text-center font-semibold text-zinc-900">{item.quantity}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClosingSections({
  notes,
  page,
  showSupplierResponseFields,
}: {
  notes: ProcurementRfqNotes | null;
  page: ProcurementRfqPage;
  showSupplierResponseFields: boolean;
}) {
  const supplier = page.group.supplier;

  if (!notes && !showSupplierResponseFields && !supplier.contactPerson && !supplier.email && !supplier.phone && !supplier.address) {
    return null;
  }

  return (
    <div className="space-y-3">
      {showSupplierResponseFields ? (
        <section className="border-t border-zinc-200 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Supplier Response</p>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {["Supplier Price", "Lead Time", "Availability", "Remarks"].map((label) => (
              <div key={label}>
                <p className="text-[10px] font-semibold text-zinc-900">{label}</p>
                <div className="mt-2 h-6 border-b border-zinc-300" />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {notes ? (
        <section className="border-t border-zinc-200 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Notes / Terms</p>
          <div className="mt-2 grid gap-1.5 text-[11px] text-zinc-700">
            {splitLines(notes.generalNote).map((line, index) => (
              <p key={`${page.group.key}-note-${index}`}>{line}</p>
            ))}
            {notes.submissionDate ? <p><span className="font-semibold text-zinc-900">Required Submission Date:</span> {formatDate(notes.submissionDate)}</p> : null}
            {notes.deliveryLocation ? <p><span className="font-semibold text-zinc-900">Delivery Location:</span> {notes.deliveryLocation}</p> : null}
            {notes.terms ? <p className="whitespace-pre-wrap"><span className="font-semibold text-zinc-900">Terms / Remarks:</span> {notes.terms}</p> : null}
          </div>
        </section>
      ) : null}

      {(supplier.contactPerson || supplier.email || supplier.phone || supplier.address) ? (
        <section className="border-t border-zinc-200 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Supplier Details</p>
          <div className="mt-2 grid gap-x-8 gap-y-2 md:grid-cols-2">
            <DocumentMetaList entries={[
              { label: "Contact", value: supplier.contactPerson },
              { label: "Email", value: supplier.email },
            ]} />
            <DocumentMetaList entries={[
              { label: "Phone", value: supplier.phone },
              { label: "Address", value: supplier.address },
            ]} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ProcurementRfqDocument({
  companyLogoUrl,
  currentScopeLabel,
  defaultEmptyMessage = "No visible RFQ items for the selected supplier / brand scope.",
  groups,
  notes,
  settings,
}: ProcurementRfqDocumentProps) {
  if (groups.length === 0) {
    return (
      <DocumentPage>
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">{defaultEmptyMessage}</div>
      </DocumentPage>
    );
  }

  const pages = buildProcurementRfqPages({
    columnVisibility: settings.columnVisibility,
    groups,
    notes,
  });

  return (
    <>
      {pages.map((page) => (
        <DocumentPage key={`${page.group.key}-${page.pageIndex}-${page.isClosingPage ? "closing" : "items"}`}>
          <CompactHeader
            companyLogoUrl={companyLogoUrl}
            currentScopeLabel={currentScopeLabel}
            details={settings.documentDetails}
            page={page}
          />

          <div className="mt-3 flex-1 overflow-hidden">
            {page.isItemPage && page.items.length > 0 ? (
              <div className="space-y-3">
                <ItemTable columnVisibility={settings.columnVisibility} page={page} />
                <ClosingSections
                  notes={page.notes}
                  page={page}
                  showSupplierResponseFields={page.showSupplierResponseFields}
                />
              </div>
            ) : (
              <ClosingSections
                notes={page.notes}
                page={page}
                showSupplierResponseFields={page.showSupplierResponseFields}
              />
            )}
          </div>

          <DocumentFooter pageNumber={page.pageIndex + 1} totalPages={page.totalPages} />
        </DocumentPage>
      ))}
    </>
  );
}
