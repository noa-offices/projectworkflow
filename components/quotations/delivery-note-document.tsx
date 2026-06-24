import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import { DocumentFooter, DocumentHeader, DocumentMetaList, DocumentPage } from "@/components/quotations/document-page";
import type { DeliveryNoteSettings } from "@/lib/quotations/delivery-note-settings";

export type DeliveryNoteDocItem = {
  id: string;
  vendorKey: string;
  vendorLabel: string;
  rowNumber: number;
  description: string;
  code: string | null;
  brand: string | null;
  specification: string | null;
  size: string | null;
  finish: string | null;
  model: string | null;
  quantity: number;
  imageUrl: string | null;
};

type DeliveryNoteDocumentProps = {
  companyLogoUrl: string | null;
  companyProfile?: {
    companyName: string;
    phone: string | null;
    email: string | null;
    website: string | null;
  };
  items: DeliveryNoteDocItem[];
  settings: DeliveryNoteSettings;
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
  logoMode,
  logoUrl,
  showLogo,
}: {
  companyDisplayName: string;
  logoMode: DeliveryNoteSettings["logoMode"];
  logoUrl: string | null;
  showLogo: boolean;
}) {
  if (!showLogo || logoMode === "text_wordmark_fallback" || !logoUrl) {
    return (
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-900">
        {companyDisplayName || "Noa Offices"}
      </p>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={companyDisplayName || "Noa Offices"}
      className="max-h-9 max-w-[115px] w-auto object-contain"
    />
  );
}

function SignatureBlock({ companyName }: { companyName: string }) {
  return (
    <div className="mt-auto border-t border-zinc-200 pt-4">
      <div className="grid grid-cols-2 gap-0 divide-x divide-zinc-200">
        <div className="pr-6 space-y-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Delivered by</p>
          {companyName ? (
            <div>
              <p className="text-[8px] font-semibold text-zinc-600">Company</p>
              <p className="mt-0.5 text-[9px] font-semibold text-zinc-900">{companyName}</p>
            </div>
          ) : null}
          <SignatureLine label="Signature" />
          <SignatureLine label="Name" />
          <SignatureLine label="Date" />
        </div>
        <div className="pl-6 space-y-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Received by</p>
          <SignatureLine label="Company / Name" />
          <SignatureLine label="Signature" />
          <SignatureLine label="Date" />
          <SignatureLine label="Stamp" />
        </div>
      </div>
    </div>
  );
}

function SignatureLine({ label }: { label: string }) {
  return (
    <div>
      <p className="text-[8px] font-semibold text-zinc-500">{label}</p>
      <div className="mt-2 h-px border-b border-zinc-300 w-full" />
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────
// Heights in CSS px inside DocumentPage (277 mm usable area at 96 dpi ≈ 1047 px).
const CONTENT_HEIGHT_FIRST = 800; // first page: after header + mt-3 + footer
const CONTENT_HEIGHT_CONT  = 960; // continuation pages: after footer only
const SIGNATURE_HEIGHT     = 130; // signature block incl. border-t + content
const NOTES_OVERHEAD       =  28; // border + padding per notes section
const NOTES_LINE_PX        =  13; // px per text line in notes
const TABLE_HEADER_PX      =  26; // thead row height
const VENDOR_DIVIDER_PX    =  22; // vendor group divider row height

function estimateItemRowHeight(
  item: DeliveryNoteDocItem,
  col: DeliveryNoteSettings["columnVisibility"],
): number {
  if (col.image && item.imageUrl) return 62;
  let lines = 1;
  if (col.code && item.code) lines++;
  if (col.brand && item.brand) lines++;
  if (col.model && item.model) lines++;
  if (col.specification && item.specification) {
    lines += Math.min(2, Math.ceil(item.specification.length / 52));
  }
  return Math.max(24, lines * 11 + 14);
}

function notesBlockHeight(settings: DeliveryNoteSettings): number {
  const headerLines = settings.headerText.trim()
    ? settings.headerText.split(/\r?\n/).filter(Boolean).length
    : 0;
  const footerLines = settings.footerText.trim()
    ? settings.footerText.split(/\r?\n/).filter(Boolean).length
    : 0;
  const total = headerLines + footerLines;
  return total === 0 ? 0 : NOTES_OVERHEAD + total * NOTES_LINE_PX;
}

type DeliveryNotePage = {
  pageIndex: number;
  totalPages: number;
  items: DeliveryNoteDocItem[];
  prevVendorKey: string | null;
  showSignature: boolean;
};

function buildDeliveryNotePages(
  items: DeliveryNoteDocItem[],
  settings: DeliveryNoteSettings,
): DeliveryNotePage[] {
  const col = settings.columnVisibility;
  const closingHeight = notesBlockHeight(settings) + SIGNATURE_HEIGHT;

  const rawPages: { items: DeliveryNoteDocItem[]; prevVendorKey: string | null }[] = [];
  let batch: DeliveryNoteDocItem[] = [];
  let used = TABLE_HEADER_PX;
  let lastVendorKey: string | null = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const needsDivider =
      settings.scope === "all" && item.vendorKey !== (i === 0 ? null : items[i - 1].vendorKey);
    const rowH = estimateItemRowHeight(item, col) + (needsDivider ? VENDOR_DIVIDER_PX : 0);
    const capacity = rawPages.length === 0 ? CONTENT_HEIGHT_FIRST : CONTENT_HEIGHT_CONT;

    if (used + rowH > capacity && batch.length > 0) {
      rawPages.push({ items: batch, prevVendorKey: lastVendorKey });
      lastVendorKey = batch[batch.length - 1].vendorKey;
      batch = [];
      used = TABLE_HEADER_PX;
    }

    batch.push(item);
    used += rowH;
  }

  if (batch.length > 0) {
    rawPages.push({ items: batch, prevVendorKey: lastVendorKey });
  }

  if (rawPages.length === 0) {
    rawPages.push({ items: [], prevVendorKey: null });
  }

  const pages: { items: DeliveryNoteDocItem[]; prevVendorKey: string | null; showSignature: boolean }[] =
    rawPages.map((p) => ({ ...p, showSignature: false }));

  const lastRaw = rawPages[rawPages.length - 1];
  const lastCapacity = rawPages.length === 1 ? CONTENT_HEIGHT_FIRST : CONTENT_HEIGHT_CONT;
  const lastUsed =
    TABLE_HEADER_PX +
    lastRaw.items.reduce((sum, item, i) => {
      const prev = i === 0 ? lastRaw.prevVendorKey : (lastRaw.items[i - 1]?.vendorKey ?? null);
      const needsDivider = settings.scope === "all" && item.vendorKey !== prev;
      return sum + estimateItemRowHeight(item, col) + (needsDivider ? VENDOR_DIVIDER_PX : 0);
    }, 0);

  if (lastCapacity - lastUsed >= closingHeight) {
    pages[pages.length - 1].showSignature = true;
  } else {
    pages.push({ items: [], prevVendorKey: null, showSignature: true });
  }

  const totalPages = pages.length;
  return pages.map((p, index) => ({ ...p, pageIndex: index, totalPages }));
}

export function DeliveryNoteDocument({
  companyLogoUrl,
  companyProfile,
  items,
  settings,
}: DeliveryNoteDocumentProps) {
  const col = settings.columnVisibility;

  const totalColCount =
    1 +
    (col.image ? 1 : 0) +
    1 + // description always
    (col.size ? 1 : 0) +
    (col.finish ? 1 : 0) +
    1 + // qty always
    (col.condition ? 1 : 0);

  if (items.length === 0) {
    return (
      <DocumentPage orientation={settings.orientation}>
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          No items for the selected scope.
        </div>
      </DocumentPage>
    );
  }

  const metaEntries = [
    { label: "DN No.", value: settings.dnNumber },
    { label: "Date", value: formatDate(settings.dnDate) },
    { label: "Project", value: settings.projectDisplayName },
    { label: "Client", value: settings.clientDisplayName },
    { label: "Delivery Address", value: settings.deliveryAddress },
    { label: "Delivery Date", value: formatDate(settings.deliveryDate) },
    { label: "Driver", value: settings.driverName },
    { label: "Vehicle", value: settings.vehicleDetails },
  ];

  const pages = buildDeliveryNotePages(items, settings);

  return (
    <>
      {pages.map((page) => (
        <DocumentPage key={`dn-page-${page.pageIndex}`} orientation={settings.orientation}>
          {page.pageIndex === 0 ? (
            <DocumentHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
                    Delivery Note
                  </p>
                  <h1 className="mt-1 text-[19px] font-semibold leading-tight text-zinc-950">
                    {settings.dnNumber || "—"}
                  </h1>
                </div>
                <div className="shrink-0 pt-1">
                  <LogoBlock
                    companyDisplayName={companyProfile?.companyName ?? ""}
                    logoMode={settings.logoMode}
                    logoUrl={companyLogoUrl}
                    showLogo={settings.showLogo}
                  />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1">
                <DocumentMetaList entries={metaEntries.slice(0, 4)} />
                <DocumentMetaList entries={metaEntries.slice(4)} />
              </div>
            </DocumentHeader>
          ) : null}

          <div className={`${page.pageIndex === 0 ? "mt-3 " : ""}flex flex-1 flex-col overflow-hidden`}>
            {/* Header notes — first page only, before table */}
            {page.pageIndex === 0 && settings.headerText.trim() ? (
              <div className="mb-3 space-y-1 text-[8.5px] text-zinc-700">
                {splitLines(settings.headerText).map((line, i) => (
                  <p key={`dn-header-${i}`}>{line}</p>
                ))}
              </div>
            ) : null}

            {/* Items table */}
            {page.items.length > 0 ? (
              <table className="w-full border-collapse text-left text-[8px] text-zinc-700">
                <thead className="bg-zinc-50 text-[7px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  <tr>
                    <th className="w-[5%] border-b border-zinc-200 px-2 py-2">#</th>
                    {col.image ? <th className="w-[10%] border-b border-zinc-200 px-2 py-2">Image</th> : null}
                    <th className="border-b border-zinc-200 px-2 py-2">Description</th>
                    {col.size ? <th className="w-[10%] border-b border-zinc-200 px-2 py-2">Size</th> : null}
                    {col.finish ? <th className="w-[12%] border-b border-zinc-200 px-2 py-2">Finish</th> : null}
                    <th className="w-[7%] border-b border-zinc-200 px-2 py-2 text-center">Qty</th>
                    {col.condition ? <th className="w-[9%] border-b border-zinc-200 px-2 py-2">Condition</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((item, localIndex) => {
                    const prevVendorKey =
                      localIndex === 0
                        ? page.prevVendorKey
                        : (page.items[localIndex - 1]?.vendorKey ?? null);
                    const showVendorDivider =
                      settings.scope === "all" && item.vendorKey !== prevVendorKey;
                    return (
                      <ItemRow
                        key={item.id}
                        col={col}
                        index={localIndex}
                        item={item}
                        showVendorDivider={showVendorDivider}
                        totalColCount={totalColCount}
                      />
                    );
                  })}
                </tbody>
              </table>
            ) : null}

            {/* Footer notes — last page, before signature */}
            {page.showSignature && settings.footerText.trim() ? (
              <div className="mt-3 border-t border-zinc-200 pt-3 space-y-1 text-[8.5px] text-zinc-700">
                {splitLines(settings.footerText).map((line, i) => (
                  <p key={`dn-footer-${i}`}>{line}</p>
                ))}
              </div>
            ) : null}

            {/* Signature block pushed to bottom of last page */}
            {page.showSignature ? <SignatureBlock companyName={companyProfile?.companyName ?? ""} /> : null}
          </div>

          <DocumentFooter
            pageNumber={page.pageIndex + 1}
            totalPages={page.totalPages}
            companyName={companyProfile?.companyName ?? ""}
            companyContact={[companyProfile?.phone, companyProfile?.email].filter(Boolean).join(" | ") || null}
            companyWebsite={companyProfile?.website ?? null}
          />
        </DocumentPage>
      ))}
    </>
  );
}

function ItemRow({
  col,
  index,
  item,
  showVendorDivider,
  totalColCount,
}: {
  col: DeliveryNoteSettings["columnVisibility"];
  index: number;
  item: DeliveryNoteDocItem;
  showVendorDivider: boolean;
  totalColCount: number;
}) {
  return (
    <>
      {showVendorDivider ? (
        <tr>
          <td
            colSpan={totalColCount}
            className="bg-zinc-50 px-2 py-1.5 text-[7.5px] font-semibold uppercase tracking-[0.18em] text-zinc-500"
          >
            {item.vendorLabel}
          </td>
        </tr>
      ) : null}
      <tr className={index % 2 === 0 ? "bg-white" : "bg-zinc-50/40"}>
        <td className="align-top border-b border-zinc-200 px-2 py-2 font-semibold text-zinc-900">
          {String(item.rowNumber).padStart(2, "0")}
        </td>
        {col.image ? (
          <td className="align-top border-b border-zinc-200 px-2 py-2">
            <div className="h-12 w-12 overflow-hidden border border-zinc-200 bg-white">
              <QuotationImageFrame
                alt={item.description}
                className="h-full w-full overflow-hidden"
                emptyContent={
                  <span className="flex h-full items-center justify-center px-1 text-center text-[8px] text-zinc-400">
                    No image
                  </span>
                }
                imageUrl={item.imageUrl}
              />
            </div>
          </td>
        ) : null}
        <td className="align-top border-b border-zinc-200 px-2 py-2">
          <p className="font-semibold text-zinc-900">{item.description}</p>
          {col.code && item.code ? (
            <p className="mt-0.5 text-[7.5px]">
              <span className="font-semibold text-zinc-900">Code:</span> {item.code}
            </p>
          ) : null}
          {col.brand && item.brand ? (
            <p className="text-[7.5px]">
              <span className="font-semibold text-zinc-900">Brand / Origin:</span> {item.brand}
            </p>
          ) : null}
          {col.model && item.model ? (
            <p className="text-[7.5px]">
              <span className="font-semibold text-zinc-900">Model:</span> {item.model}
            </p>
          ) : null}
          {col.specification && item.specification ? (
            <p className="mt-0.5 line-clamp-2 text-[7.5px] leading-3.5 text-zinc-600">
              {item.specification}
            </p>
          ) : null}
        </td>
        {col.size ? (
          <td className="align-top border-b border-zinc-200 px-2 py-2 text-[7.5px] leading-3.5">
            {item.size || "—"}
          </td>
        ) : null}
        {col.finish ? (
          <td className="align-top border-b border-zinc-200 px-2 py-2 text-[7.5px] leading-3.5">
            <p className="line-clamp-4 whitespace-pre-wrap">{item.finish || "—"}</p>
          </td>
        ) : null}
        <td className="align-top border-b border-zinc-200 px-2 py-2 text-center font-semibold text-zinc-900">
          {item.quantity}
        </td>
        {col.condition ? (
          <td className="align-top border-b border-zinc-200 px-2 py-2 text-[7.5px]">New</td>
        ) : null}
      </tr>
    </>
  );
}
