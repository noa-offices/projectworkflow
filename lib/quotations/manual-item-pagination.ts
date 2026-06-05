import type { DocumentPrintSettings } from "@/lib/quotations/document-print-settings";

type ManualPaginationOptions<TItem, TPageItem> = {
  items: TItem[];
  print: DocumentPrintSettings;
  pageNumberOffset?: number;
  overflowBufferUnits?: number;
  getItemId: (item: TItem) => string;
  getSectionKey?: (item: TItem) => string | null;
  createPageItem: (item: TItem, index: number) => TPageItem;
  estimateItemUnits: (item: TPageItem) => number;
  getItemCapacity: (pageIndex: number) => number;
};

export function paginateDocumentItems<TItem, TPageItem>({
  items,
  print,
  pageNumberOffset = 0,
  overflowBufferUnits = 0,
  getItemId,
  getSectionKey,
  createPageItem,
  estimateItemUnits,
  getItemCapacity,
}: ManualPaginationOptions<TItem, TPageItem>) {
  type Entry = {
    itemId: string;
    sectionKey: string | null;
    index: number;
    pageItem: TPageItem;
    units: number;
  };

  const entries: Entry[] = items.map((item, index) => {
    const pageItem = createPageItem(item, index);
    return {
      itemId: getItemId(item),
      sectionKey: getSectionKey?.(item) ?? null,
      index,
      pageItem,
      units: estimateItemUnits(pageItem),
    };
  });

  if (print.pageFlowMode !== "manual") {
    const pages: TPageItem[][] = [];
    let current: TPageItem[] = [];
    let currentUnits = 0;
    let currentSectionKey: string | null = null;

    const pushCurrentPage = () => {
      if (current.length === 0) return;
      pages.push(current);
      current = [];
      currentUnits = 0;
      currentSectionKey = null;
    };

    entries.forEach((entry) => {
      const pageIndex = pageNumberOffset + pages.length;
      const maxUnits = getItemCapacity(pageIndex);
      const sectionBreak = print.startEachSectionOnNewPage
        && current.length > 0
        && entry.sectionKey !== null
        && currentSectionKey !== null
        && entry.sectionKey !== currentSectionKey;

      if (current.length > 0 && (sectionBreak || currentUnits + entry.units + overflowBufferUnits > maxUnits)) {
        pushCurrentPage();
      }

      current.push(entry.pageItem);
      currentSectionKey = entry.sectionKey;
      currentUnits += entry.units;
    });

    if (current.length > 0) {
      pages.push(current);
    }

    return pages;
  }

  const logicalGroups = new Map<number, Entry[]>();
  const logicalGroupUnits = new Map<number, number>();
  const autoEntries: Entry[] = [];

  const addToLogicalGroup = (pageNumber: number, entry: Entry) => {
    const group = logicalGroups.get(pageNumber);
    if (group) {
      group.push(entry);
    } else {
      logicalGroups.set(pageNumber, [entry]);
    }

    logicalGroupUnits.set(pageNumber, (logicalGroupUnits.get(pageNumber) ?? 0) + entry.units);
  };

  entries.forEach((entry) => {
    const assignedPage = print.pageAssignments[entry.itemId];
    if (assignedPage && assignedPage > 0) {
      addToLogicalGroup(assignedPage, entry);
      return;
    }

    autoEntries.push(entry);
  });

  autoEntries.forEach((entry) => {
    let targetPage = 1;

    while (true) {
      const targetPageIndex = pageNumberOffset + targetPage - 1;
      const targetCapacity = getItemCapacity(targetPageIndex);
      const usedUnits = logicalGroupUnits.get(targetPage) ?? 0;

      if (usedUnits === 0 || usedUnits + entry.units + overflowBufferUnits <= targetCapacity) {
        addToLogicalGroup(targetPage, entry);
        break;
      }

      targetPage += 1;
    }
  });

  const pages: TPageItem[][] = [];
  const renderedPageByItemId: Record<string, number> = {};
  const logicalPageNumbers = Array.from(logicalGroups.keys()).sort((left, right) => left - right);

  logicalPageNumbers.forEach((logicalPageNumber) => {
    const sortedEntries = (logicalGroups.get(logicalPageNumber) ?? [])
      .slice()
      .sort((left, right) => left.index - right.index);

    let current: TPageItem[] = [];
    let currentUnits = 0;
    let currentPhysicalPage = pageNumberOffset + pages.length + 1;
    let currentSectionKey: string | null = null;

    const pushCurrentPage = () => {
      if (current.length === 0) return;
      pages.push(current);
      current = [];
      currentUnits = 0;
      currentPhysicalPage = pageNumberOffset + pages.length + 1;
      currentSectionKey = null;
    };

    sortedEntries.forEach((entry) => {
      const pageIndex = pageNumberOffset + pages.length;
      const maxUnits = getItemCapacity(pageIndex);
      const forcedBreak = print.manualPageBreaks.includes(entry.itemId);
      const sectionBreak = print.startEachSectionOnNewPage
        && current.length > 0
        && entry.sectionKey !== null
        && currentSectionKey !== null
        && entry.sectionKey !== currentSectionKey;

      if (current.length > 0 && (forcedBreak || sectionBreak || currentUnits + entry.units + overflowBufferUnits > maxUnits)) {
        pushCurrentPage();
      }

      current.push(entry.pageItem);
      currentSectionKey = entry.sectionKey;
      currentUnits += entry.units;
      renderedPageByItemId[entry.itemId] = currentPhysicalPage;
    });

    pushCurrentPage();
  });

  if (process.env.NODE_ENV !== "production") {
    console.debug("[manual-page-groups]", entries.map((entry) => ({
      itemId: entry.itemId,
      selectedPage: print.pageAssignments[entry.itemId] ?? "auto",
      renderedPage: renderedPageByItemId[entry.itemId] ?? null,
    })));
  }

  return pages;
}
