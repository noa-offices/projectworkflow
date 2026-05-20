import type { OrderConfirmationColumnVisibility, OrderConfirmationTerms } from "@/lib/quotations/order-confirmation-settings";

export type OrderConfirmationDocumentItem = {
  id: string;
  itemNumber: string;
  title: string;
  description: string | null;
  dimensions: string;
  finish: string;
  quantity: number;
  note: string;
  imageUrl: string | null;
  code: string | null;
  model: string | null;
  brand: string | null;
  origin: string | null;
  specification: string | null;
  areaSection: string | null;
};

export type OrderConfirmationClosingContent = {
  terms: OrderConfirmationTerms;
};

export type OrderConfirmationPageItem = OrderConfirmationDocumentItem & {
  rowNumber: number;
};

export type OrderConfirmationPage = {
  pageIndex: number;
  totalPages: number;
  isFirstPage: boolean;
  isItemPage: boolean;
  isClosingPage: boolean;
  items: OrderConfirmationPageItem[];
  closing: OrderConfirmationClosingContent | null;
};

const FIRST_PAGE_ITEM_CAPACITY = 68;
const CONTINUATION_ITEM_CAPACITY = 78;
const PAGE_BREAK_BUFFER = 1;

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

function estimateItemUnits(item: OrderConfirmationDocumentItem, columnVisibility: OrderConfirmationColumnVisibility) {
  const titleLines = estimateWrappedLines(item.title, 56, 2);
  const descriptionLines = estimateWrappedLines(item.description, 86, 2);
  const specLines = columnVisibility.specification ? estimateWrappedLines(item.specification, 88, 2) : 0;
  const noteLines = estimateWrappedLines(item.note, 88, 2);
  const metadataEntryCount = [
    columnVisibility.code && item.code ? 1 : 0,
    columnVisibility.model && item.model ? 1 : 0,
    columnVisibility.brand && item.brand ? 1 : 0,
    columnVisibility.origin && item.origin ? 1 : 0,
    columnVisibility.dimensions && item.dimensions ? 1 : 0,
    columnVisibility.areaSection && item.areaSection ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const metadataLines = Math.ceil(metadataEntryCount / 2);
  const finishLines = columnVisibility.selectedFinishes && item.finish
    ? Math.min(Math.max(splitLines(item.finish).length, 1), 2)
    : 0;
  const quantityLines = columnVisibility.quantity ? 1 : 0;
  const textLines = titleLines + metadataLines + finishLines + quantityLines + descriptionLines + specLines + noteLines;
  const imageLines = columnVisibility.image ? 5 : 0;

  return Math.max(4, imageLines, textLines + 1);
}

function estimateClosingUnits(closing: OrderConfirmationClosingContent) {
  const textLines =
    splitLines(closing.terms.deliveryInstallationNote).length
    + splitLines(closing.terms.paymentTerms).length
    + splitLines(closing.terms.generalConfirmationNote).length
    + splitLines(closing.terms.approvalStatement).length;

  return Math.max(18, textLines + 10);
}

function hasClosingContent(closing: OrderConfirmationClosingContent) {
  return Boolean(
    closing.terms.deliveryInstallationNote.trim()
    || closing.terms.paymentTerms.trim()
    || closing.terms.generalConfirmationNote.trim()
    || closing.terms.approvalStatement.trim()
    || closing.terms.clientName.trim()
    || closing.terms.authorizedPerson.trim(),
  );
}

export function buildOrderConfirmationPages({
  items,
  columnVisibility,
  closing,
}: {
  items: OrderConfirmationDocumentItem[];
  columnVisibility: OrderConfirmationColumnVisibility;
  closing: OrderConfirmationClosingContent;
}) {
  const pages: Array<Omit<OrderConfirmationPage, "pageIndex" | "totalPages" | "isFirstPage">> = [];
  let current: OrderConfirmationPageItem[] = [];
  let currentUnits = 0;

  items.forEach((item, index) => {
    const pageIndex = pages.length;
    const maxUnits = pageIndex === 0 ? FIRST_PAGE_ITEM_CAPACITY : CONTINUATION_ITEM_CAPACITY;
    const pageItem = { ...item, rowNumber: index + 1 };
    const itemUnits = estimateItemUnits(pageItem, columnVisibility);

    const remainingUnits = maxUnits - currentUnits;
    const canFitCurrentPage = current.length === 0 || remainingUnits >= itemUnits + PAGE_BREAK_BUFFER;

    if (!canFitCurrentPage) {
      pages.push({
        closing: null,
        isClosingPage: false,
        isItemPage: true,
        items: current,
      });
      current = [];
      currentUnits = 0;
    }

    current.push(pageItem);
    currentUnits += itemUnits;
  });

  if (current.length > 0 || pages.length === 0) {
    pages.push({
      closing: null,
      isClosingPage: false,
      isItemPage: true,
      items: current,
    });
  }

  if (hasClosingContent(closing)) {
    const lastPageIndex = pages.length - 1;
    const lastPage = pages[lastPageIndex];
    const lastPageCapacity = lastPageIndex === 0 ? FIRST_PAGE_ITEM_CAPACITY : CONTINUATION_ITEM_CAPACITY;
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

  return pages.map((page, index) => ({
    ...page,
    isFirstPage: index === 0,
    pageIndex: index,
    totalPages: pages.length,
  }));
}
