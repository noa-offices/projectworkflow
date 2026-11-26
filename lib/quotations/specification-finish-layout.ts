// Splits the Specification finish cards into pages. Sizes are CSS px on the 794 x 1123 A4 sheet and must match
// the cards in app/quotations/[id]/specification/page.tsx. Pages are planned on the server, so text heights are
// estimates; the characters-per-line figures are deliberately low so a page is never over-filled.

export type FinishGroup<T> = { key: string; title: string; swatches: T[] };
export type FinishCardSegment<T> = FinishGroup<T> & { continued: boolean; total: number };

type SwatchText = { code: string | null; name: string | null };

const columns = 8;
const swatchHeight = 32;
const codeGap = 4;
const codeLineHeight = 13;
const nameLineHeight = 12;
const rowGap = 10;
const cardGap = 12;
const headerLineHeight = 14;
// Card border (2) + header padding (16) + header bottom border (1) + body padding (20).
const cardChrome = 39;
const moreLineHeight = 20;
// Space between the Materials heading and the footer, less the 16px that stays free above the footer.
const productCapacity = 478;
const continuationCapacity = 896;

function lineCount(text: string | null, perLine: number) {
  let lines = 0;
  let used = 0;
  for (const word of (text ?? "").split(/\s+/).filter(Boolean)) {
    // Capitals are wider than lower case.
    const width = word.length + (word.match(/[A-Z]/g)?.length ?? 0) * 0.25;
    if (lines && used + 1 + width <= perLine) {
      used += 1 + width;
      continue;
    }
    const wordLines = Math.max(1, Math.ceil(width / perLine));
    lines += wordLines;
    used = width - (wordLines - 1) * perLine;
  }
  return lines;
}

function rowHeight(row: SwatchText[]) {
  const text = Math.max(0, ...row.map((swatch) =>
    lineCount(swatch.code, 11) * codeLineHeight + lineCount(swatch.name, 13) * nameLineHeight));
  return swatchHeight + codeGap + text;
}

function rowsOf<T>(swatches: T[]) {
  return Array.from({ length: Math.ceil(swatches.length / columns) }, (_, index) => swatches.slice(index * columns, (index + 1) * columns));
}

function headerHeight(title: string) {
  return Math.max(1, Math.ceil((title.length + " (continued)".length) / 60)) * headerLineHeight;
}

function cardHeight(title: string, rows: SwatchText[][]) {
  return cardChrome + headerHeight(title) + rows.reduce((total, row) => total + rowHeight(row), 0) + rowGap * (rows.length - 1);
}

function cardsHeight(segments: FinishCardSegment<SwatchText>[]) {
  return segments.reduce((total, segment) => total + cardHeight(segment.title, rowsOf(segment.swatches)), 0)
    + cardGap * Math.max(0, segments.length - 1);
}

export const finishLayout = { columns, productCapacity, continuationCapacity, moreLineHeight, cardsHeight };

// Fills pages in order. A card breaks only between rows.
function paginate<T extends SwatchText>(groups: FinishGroup<T>[], firstCapacity: number, nextCapacity: number) {
  const pages: FinishCardSegment<T>[][] = [[]];
  let used = 0;
  for (const group of groups) {
    let rows = rowsOf(group.swatches);
    let continued = false;
    while (rows.length) {
      const page = pages[pages.length - 1];
      const capacity = pages.length === 1 ? firstCapacity : nextCapacity;
      const gap = page.length ? cardGap : 0;
      let count = 0;
      while (count < rows.length && used + gap + cardHeight(group.title, rows.slice(0, count + 1)) <= capacity) count += 1;
      // A single row taller than an empty continuation page is still placed, so the loop always ends.
      if (!count && !page.length && pages.length > 1) count = 1;
      if (!count) {
        pages.push([]);
        used = 0;
        continue;
      }
      page.push({ ...group, swatches: rows.slice(0, count).flat(), continued, total: group.swatches.length });
      used += gap + cardHeight(group.title, rows.slice(0, count));
      rows = rows.slice(count);
      continued = true;
    }
  }
  return pages;
}

export function planProductFinishes<T extends SwatchText>(
  groups: FinishGroup<T>[],
  { allowContinuation, descriptionContinues }: { allowContinuation: boolean; descriptionContinues: boolean },
) {
  const visible = groups.filter((group) => group.swatches.length);
  const empty: FinishCardSegment<T>[] = [];
  if (!visible.length) return { productPage: empty, continuationPages: [] as FinishCardSegment<T>[][], hiddenCount: 0 };
  // A long description already moves every finish to continuation pages.
  if (descriptionContinues) {
    return { productPage: empty, continuationPages: paginate(visible, continuationCapacity, continuationCapacity), hiddenCount: 0 };
  }

  const [first, ...rest] = paginate(visible, productCapacity, continuationCapacity);
  if (allowContinuation || !rest.length) return { productPage: first, continuationPages: rest, hiddenCount: 0 };

  // Continuation off: one page only, leaving room for the "+N more finishes" line.
  const [productPage] = paginate(visible, productCapacity - moreLineHeight, continuationCapacity);
  const shown = productPage.reduce((total, segment) => total + segment.swatches.length, 0);
  const all = visible.reduce((total, group) => total + group.swatches.length, 0);
  return { productPage, continuationPages: [] as FinishCardSegment<T>[][], hiddenCount: all - shown };
}
