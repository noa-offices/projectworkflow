import type { PurchaseOrderColumnVisibility, PurchaseOrderTerms } from "@/lib/quotations/purchase-order-settings";
import {
  DEFAULT_LANDSCAPE_PRINT_SETTINGS,
  type DocumentPrintSettings,
} from "@/lib/quotations/document-print-settings";
import { paginateDocumentItems } from "@/lib/quotations/manual-item-pagination";

export type PurchaseOrderDocumentItem = {
  id: string;
  description: string;
  context: string | null;
  code: string | null;
  supplierPriceListCode: string | null;
  model: string | null;
  brandOrigin: string | null;
  specification: string | null;
  finish: string;
  quantity: number;
  remark: string;
  imageUrl: string | null;
  lineTotal: number | null;
  unitPrice: number | null;
  isOptional?: boolean;
  isRateOnly?: boolean;
  lineTotalLabel?: string | null;
};

export type PurchaseOrderDocumentSupplier = {
  address: string;
  contactPerson: string;
  deliveryContact: string;
  displayName: string;
  email: string;
  phone: string;
  trn: string;
};

export type PurchaseOrderClosingContent = {
  hasPriceValues: boolean;
  poDate: string;
  preparedBy: string;
  subtotal: number;
  supplier: PurchaseOrderDocumentSupplier;
  terms: PurchaseOrderTerms;
};

export type PurchaseOrderPageItem = PurchaseOrderDocumentItem & {
  rowNumber: number;
};

export type PurchaseOrderPage = {
  pageIndex: number;
  totalPages: number;
  isFirstPage: boolean;
  isContinuationPage: boolean;
  isItemPage: boolean;
  isClosingPage: boolean;
  items: PurchaseOrderPageItem[];
  closing: PurchaseOrderClosingContent | null;
};

const FIRST_PAGE_ITEM_CAPACITY = 33;
const CONTINUATION_ITEM_CAPACITY = 44;

function capacityMultiplier(settings: DocumentPrintSettings) {
  const densityMultiplier = settings.density === "comfortable" ? 0.84 : settings.density === "maxFit" ? 1.18 : 1;
  const orientationMultiplier = settings.orientation === "portrait" ? 0.72 : 1;
  return densityMultiplier * orientationMultiplier;
}

function itemCapacity(base: number, settings: DocumentPrintSettings) {
  return Math.max(8, Math.floor(base * capacityMultiplier(settings)));
}

function splitLines(value: string | null | undefined) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function estimateWrappedLines(value: string | null | undefined, charactersPerLine: number, maxLines: number) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  return Math.min(Math.ceil(normalized.length / charactersPerLine), maxLines);
}

function estimateItemUnits(item: PurchaseOrderDocumentItem, columnVisibility: PurchaseOrderColumnVisibility) {
  const descriptionLines = estimateWrappedLines(item.description, columnVisibility.image ? 60 : 78, 4);
  const contextLines = item.context ? 1 : 0;
  const metadataLines = [
    columnVisibility.code && item.code ? 1 : 0,
    columnVisibility.supplierPriceListCode && item.supplierPriceListCode ? 1 : 0,
    columnVisibility.model && item.model ? 1 : 0,
    columnVisibility.brandOrigin && item.brandOrigin ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const specificationLines = estimateWrappedLines(item.specification, columnVisibility.image ? 76 : 90, 2);
  const remarkLines = columnVisibility.remarks ? estimateWrappedLines(item.remark, 76, 2) : 0;
  const descriptionStack = descriptionLines + contextLines + metadataLines + specificationLines + remarkLines;
  const finishLines = columnVisibility.finish ? Math.min(Math.max(splitLines(item.finish).length, item.finish ? 1 : 0), 4) : 0;
  const imageLines = columnVisibility.image ? 5 : 0;
  return Math.max(4, imageLines, descriptionStack + 1, finishLines + 1);
}

function estimateClosingUnits(closing: PurchaseOrderClosingContent) {
  const supplierLines = [
    closing.supplier.contactPerson,
    closing.supplier.phone,
    closing.supplier.email,
    closing.supplier.address,
    closing.supplier.trn,
    closing.supplier.deliveryContact,
  ].filter((value) => value.trim().length > 0).length;
  const termLines =
    (closing.terms.deliveryLocation ? 1 : 0)
    + (closing.terms.deliveryDate ? 1 : 0)
    + (closing.terms.paymentTerms ? 1 : 0)
    + (closing.terms.warrantyNote ? 1 : 0)
    + (closing.terms.installationNote ? 1 : 0)
    + splitLines(closing.terms.generalNote).length;
  const signatureLines = 6;
  const totalsLines = closing.hasPriceValues ? 6 : 4;

  return Math.max(18, supplierLines + termLines + signatureLines + totalsLines);
}

function hasClosingContent(closing: PurchaseOrderClosingContent) {
  return Boolean(
    closing.supplier.contactPerson
    || closing.supplier.phone
    || closing.supplier.email
    || closing.supplier.address
    || closing.supplier.trn
    || closing.supplier.deliveryContact
    || closing.terms.deliveryLocation.trim()
    || closing.terms.deliveryDate.trim()
    || closing.terms.paymentTerms.trim()
    || closing.terms.warrantyNote.trim()
    || closing.terms.installationNote.trim()
    || closing.terms.generalNote.trim()
    || closing.terms.authorizedBy.trim()
    || closing.terms.authorizedDesignation.trim()
    || closing.hasPriceValues,
  );
}

export function buildPurchaseOrderPages({
  items,
  columnVisibility,
  closing,
  print = DEFAULT_LANDSCAPE_PRINT_SETTINGS,
}: {
  items: PurchaseOrderDocumentItem[];
  columnVisibility: PurchaseOrderColumnVisibility;
  closing: PurchaseOrderClosingContent;
  print?: DocumentPrintSettings;
}) {
  const pages: Array<Omit<PurchaseOrderPage, "pageIndex" | "totalPages" | "isFirstPage" | "isContinuationPage">> = [];
  const itemPages = paginateDocumentItems({
    items,
    print,
    getItemId: (item) => item.id,
    getSectionKey: (item) => item.context,
    createPageItem: (item, index) => ({ ...item, rowNumber: index + 1 }),
    estimateItemUnits: (item) => estimateItemUnits(item, columnVisibility),
    getItemCapacity: (pageIndex) => itemCapacity(pageIndex === 0 ? FIRST_PAGE_ITEM_CAPACITY : CONTINUATION_ITEM_CAPACITY, print),
  });

  itemPages.forEach((pageItems) => {
    pages.push({
      closing: null,
      isClosingPage: false,
      isItemPage: true,
      items: pageItems,
    });
  });

  if (pages.length === 0) {
    pages.push({
      closing: null,
      isClosingPage: false,
      isItemPage: true,
      items: [],
    });
  }

  if (hasClosingContent(closing)) {
    const lastPageIndex = pages.length - 1;
    const lastPage = pages[lastPageIndex];
    const lastPageCapacity = itemCapacity(lastPageIndex === 0 ? FIRST_PAGE_ITEM_CAPACITY : CONTINUATION_ITEM_CAPACITY, print);
    const usedUnits = lastPage.items.reduce((sum, item) => sum + estimateItemUnits(item, columnVisibility), 0);
    const remainingUnits = lastPageCapacity - usedUnits;

    if (remainingUnits >= estimateClosingUnits(closing)) {
      lastPage.closing = closing;
    } else {
      pages.push({
        closing,
        isClosingPage: true,
        isItemPage: false,
        items: [],
      });
    }
  }

  const visiblePages = pages.filter((page) => page.isClosingPage || page.items.length > 0);

  return visiblePages.map((page, index) => ({
    ...page,
    isContinuationPage: index > 0,
    isFirstPage: index === 0,
    pageIndex: index,
    totalPages: visiblePages.length,
  }));
}

