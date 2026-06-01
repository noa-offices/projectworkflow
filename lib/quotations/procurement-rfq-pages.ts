import type { ProcurementRfqColumnVisibility, ProcurementRfqNotes } from "@/lib/quotations/procurement-rfq-settings";
import {
  DEFAULT_LANDSCAPE_PRINT_SETTINGS,
  type DocumentPrintSettings,
} from "@/lib/quotations/document-print-settings";
import { paginateDocumentItems } from "@/lib/quotations/manual-item-pagination";

export type ProcurementRfqDocumentItem = {
  id: string;
  description: string;
  context: string | null;
  code: string | null;
  supplierPriceListCode: string | null;
  model: string | null;
  brandOrigin: string | null;
  specification: string | null;
  size: string;
  finish: string;
  quantity: number;
  remark: string;
  imageUrl: string | null;
};

export type ProcurementRfqDocumentGroup = {
  key: string;
  label: string;
  type: string;
  supplier: {
    contactPerson: string;
    email: string;
    phone: string;
    address: string;
  };
  items: ProcurementRfqDocumentItem[];
};

export type ProcurementRfqPageItem = ProcurementRfqDocumentItem & {
  rowNumber: number;
};

export type ProcurementRfqPage = {
  pageIndex: number;
  totalPages: number;
  isFirstPage: boolean;
  isContinuationPage: boolean;
  isItemPage: boolean;
  isClosingPage: boolean;
  group: ProcurementRfqDocumentGroup;
  items: ProcurementRfqPageItem[];
  notes: ProcurementRfqNotes | null;
  showSupplierResponseFields: boolean;
};

const FIRST_PAGE_ITEM_CAPACITY = 34;
const CONTINUATION_ITEM_CAPACITY = 46;
const CLOSING_PAGE_CAPACITY = 30;

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

function estimateItemUnits(item: ProcurementRfqDocumentItem, columnVisibility: ProcurementRfqColumnVisibility) {
  const descriptionLines = estimateWrappedLines(item.description, columnVisibility.image ? 62 : 82, 4);
  const contextLines = item.context ? 1 : 0;
  const metadataLines = [
    columnVisibility.code && item.code ? 1 : 0,
    columnVisibility.supplierPriceListCode && item.supplierPriceListCode ? 1 : 0,
    columnVisibility.model && item.model ? 1 : 0,
    columnVisibility.brandOrigin && item.brandOrigin ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const specificationLines = columnVisibility.specification
    ? estimateWrappedLines(item.specification, columnVisibility.image ? 74 : 96, 3)
    : 0;
  const remarkLines = estimateWrappedLines(item.remark, columnVisibility.image ? 76 : 98, 2);
  const descriptionStack = descriptionLines + contextLines + metadataLines + specificationLines + remarkLines;
  const finishLines = columnVisibility.finish ? Math.min(Math.max(splitLines(item.finish).length, item.finish ? 1 : 0), 4) : 0;
  const sizeLines = columnVisibility.size ? estimateWrappedLines(item.size, 18, 2) : 0;
  const imageLines = columnVisibility.image ? 5 : 0;
  return Math.max(4, imageLines, descriptionStack + 1, finishLines + 1, sizeLines + 1);
}

function estimateClosingUnits(
  group: ProcurementRfqDocumentGroup,
  notes: ProcurementRfqNotes,
  showSupplierResponseFields: boolean,
) {
  const notesLines =
    splitLines(notes.generalNote).length
    + (notes.submissionDate ? 1 : 0)
    + (notes.deliveryLocation ? 1 : 0)
    + splitLines(notes.terms).length;
  const supplierLines = [
    group.supplier.contactPerson,
    group.supplier.email,
    group.supplier.phone,
    group.supplier.address,
  ].filter((value) => value.trim().length > 0).length;

  return (
    (showSupplierResponseFields ? 8 : 0)
    + (notesLines > 0 ? Math.max(7, notesLines + 3) : 0)
    + (supplierLines > 0 ? Math.max(5, supplierLines + 2) : 0)
  );
}

function chunkItems(
  items: ProcurementRfqDocumentItem[],
  columnVisibility: ProcurementRfqColumnVisibility,
  print: DocumentPrintSettings,
  startingPageIndex: number,
) {
  return paginateDocumentItems({
    items,
    print,
    pageNumberOffset: startingPageIndex,
    getItemId: (item) => item.id,
    createPageItem: (item, index) => ({ ...item, rowNumber: index + 1 }),
    estimateItemUnits: (item) => estimateItemUnits(item, columnVisibility),
    getItemCapacity: (pageIndex) => itemCapacity(pageIndex === 0 ? FIRST_PAGE_ITEM_CAPACITY : CONTINUATION_ITEM_CAPACITY, print),
  });
}

function hasClosingContent(notes: ProcurementRfqNotes, showSupplierResponseFields: boolean, group: ProcurementRfqDocumentGroup) {
  return showSupplierResponseFields
    || Boolean(notes.generalNote.trim() || notes.submissionDate.trim() || notes.deliveryLocation.trim() || notes.terms.trim())
    || Boolean(group.supplier.contactPerson || group.supplier.email || group.supplier.phone || group.supplier.address);
}

export function buildProcurementRfqPages({
  groups,
  notes,
  columnVisibility,
  print = DEFAULT_LANDSCAPE_PRINT_SETTINGS,
}: {
  groups: ProcurementRfqDocumentGroup[];
  notes: ProcurementRfqNotes;
  columnVisibility: ProcurementRfqColumnVisibility;
  print?: DocumentPrintSettings;
}) {
  const pages: Array<Omit<ProcurementRfqPage, "pageIndex" | "totalPages" | "isFirstPage" | "isContinuationPage">> = [];

  for (const group of groups) {
    const itemPages = chunkItems(group.items, columnVisibility, print, pages.length);
    itemPages.forEach((items) => {
      pages.push({
        group,
        isClosingPage: false,
        isItemPage: true,
        items,
        notes: null,
        showSupplierResponseFields: false,
      });
    });

    if (!hasClosingContent(notes, columnVisibility.supplierResponseFields, group)) {
      continue;
    }

    const closingUnits = estimateClosingUnits(group, notes, columnVisibility.supplierResponseFields);
      const lastPage = pages[pages.length - 1] ?? null;

    if (lastPage && lastPage.isItemPage) {
      const lastPageCapacity = itemCapacity(pages.length - 1 === 0 ? FIRST_PAGE_ITEM_CAPACITY : CONTINUATION_ITEM_CAPACITY, print);
      const usedUnits = lastPage.items.reduce((sum, item) => sum + estimateItemUnits(item, columnVisibility), 0);
      const remainingUnits = lastPageCapacity - usedUnits;

      if (remainingUnits >= closingUnits) {
        lastPage.notes = notes;
        lastPage.showSupplierResponseFields = columnVisibility.supplierResponseFields;
        continue;
      }
    }

    pages.push({
      group,
      isClosingPage: true,
      isItemPage: false,
      items: [],
      notes,
      showSupplierResponseFields: columnVisibility.supplierResponseFields,
    });
  }

  return pages.map((page, index) => {
    const totalPages = pages.length;
    const isFirstPage = index === 0;
    return {
      ...page,
      isContinuationPage: !isFirstPage,
      isFirstPage,
      pageIndex: index,
      totalPages,
    };
  }).filter((page) => {
    if (!page.isClosingPage) return true;
    return CLOSING_PAGE_CAPACITY > 0;
  });
}

