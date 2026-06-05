import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import PptxGenJS from "pptxgenjs";
import { FALLBACK_COMPANY_PROFILE } from "@/lib/company-profile";
import { formatBrandOriginSupplier, specificationWithoutDuplicateCode } from "@/lib/quotations/format-quotation-row";
import type {
  LoadedQuotationPresentationData,
  PresentationItem,
  PresentationQuotation,
  PresentationSection,
} from "@/lib/quotations/presentation-document";

type FinishEntry = {
  id: string;
  label: string;
  code: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
};

type DisplaySection = PresentationSection & {
  renderAsMainOnly?: boolean;
};

type PresentationSlide =
  | { type: "cover"; key: string }
  | { type: "design"; key: string }
  | { type: "main-area"; key: string; mainSection: PresentationSection }
  | { type: "section"; key: string; section: DisplaySection }
  | { type: "product"; key: string; section: DisplaySection; itemIds: string[] }
  | { type: "thank-you"; key: string };

type ProductPageData = {
  item: PresentationItem;
  heading: string;
  specification: string | null;
  imageUrl: string | null;
  imageFit: "contain" | "cover";
  meta: Array<{ label: string; value: string }>;
  compactMeta: Array<{ label: string; value: string }>;
  finishes: FinishEntry[];
  isOptional: boolean;
  isRateOnly: boolean;
};

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

const RECT_SHAPE: Parameters<PptxSlide["addShape"]>[0] = "rect";
const PPTX_LAYOUT_A4 = "A4_LANDSCAPE";
const SLIDE_W = 11.69;
const SLIDE_H = 8.27;
const PAGE_MARGIN = 0.55;
const FOOTER_Y = 7.5;

const COLOR_BG = "F4F6F8";
const COLOR_SURFACE = "FFFFFF";
const COLOR_PANEL = "F3F4F6";
const COLOR_TEXT = "111827";
const COLOR_MUTED = "5B6472";
const COLOR_LINE = "D7DCE3";
const COLOR_LIGHT_TEXT = "98A1AE";
const COLOR_LABEL = "6B7280";
const COLOR_ACCENT = "E9EDF2";
const COLOR_DARK = "111111";
const COLOR_WHITE = "FFFFFF";

const designConsiderations = [
  {
    title: "Ergonomics",
    body: "Support posture, comfort, and day-to-day productivity with people-first furniture planning.",
  },
  {
    title: "Space Optimization",
    body: "Balance circulation, storage, and collaboration zones so the layout feels efficient and open.",
  },
  {
    title: "Flexibility & Adaptability",
    body: "Favor solutions that can evolve with team growth, reconfiguration, and changing work styles.",
  },
  {
    title: "Aesthetics",
    body: "Create a consistent visual language with finishes, materials, and forms that fit the brand.",
  },
  {
    title: "Durability & Quality",
    body: "Prioritize commercial-grade performance, reliable details, and maintainable materials.",
  },
  {
    title: "Technology Integration",
    body: "Plan around power, connectivity, and cable management so work settings stay clean and usable.",
  },
  {
    title: "Sustainability",
    body: "Consider responsible material choices, long-life products, and efficient specification decisions.",
  },
  {
    title: "Cost Effectiveness",
    body: "Align visual impact and technical suitability with the project budget and lifecycle value.",
  },
] as const;

const defaultCoverText = {
  title: "Furniture Presentation",
  subtitle: "Curated furniture selections presented by area for review, alignment, and client approval.",
  preparedBy: "Noa Offices",
  website: "www.noaoffices.com",
} as const;

const defaultClosingText = {
  title: "Thank You",
  message: "Thank you for reviewing this furniture presentation. We look forward to supporting the next step of your project.",
  website: "www.noaoffices.com",
  email: "info@noaoffices.com",
  phone: "+971 4 380 9234",
  officeDetails: "Dubai / Abu Dhabi, United Arab Emirates",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return null;
}

function booleanFromRecord(record: Record<string, unknown>, key: string, fallback: boolean) {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function finishSelections(value: unknown) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function materialEntries(item: PresentationItem) {
  return finishSelections(item.finish_selections_snapshot)
    .filter((finish) => booleanFromRecord(finish, "show_in_specification", true));
}

function selectedFinishEntries(item: PresentationItem) {
  return materialEntries(item)
    .filter((finish) => stringFromRecord(finish, ["type"]) !== "material_group_chart");
}

function visibleFinishes(item: PresentationItem, finishImageUrlByItemAndFinishId: Record<string, string | null>) {
  const selectedFinishes = selectedFinishEntries(item)
    .map((finish, index): FinishEntry | null => {
      const id = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;
      const code = stringFromRecord(finish, ["finish_code"]);
      const name = stringFromRecord(finish, ["finish_name"]) || code || "";
      const label = stringFromRecord(finish, ["group_label"]) || "Other Finishes";
      const description = stringFromRecord(finish, ["finish_description"]);
      const imageUrl = finishImageUrlByItemAndFinishId[`${item.id}:${id}`] ?? null;

      if (!code && !name && !description && !imageUrl) return null;

      return {
        id,
        label,
        code,
        name,
        description,
        imageUrl,
      };
    })
    .filter((finish): finish is FinishEntry => Boolean(finish));

  if (selectedFinishes.length) return selectedFinishes;

  if (item.finish_snapshot?.trim()) {
    return [{
      id: `${item.id}-finish-snapshot`,
      label: "Finish",
      code: null,
      name: item.finish_snapshot.trim(),
      description: null,
      imageUrl: null,
    }];
  }

  return [];
}

function isPresentationItem(item: PresentationItem) {
  return !["heading", "note", "no_quote"].includes(item.line_style)
    && !["heading", "note", "blank", "subtotal"].includes(item.item_type);
}

function orderedPresentationSections(sections: PresentationSection[]) {
  return [...sections].sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
}

function orderedPresentationItems(items: PresentationItem[], sectionId: string | null) {
  return items
    .filter((item) => item.section_id === sectionId && item.is_active !== false)
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
}

function applyCustomOrder<T extends { id: string }>(entries: T[], orderedIds: string[]) {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry] as const));
  const usedIds = new Set<string>();
  const orderedEntries: T[] = [];

  orderedIds.forEach((id) => {
    const entry = entriesById.get(id);
    if (!entry || usedIds.has(id)) return;
    orderedEntries.push(entry);
    usedIds.add(id);
  });

  entries.forEach((entry) => {
    if (usedIds.has(entry.id)) return;
    orderedEntries.push(entry);
  });

  return orderedEntries;
}

function productTitle(item: PresentationItem) {
  return item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || "Quotation Item";
}

function detailRows(item: PresentationItem, contentVisibility: LoadedQuotationPresentationData["initialSettings"]["contentVisibility"]) {
  const originDisplay = formatBrandOriginSupplier({
    brandName: item.brand_name_snapshot,
    origin: item.origin_snapshot,
    supplier: item.supplier_name_snapshot,
  });

  return [
    contentVisibility.code ? { label: "Code", value: item.item_code_snapshot } : null,
    contentVisibility.model ? { label: "Model", value: item.model_snapshot } : null,
    contentVisibility.brand ? { label: "Brand", value: originDisplay.brand } : null,
    contentVisibility.origin ? { label: "Origin", value: originDisplay.origin } : null,
    contentVisibility.dimensions ? { label: "Dimensions", value: item.size_snapshot } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row?.value));
}

function compactMetaRows(item: PresentationItem) {
  const originDisplay = formatBrandOriginSupplier({
    brandName: item.brand_name_snapshot,
    origin: item.origin_snapshot,
    supplier: item.supplier_name_snapshot,
  });

  return [
    item.item_code_snapshot ? { label: "Code", value: item.item_code_snapshot } : null,
    originDisplay.brand ? { label: "Brand", value: originDisplay.brand } : null,
    originDisplay.origin ? { label: "Origin", value: originDisplay.origin } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row?.value));
}

function resolvedOverrideValue(value: string | null | undefined, fallback: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed) return trimmed;
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : null;
}

function buildOrderedPresentationHierarchy(
  sections: PresentationSection[],
  items: PresentationItem[],
  flowOrder: LoadedQuotationPresentationData["initialSettings"]["flowOrder"],
) {
  const orderedSectionRows = orderedPresentationSections(sections);
  const sectionsById = new Map(orderedSectionRows.map((section) => [section.id, section] as const));
  const childSectionsByMain = new Map<string, PresentationSection[]>();
  const orphanSections: PresentationSection[] = [];

  for (const section of orderedSectionRows) {
    if (section.section_kind !== "sub") continue;

    const parentSection = section.parent_section_id ? sectionsById.get(section.parent_section_id) ?? null : null;
    if (parentSection?.section_kind === "main" && section.parent_section_id) {
      childSectionsByMain.set(section.parent_section_id, [...(childSectionsByMain.get(section.parent_section_id) ?? []), section]);
      continue;
    }

    orphanSections.push(section);
  }

  const mainSections = applyCustomOrder(
    orderedSectionRows.filter((section) => section.section_kind === "main"),
    flowOrder.mainSectionKeys,
  );
  const sectionsByMainId = new Map(
    mainSections.map((section) => [
      section.id,
      applyCustomOrder(childSectionsByMain.get(section.id) ?? [], flowOrder.sectionKeysByMain[section.id] ?? []),
    ] as const),
  );
  const rows: DisplaySection[] = [];
  const childrenByParent = new Map<string, PresentationSection[]>();
  const allPresentableItemsBySection = new Map(
    orderedSectionRows.map((section) => [
      section.id,
      applyCustomOrder(
        orderedPresentationItems(items, section.id).filter(isPresentationItem),
        flowOrder.itemIdsBySection[section.id] ?? [],
      ),
    ] as const),
  );

  for (const section of mainSections) {
    const orderedChildren = sectionsByMainId.get(section.id) ?? [];
    childrenByParent.set(section.id, orderedChildren);
    rows.push({ ...section, renderAsMainOnly: true });
    orderedChildren.forEach((child) => rows.push(child));
  }

  orphanSections.forEach((section) => {
    rows.push(section);
  });

  return {
    allPresentableItemsBySection,
    childrenByParent,
    displaySections: rows,
    mainSections,
    sectionsById,
  };
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildPresentationSlides({
  dividerSections,
  productPagesBySection,
  settings,
}: {
  dividerSections: DisplaySection[];
  productPagesBySection: Map<string, PresentationItem[][]>;
  settings: LoadedQuotationPresentationData["initialSettings"];
}) {
  const slides: PresentationSlide[] = [];

  if (settings.pageVisibility.cover) {
    slides.push({ type: "cover", key: "cover" });
  }

  if (settings.pageVisibility.designConsiderations) {
    slides.push({ type: "design", key: "design-considerations" });
  }

  dividerSections.forEach((section) => {
    if (section.section_kind === "main" && settings.pageVisibility.mainLayoutPages) {
      slides.push({
        type: "main-area",
        key: `main-area:${section.id}`,
        mainSection: section,
      });
    }

    if (section.section_kind !== "main" && settings.pageVisibility.sectionDividers) {
      slides.push({
        type: "section",
        key: `section:${section.id}`,
        section,
      });
    }

    (productPagesBySection.get(section.id) ?? []).forEach((pageItems, pageIndex) => {
      if (!pageItems[0]) return;
      slides.push({
        type: "product",
        key: `product:${section.id}:${pageIndex + 1}`,
        section,
        itemIds: pageItems.map((item) => item.id),
      });
    });
  });

  if (settings.pageVisibility.thankYou) {
    slides.push({ type: "thank-you", key: "thank-you" });
  }

  return slides;
}

function trimText(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function safeLines(values: Array<string | null | undefined>) {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function mimeTypeForPath(value: string) {
  const extension = extname(value).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function imageDataUri(value: string | null, cache: Map<string, string | null>) {
  if (!value) return null;
  if (value.startsWith("data:")) return value;
  if (cache.has(value)) return cache.get(value) ?? null;

  try {
    let buffer: Buffer;
    let mimeType = mimeTypeForPath(value);

    if (value.startsWith("/")) {
      const localPath = join(process.cwd(), "public", value.replace(/^\//, ""));
      buffer = await readFile(localPath);
    } else if (/^https?:/i.test(value)) {
      const response = await fetch(value);
      if (!response.ok) {
        cache.set(value, null);
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      mimeType = response.headers.get("content-type")?.split(";")[0] || mimeType;
    } else {
      buffer = await readFile(value);
    }

    const result = `data:${mimeType};base64,${buffer.toString("base64")}`;
    cache.set(value, result);
    return result;
  } catch {
    cache.set(value, null);
    return null;
  }
}

async function addImageOrPlaceholder({
  slide,
  source,
  x,
  y,
  w,
  h,
  fit,
  label,
  cache,
  placeholderTitle = "Image unavailable",
  placeholderBody = null,
}: {
  slide: PptxSlide;
  source: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  fit: "contain" | "cover";
  label: string;
  cache: Map<string, string | null>;
  placeholderTitle?: string;
  placeholderBody?: string | null;
}) {
  slide.addShape(RECT_SHAPE, {
    x,
    y,
    w,
    h,
    line: { color: COLOR_LINE, pt: 1 },
    fill: { color: "FBFBFC" },
    rectRadius: 0.12,
  });

  const data = await imageDataUri(source, cache);
  if (data) {
    slide.addImage({
      data,
      x: x + 0.08,
      y: y + 0.08,
      w: w - 0.16,
      h: h - 0.16,
      sizing: { type: fit, w: w - 0.16, h: h - 0.16 },
      altText: label,
    });
    return;
  }

  slide.addText(placeholderTitle, {
    x: x + 0.25,
    y: y + (h / 2) - 0.15,
    w: w - 0.5,
    h: 0.12,
    align: "center",
    fontSize: 10,
    color: COLOR_LABEL,
    bold: true,
    margin: 0,
  });

  if (placeholderBody) {
    slide.addText(trimText(placeholderBody, 110) ?? placeholderBody, {
      x: x + 0.3,
      y: y + (h / 2) + 0.02,
      w: w - 0.6,
      h: 0.32,
      align: "center",
      fontSize: 9,
      color: COLOR_LIGHT_TEXT,
      margin: 0,
    });
  }
}

function sectionPresentationTitle(
  section: Pick<PresentationSection, "id" | "section_title">,
  settings: LoadedQuotationPresentationData["initialSettings"],
) {
  return settings.sectionOverrides[section.id]?.title?.trim() || section.section_title;
}

function sectionPresentationNote(
  section: Pick<PresentationSection, "id" | "section_notes">,
  settings: LoadedQuotationPresentationData["initialSettings"],
) {
  return settings.sectionOverrides[section.id]?.note?.trim() || section.section_notes || null;
}

function productPageData(
  item: PresentationItem,
  data: LoadedQuotationPresentationData,
  effectivePresentationImageUrlByItemId: Record<string, string | null>,
): ProductPageData {
  const itemOverride = data.initialSettings.itemOverrides[item.id];
  const imageFit = itemOverride?.imageFit === "cover" ? "cover" : "contain";

  return {
    item,
    heading: productTitle(item),
    isOptional: item.is_optional === true,
    isRateOnly: item.is_rate_only === true,
    specification: specificationWithoutDuplicateCode({
      code: item.item_code_snapshot,
      specification: item.specification_snapshot,
    }),
    imageUrl: effectivePresentationImageUrlByItemId[item.id] ?? null,
    imageFit,
    meta: detailRows(item, data.initialSettings.contentVisibility),
    compactMeta: compactMetaRows(item),
    finishes: data.initialSettings.contentVisibility.finishes
      ? visibleFinishes(item, data.finishImageUrlByItemAndFinishId)
      : [],
  };
}

function buildProductNumberById(sections: DisplaySection[], presentableItemsBySection: Map<string, PresentationItem[]>) {
  const orderedItems = sections.flatMap((section) => presentableItemsBySection.get(section.id) ?? []);
  return new Map(orderedItems.map((item, index) => [item.id, index + 1] as const));
}

function projectLabel(data: LoadedQuotationPresentationData) {
  return data.project?.project_name ?? data.quotation.title;
}

function addSlideBase(slide: PptxSlide, background = COLOR_SURFACE) {
  slide.background = { color: background };
}

function addSideBarDivider(slide: PptxSlide) {
  slide.addShape(RECT_SHAPE, {
    x: 0,
    y: 0,
    w: 0.7,
    h: SLIDE_H,
    line: { color: COLOR_DARK, pt: 0 },
    fill: { color: COLOR_DARK },
  });
  slide.addShape(RECT_SHAPE, {
    x: 0.7,
    y: 0,
    w: 0.02,
    h: SLIDE_H,
    line: { color: COLOR_ACCENT, pt: 0 },
    fill: { color: COLOR_ACCENT },
  });
}

function addSectionHeader(slide: PptxSlide, label: string, title: string, note?: string | null) {
  slide.addText(label.toUpperCase(), {
    x: 1.1,
    y: 0.62,
    w: 1.5,
    h: 0.12,
    fontSize: 10,
    bold: true,
    color: COLOR_LABEL,
    margin: 0,
  });
  slide.addShape(RECT_SHAPE, {
    x: 2.05,
    y: 0.69,
    w: 0.48,
    h: 0.02,
    line: { color: COLOR_ACCENT, pt: 0 },
    fill: { color: COLOR_ACCENT },
  });
  slide.addText(trimText(title, 78) ?? title, {
    x: 1.1,
    y: 1.02,
    w: 5.65,
    h: 0.7,
    fontSize: 27,
    color: COLOR_TEXT,
    margin: 0,
  });

  if (note) {
    slide.addText(trimText(note, 220) ?? note, {
      x: 1.1,
      y: 1.78,
      w: 4.95,
      h: 0.55,
      fontSize: 12.5,
      color: COLOR_MUTED,
      margin: 0,
    });
  }
}

function addProjectBadge(slide: PptxSlide, value: string) {
  slide.addShape(RECT_SHAPE, {
    x: 8.76,
    y: 7.12,
    w: 2.38,
    h: 0.34,
    line: { color: COLOR_LINE, pt: 1 },
    fill: { color: COLOR_SURFACE },
    rectRadius: 0.05,
  });
  slide.addText(trimText(value, 42) ?? value, {
    x: 8.9,
    y: 7.23,
    w: 2.1,
    h: 0.08,
    fontSize: 8.3,
    bold: true,
    color: COLOR_LABEL,
    align: "center",
    margin: 0,
  });
}

function addFooter(slide: PptxSlide, companyName: string, quotationNo: string | null) {
  slide.addShape(RECT_SHAPE, {
    x: PAGE_MARGIN,
    y: FOOTER_Y,
    w: SLIDE_W - (PAGE_MARGIN * 2),
    h: 0.02,
    line: { color: COLOR_ACCENT, pt: 0 },
    fill: { color: COLOR_ACCENT },
  });
  slide.addText(companyName, {
    x: PAGE_MARGIN,
    y: FOOTER_Y + 0.12,
    w: 2.8,
    h: 0.1,
    fontSize: 9,
    bold: true,
    color: COLOR_TEXT,
    margin: 0,
  });
  if (quotationNo) {
    slide.addText(quotationNo, {
      x: 8.54,
      y: FOOTER_Y + 0.12,
      w: 2.6,
      h: 0.1,
      fontSize: 9,
      bold: true,
      color: COLOR_TEXT,
      align: "right",
      margin: 0,
    });
  }
}

function addMetaCard(slide: PptxSlide, label: string, value: string, x: number, y: number, w: number) {
  slide.addShape(RECT_SHAPE, {
    x,
    y,
    w,
    h: 0.62,
    line: { color: COLOR_LINE, pt: 1 },
    fill: { color: COLOR_SURFACE },
    rectRadius: 0.05,
  });
  slide.addText(label.toUpperCase(), {
    x: x + 0.14,
    y: y + 0.11,
    w: w - 0.28,
    h: 0.08,
    fontSize: 7.2,
    bold: true,
    color: COLOR_LIGHT_TEXT,
    margin: 0,
  });
  slide.addText(trimText(value, 42) ?? value, {
    x: x + 0.14,
    y: y + 0.28,
    w: w - 0.28,
    h: 0.1,
    fontSize: 10.2,
    bold: true,
    color: COLOR_TEXT,
    margin: 0,
  });
}

function addMetaField(slide: PptxSlide, label: string, value: string, x: number, y: number, w: number) {
  slide.addText(label.toUpperCase(), {
    x,
    y,
    w,
    h: 0.08,
    fontSize: 7.2,
    bold: true,
    color: COLOR_LIGHT_TEXT,
    margin: 0,
  });
  slide.addText(trimText(value, 52) ?? value, {
    x,
    y: y + 0.15,
    w,
    h: 0.18,
    fontSize: 10,
    bold: true,
    color: COLOR_TEXT,
    margin: 0,
  });
}

async function addFinishChip(
  slide: PptxSlide,
  finish: FinishEntry,
  x: number,
  y: number,
  w: number,
  cache: Map<string, string | null>,
) {
  slide.addShape(RECT_SHAPE, {
    x,
    y,
    w,
    h: 0.58,
    line: { color: COLOR_LINE, pt: 1 },
    fill: { color: "FAFBFC" },
    rectRadius: 0.06,
  });

  const finishData = await imageDataUri(finish.imageUrl, cache);
  if (finishData) {
    slide.addImage({
      data: finishData,
      x: x + 0.08,
      y: y + 0.12,
      w: 0.3,
      h: 0.3,
      sizing: { type: "cover", w: 0.3, h: 0.3 },
      altText: finish.name || finish.label,
    });
  } else {
    slide.addShape(RECT_SHAPE, {
      x: x + 0.08,
      y: y + 0.12,
      w: 0.3,
      h: 0.3,
      line: { color: COLOR_LINE, pt: 1 },
      fill: { color: "E5E7EB" },
    });
  }

  slide.addText(trimText(finish.label, 18) ?? finish.label, {
    x: x + 0.45,
    y: y + 0.11,
    w: w - 0.53,
    h: 0.07,
    fontSize: 7,
    bold: true,
    color: COLOR_LABEL,
    margin: 0,
  });
  slide.addText(
    trimText([finish.code, finish.name].filter(Boolean).join(" | ") || finish.description || "Selected finish", 28) ?? "Selected finish",
    {
      x: x + 0.45,
      y: y + 0.25,
      w: w - 0.53,
      h: 0.12,
      fontSize: 8.5,
      bold: true,
      color: COLOR_TEXT,
      margin: 0,
    },
  );
}

export async function exportQuotationPresentationPptx(data: LoadedQuotationPresentationData) {
  const settings = data.initialSettings;
  const activeItems = data.items.filter((item) => item.is_active !== false);
  const hiddenItemIds = new Set(settings.hiddenItemIds);
  const itemsBySection = new Map<string, PresentationItem[]>();

  for (const item of activeItems) {
    const key = item.section_id ?? "unsectioned";
    itemsBySection.set(key, [...(itemsBySection.get(key) ?? []), item]);
  }

  const activeSections = [
    ...data.sections.filter((section) => section.is_active !== false),
    ...(itemsBySection.has("unsectioned")
      ? [{
          id: "unsectioned",
          section_title: "General Items",
          section_notes: null,
          parent_section_id: null,
          section_kind: "sub" as const,
          sort_order: 999999,
          is_active: true,
        }]
      : []),
  ];

  const {
    allPresentableItemsBySection,
    childrenByParent,
    displaySections,
    mainSections,
  } = buildOrderedPresentationHierarchy(activeSections, activeItems, settings.flowOrder);

  const presentableItemsBySection = new Map(
    activeSections.map((section) => [
      section.id,
      (allPresentableItemsBySection.get(section.id) ?? []).filter((item) => !hiddenItemIds.has(item.id)),
    ] as const),
  );

  const titledSectionsById = new Map(
    activeSections.map((section) => [section.id, sectionPresentationTitle(section, settings)] as const),
  );

  const mainSectionTitlesById = new Map(
    mainSections.map((section) => [
      section.id,
      resolvedOverrideValue(settings.mainSectionOverrides[section.id]?.title, section.section_title) ?? section.section_title,
    ] as const),
  );

  const coverTitle = resolvedOverrideValue(settings.coverOverrides.title, defaultCoverText.title);
  const coverSubtitle = resolvedOverrideValue(settings.coverOverrides.subtitle, defaultCoverText.subtitle);
  const coverProjectDisplayName = resolvedOverrideValue(settings.coverOverrides.projectDisplayName, data.project?.project_name ?? data.quotation.title);
  const coverClientDisplayName = resolvedOverrideValue(settings.coverOverrides.clientDisplayName, data.client?.company_name ?? null);
  const coverPreparedBy = resolvedOverrideValue(settings.coverOverrides.preparedBy, defaultCoverText.preparedBy);
  const coverWebsite = resolvedOverrideValue(settings.coverOverrides.website, defaultCoverText.website);
  const closingTitle = resolvedOverrideValue(settings.closingOverrides.title, defaultClosingText.title);
  const closingMessage = resolvedOverrideValue(settings.closingOverrides.message, defaultClosingText.message);
  const closingWebsite = resolvedOverrideValue(settings.closingOverrides.website, defaultClosingText.website);
  const closingEmail = resolvedOverrideValue(settings.closingOverrides.email, defaultClosingText.email);
  const closingPhone = resolvedOverrideValue(settings.closingOverrides.phone, defaultClosingText.phone);
  const closingOfficeDetails = resolvedOverrideValue(settings.closingOverrides.officeDetails, defaultClosingText.officeDetails);

  const sectionHasContent = (section: DisplaySection) => {
    if ((presentableItemsBySection.get(section.id) ?? []).length) return true;
    if (section.section_kind !== "main") return false;
    if (settings.mainSectionOverrides[section.id]?.title?.trim()) return true;
    if (settings.mainSectionOverrides[section.id]?.note?.trim()) return true;
    if (settings.mainSectionOverrides[section.id]?.layoutImageUrl?.trim()) return true;
    return (childrenByParent.get(section.id) ?? []).some((child) => (presentableItemsBySection.get(child.id) ?? []).length > 0);
  };

  const effectivePresentationImageUrlByItemId = { ...data.imageUrlByItemId };
  Object.entries(settings.itemOverrides).forEach(([itemId, override]) => {
    const resolvedOverride = data.presentationOverrideImageUrlByItemId[itemId] ?? null;
    if (override.imageUrl && resolvedOverride) {
      effectivePresentationImageUrlByItemId[itemId] = resolvedOverride;
    }
  });

  const dividerSections = displaySections.filter(sectionHasContent);
  const productPagesBySection = new Map(
    dividerSections.map((section) => {
      const sectionItems = presentableItemsBySection.get(section.id) ?? [];
      return [section.id, settings.layoutMode === "two_per_page" ? chunkItems(sectionItems, 2) : sectionItems.map((item) => [item])] as const;
    }),
  );

  const slides = buildPresentationSlides({
    dividerSections,
    productPagesBySection,
    settings,
  });
  const productNumberById = buildProductNumberById(dividerSections, presentableItemsBySection);

  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: PPTX_LAYOUT_A4,
    width: SLIDE_W,
    height: SLIDE_H,
  });
  pptx.layout = PPTX_LAYOUT_A4;
  pptx.author = data.companyProfile.displayName || FALLBACK_COMPANY_PROFILE.displayName;
  pptx.company = data.companyProfile.companyName || FALLBACK_COMPANY_PROFILE.companyName;
  pptx.subject = "Quotation Presentation";
  pptx.title = presentationTitle(data.quotation, coverTitle);

  const imageCache = new Map<string, string | null>();
  const currentProjectLabel = projectLabel(data);

  for (const slideDef of slides) {
    const slide = pptx.addSlide();

    if (slideDef.type === "cover") {
      addSlideBase(slide, "F7F8FA");
      slide.addShape(RECT_SHAPE, {
        x: 0,
        y: 0,
        w: SLIDE_W,
        h: SLIDE_H,
        line: { color: "F7F8FA", pt: 0 },
        fill: { color: "F7F8FA" },
      });
      slide.addShape(RECT_SHAPE, {
        x: 0,
        y: 0,
        w: 5.0,
        h: SLIDE_H,
        line: { color: "EEF2F5", pt: 0 },
        fill: { color: "EEF2F5", transparency: 22 },
      });
      slide.addShape(RECT_SHAPE, {
        x: 8.25,
        y: 0,
        w: 3.44,
        h: SLIDE_H,
        line: { color: COLOR_DARK, pt: 0 },
        fill: { color: COLOR_DARK },
      });
      slide.addText("CLIENT PRESENTATION", {
        x: 0.7,
        y: 0.7,
        w: 2.6,
        h: 0.1,
        fontSize: 10,
        bold: true,
        color: COLOR_LABEL,
        margin: 0,
      });
      slide.addShape(RECT_SHAPE, {
        x: 0.7,
        y: 0.88,
        w: 0.72,
        h: 0.02,
        line: { color: COLOR_ACCENT, pt: 0 },
        fill: { color: COLOR_ACCENT },
      });
      slide.addText(trimText(coverTitle, 90) ?? defaultCoverText.title, {
        x: 0.7,
        y: 1.24,
        w: 6.95,
        h: 1.05,
        fontSize: 27,
        color: COLOR_TEXT,
        margin: 0,
      });
      if (coverSubtitle) {
        slide.addText(trimText(coverSubtitle, 220) ?? coverSubtitle, {
          x: 0.7,
          y: 2.5,
          w: 5.9,
          h: 0.72,
          fontSize: 12.5,
          color: COLOR_MUTED,
          margin: 0,
        });
      }

      if (coverProjectDisplayName) {
        addMetaField(slide, "Project", coverProjectDisplayName, 0.7, 5.72, 3.3);
      }
      if (coverClientDisplayName) {
        addMetaField(slide, "Prepared For", coverClientDisplayName, 0.7, 6.34, 3.3);
      }
      if (coverPreparedBy) {
        addMetaField(slide, "Prepared By", coverPreparedBy, 4.15, 5.72, 1.7);
      }
      if (data.quotation.quotation_no) {
        addMetaCard(slide, "Project / Quote No.", data.quotation.quotation_no, 6.0, 5.88, 1.95);
      }
      if (data.quotation.quotation_date) {
        addMetaCard(slide, "Date", data.quotation.quotation_date, 6.0, 6.61, 1.95);
      }

      const logoData = await imageDataUri(data.companyProfile.logoUrl, imageCache);
      if (logoData) {
        slide.addImage({ data: logoData, x: 8.7, y: 0.78, w: 2.0, h: 0.58, sizing: { type: "contain", w: 2.0, h: 0.58 } });
      } else {
        slide.addText(data.companyProfile.displayName, {
          x: 8.7,
          y: 0.95,
          w: 2.2,
          h: 0.14,
          fontSize: 17,
          bold: true,
          color: COLOR_WHITE,
          margin: 0,
        });
      }
      slide.addText(trimText(coverPreparedBy, 34) ?? coverPreparedBy ?? data.companyProfile.displayName, {
        x: 8.7,
        y: 5.96,
        w: 2.2,
        h: 0.18,
        fontSize: 16,
        color: COLOR_WHITE,
        margin: 0,
      });
      if (coverWebsite) {
        slide.addText(coverWebsite, {
          x: 8.7,
          y: 6.34,
          w: 2.2,
          h: 0.12,
          fontSize: 10,
          color: "D7DCE3",
          margin: 0,
        });
      }
      slide.addText("Prepared presentation deck", {
        x: 8.7,
        y: 7.18,
        w: 2.2,
        h: 0.08,
        fontSize: 8.5,
        bold: true,
        color: "C7CDD6",
        margin: 0,
      });
      continue;
    }

    if (slideDef.type === "design") {
      addSlideBase(slide, "F7F8FA");
      slide.addShape(RECT_SHAPE, {
        x: 0,
        y: 0,
        w: 3.42,
        h: SLIDE_H,
        line: { color: "EEF2F5", pt: 0 },
        fill: { color: "EEF2F5" },
      });
      slide.addText("DESIGN CONSIDERATIONS", {
        x: 0.65,
        y: 0.72,
        w: 2.2,
        h: 0.1,
        fontSize: 10,
        bold: true,
        color: COLOR_LABEL,
        margin: 0,
      });
      slide.addText("Design", {
        x: 0.65,
        y: 1.14,
        w: 2.2,
        h: 0.28,
        fontSize: 24,
        color: COLOR_TEXT,
        margin: 0,
      });
      slide.addText("Considerations", {
        x: 0.65,
        y: 1.56,
        w: 2.4,
        h: 0.28,
        fontSize: 24,
        color: COLOR_MUTED,
        margin: 0,
      });
      slide.addShape(RECT_SHAPE, {
        x: 0.65,
        y: 2.16,
        w: 0.82,
        h: 0.02,
        line: { color: COLOR_LINE, pt: 0 },
        fill: { color: COLOR_LINE },
      });
      slide.addText(
        "Core principles reviewed when aligning furniture choices with workflow, brand expression, and long-term performance.",
        {
          x: 0.65,
          y: 5.88,
          w: 2.12,
          h: 0.8,
          fontSize: 11.5,
          color: COLOR_MUTED,
          margin: 0,
        },
      );
      slide.addText("Editorial overview", {
        x: 0.65,
        y: 7.14,
        w: 1.8,
        h: 0.08,
        fontSize: 8.5,
        bold: true,
        color: COLOR_LIGHT_TEXT,
        margin: 0,
      });

      designConsiderations.forEach((entry, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = 3.95 + (column * 3.58);
        const y = 0.95 + (row * 1.58);
        slide.addShape(RECT_SHAPE, {
          x,
          y,
          w: 3.03,
          h: 1.18,
          line: { color: COLOR_LINE, pt: 1 },
          fill: { color: COLOR_SURFACE },
        });
        slide.addText(String(index + 1).padStart(2, "0"), {
          x: x + 0.18,
          y: y + 0.16,
          w: 0.3,
          h: 0.08,
          fontSize: 8,
          bold: true,
          color: COLOR_LIGHT_TEXT,
          margin: 0,
        });
        slide.addText(entry.title.toUpperCase(), {
          x: x + 0.18,
          y: y + 0.34,
          w: 2.55,
          h: 0.1,
          fontSize: 9,
          bold: true,
          color: COLOR_TEXT,
          margin: 0,
        });
        slide.addText(trimText(entry.body, 115) ?? entry.body, {
          x: x + 0.18,
          y: y + 0.56,
          w: 2.55,
          h: 0.42,
          fontSize: 9.5,
          color: COLOR_MUTED,
          margin: 0,
        });
      });
      continue;
    }

    if (slideDef.type === "main-area") {
      addSlideBase(slide, COLOR_BG);
      addSideBarDivider(slide);

      const section = slideDef.mainSection;
      const title = mainSectionTitlesById.get(section.id) ?? section.section_title;
      const note = resolvedOverrideValue(settings.mainSectionOverrides[section.id]?.note, section.section_notes);
      const layoutSource = data.mainLayoutImageUrlById[section.id] ?? null;

      addSectionHeader(slide, "Main Area", title, note);

      if (layoutSource) {
        slide.addText("FULL FLOOR LAYOUT", {
          x: 1.1,
          y: 2.72,
          w: 2.3,
          h: 0.08,
          fontSize: 8.5,
          bold: true,
          color: COLOR_LABEL,
          margin: 0,
        });
        await addImageOrPlaceholder({
          slide,
          source: layoutSource,
          x: 1.1,
          y: 2.95,
          w: 9.6,
          h: 3.66,
          fit: "contain",
          label: `${title} layout`,
          cache: imageCache,
          placeholderTitle: "Layout image unavailable",
        });
      }

      slide.addText(`Main Area ${String(mainSections.findIndex((entry) => entry.id === section.id) + 1).padStart(2, "0")}`, {
        x: 1.1,
        y: 7.18,
        w: 1.8,
        h: 0.08,
        fontSize: 8.5,
        bold: true,
        color: COLOR_LIGHT_TEXT,
        margin: 0,
      });
      addProjectBadge(slide, currentProjectLabel);
      continue;
    }

    if (slideDef.type === "section") {
      addSlideBase(slide, COLOR_BG);
      addSideBarDivider(slide);

      const section = slideDef.section;
      const title = titledSectionsById.get(section.id) ?? section.section_title;
      const note = sectionPresentationNote(section, settings);
      const mainSection = section.parent_section_id ? displaySections.find((entry) => entry.id === section.parent_section_id) ?? null : null;
      const areaImage = data.sectionOverrideImageUrlBySectionAndField[`${section.id}:areaImageUrl`] ?? null;
      const layoutImage = data.sectionOverrideImageUrlBySectionAndField[`${section.id}:sectionLayoutImageUrl`] ?? null;
      const visuals = [
        areaImage ? { label: "Area Image", source: areaImage } : null,
        layoutImage ? { label: "Section Layout Snapshot", source: layoutImage } : null,
      ].filter((entry): entry is { label: string; source: string } => Boolean(entry));
      const pageCount = productPagesBySection.get(section.id)?.length ?? 0;

      addSectionHeader(slide, "Area", title, note);

      if (visuals.length === 1) {
        slide.addText(visuals[0].label.toUpperCase(), {
          x: 1.1,
          y: 2.72,
          w: 2.3,
          h: 0.08,
          fontSize: 8.5,
          bold: true,
          color: COLOR_LABEL,
          margin: 0,
        });
        await addImageOrPlaceholder({
          slide,
          source: visuals[0].source,
          x: 1.1,
          y: 2.95,
          w: 9.6,
          h: 3.66,
          fit: "contain",
          label: `${title} ${visuals[0].label}`,
          cache: imageCache,
        });
      } else if (visuals.length === 2) {
        for (const [index, visual] of visuals.entries()) {
          const x = index === 0 ? 1.1 : 6.05;
          slide.addText(visual.label.toUpperCase(), {
            x,
            y: 2.72,
            w: 2.3,
            h: 0.08,
            fontSize: 8.5,
            bold: true,
            color: COLOR_LABEL,
            margin: 0,
          });
          await addImageOrPlaceholder({
            slide,
            source: visual.source,
            x,
            y: 2.95,
            w: 4.65,
            h: 3.66,
            fit: "contain",
            label: `${title} ${visual.label}`,
            cache: imageCache,
          });
        }
      }

      if (mainSection) {
        slide.addText(`Within ${mainSectionTitlesById.get(mainSection.id) ?? mainSection.section_title}`, {
          x: 1.1,
          y: 7.18,
          w: 2.8,
          h: 0.08,
          fontSize: 8.5,
          bold: true,
          color: COLOR_LIGHT_TEXT,
          margin: 0,
        });
      }
      if (pageCount) {
        slide.addText(`${pageCount} product ${pageCount === 1 ? "page" : "pages"} follow`, {
          x: 4.22,
          y: 7.18,
          w: 2.2,
          h: 0.08,
          fontSize: 8.5,
          color: COLOR_LABEL,
          align: "center",
          margin: 0,
        });
      }
      addProjectBadge(slide, currentProjectLabel);
      continue;
    }

    if (slideDef.type === "product") {
      addSlideBase(slide, COLOR_SURFACE);

      const section = slideDef.section;
      const sectionTitle = titledSectionsById.get(section.id) ?? section.section_title;
      const pageItems = slideDef.itemIds
        .map((itemId) => (presentableItemsBySection.get(section.id) ?? []).find((item) => item.id === itemId) ?? null)
        .filter((item): item is PresentationItem => Boolean(item));

      if (settings.layoutMode === "two_per_page") {
        slide.addText(sectionTitle.toUpperCase(), {
          x: PAGE_MARGIN,
          y: 0.45,
          w: 2.8,
          h: 0.08,
          fontSize: 8.5,
          bold: true,
          color: COLOR_LIGHT_TEXT,
          margin: 0,
        });
        slide.addText(pageItems.length === 2 ? "Selected Products" : "Selected Product", {
          x: PAGE_MARGIN,
          y: 0.72,
          w: 4.1,
          h: 0.24,
          fontSize: 18,
          color: COLOR_TEXT,
          margin: 0,
        });

        for (const [index, item] of pageItems.entries()) {
          const dataForItem = productPageData(item, data, effectivePresentationImageUrlByItemId);
          const cardX = index === 0 ? 0.55 : 6.07;
          const cardY = 1.25;
          const cardW = 5.07;

          slide.addShape(RECT_SHAPE, {
            x: cardX,
            y: cardY,
            w: cardW,
            h: 5.7,
            line: { color: COLOR_LINE, pt: 1 },
            fill: { color: COLOR_SURFACE },
          });
          slide.addText(trimText(dataForItem.heading, 54) ?? dataForItem.heading, {
            x: cardX + 0.22,
            y: cardY + 0.22,
            w: 3.82,
            h: 0.22,
            fontSize: 14.5,
            color: COLOR_TEXT,
            margin: 0,
          });
          if (dataForItem.isOptional) {
            slide.addText("OPTIONAL", {
              x: cardX + 0.22,
              y: cardY + 0.5,
              w: 0.82,
              h: 0.14,
              fontSize: 7,
              bold: true,
              color: "B91C1C",
              margin: 0,
            });
          }
          if (dataForItem.isRateOnly) {
            slide.addText("RATE ONLY", {
              x: cardX + (dataForItem.isOptional ? 1.02 : 0.22),
              y: cardY + 0.5,
              w: 0.86,
              h: 0.14,
              fontSize: 7,
              bold: true,
              color: "0369A1",
              margin: 0,
            });
          }
          slide.addShape(RECT_SHAPE, {
            x: cardX + 4.03,
            y: cardY + 0.16,
            w: 0.65,
            h: 0.28,
            line: { color: COLOR_LINE, pt: 1 },
            fill: { color: "FAFBFC" },
            rectRadius: 0.05,
          });
          slide.addText(`Item ${String(productNumberById.get(item.id) ?? index + 1).padStart(2, "0")}`, {
            x: cardX + 4.08,
            y: cardY + 0.24,
            w: 0.55,
            h: 0.08,
            fontSize: 7,
            bold: true,
            color: COLOR_LABEL,
            align: "center",
            margin: 0,
          });
          await addImageOrPlaceholder({
            slide,
            source: dataForItem.imageUrl,
            x: cardX + 0.22,
            y: cardY + 0.75,
            w: 4.63,
            h: 3.56,
            fit: dataForItem.imageFit,
            label: dataForItem.heading,
            cache: imageCache,
            placeholderTitle: "Product image unavailable",
          });

          const metaRows = dataForItem.compactMeta.length
            ? dataForItem.compactMeta.slice(0, 3)
            : (item.item_code_snapshot ? [{ label: "Code", value: item.item_code_snapshot }] : []);

          metaRows.forEach((row, metaIndex) => {
            const x = cardX + 0.22 + (metaIndex * 1.53);
            slide.addText(row.label.toUpperCase(), {
              x,
              y: cardY + 4.6,
              w: 1.35,
              h: 0.07,
              fontSize: 7,
              bold: true,
              color: COLOR_LIGHT_TEXT,
              margin: 0,
            });
            slide.addText(trimText(row.value, 26) ?? row.value, {
              x,
              y: cardY + 4.76,
              w: 1.35,
              h: 0.18,
              fontSize: 8.8,
              bold: true,
              color: COLOR_TEXT,
              margin: 0,
            });
          });
        }

        addFooter(slide, data.companyProfile.displayName, data.quotation.quotation_no);
        continue;
      }

      const item = pageItems[0];
      if (!item) continue;
      const dataForItem = productPageData(item, data, effectivePresentationImageUrlByItemId);

      slide.addText(sectionTitle.toUpperCase(), {
        x: PAGE_MARGIN,
        y: 0.45,
        w: 2.8,
        h: 0.08,
        fontSize: 8.5,
        bold: true,
        color: COLOR_LIGHT_TEXT,
        margin: 0,
      });
      slide.addText(trimText(dataForItem.heading, 72) ?? dataForItem.heading, {
        x: PAGE_MARGIN,
        y: 0.72,
        w: 5.75,
        h: 0.28,
        fontSize: 20,
        color: COLOR_TEXT,
        margin: 0,
      });
      if (dataForItem.isOptional) {
        slide.addText("OPTIONAL", {
          x: PAGE_MARGIN,
          y: 1.04,
          w: 0.9,
          h: 0.14,
          fontSize: 7.5,
          bold: true,
          color: "B91C1C",
          margin: 0,
        });
      }
      if (dataForItem.isRateOnly) {
        slide.addText("RATE ONLY", {
          x: PAGE_MARGIN + (dataForItem.isOptional ? 0.92 : 0),
          y: 1.04,
          w: 0.92,
          h: 0.14,
          fontSize: 7.5,
          bold: true,
          color: "0369A1",
          margin: 0,
        });
      }
      slide.addShape(RECT_SHAPE, {
        x: 5.85,
        y: 0.42,
        w: 0.86,
        h: 0.34,
        line: { color: COLOR_LINE, pt: 1 },
        fill: { color: "FAFBFC" },
        rectRadius: 0.05,
      });
      slide.addText(`Item ${String(productNumberById.get(item.id) ?? 1).padStart(2, "0")}`, {
        x: 5.94,
        y: 0.53,
        w: 0.68,
        h: 0.08,
        fontSize: 7,
        bold: true,
        color: COLOR_LABEL,
        align: "center",
        margin: 0,
      });

      await addImageOrPlaceholder({
        slide,
        source: dataForItem.imageUrl,
        x: 0.55,
        y: 1.3,
        w: 6.2,
        h: 5.8,
        fit: dataForItem.imageFit,
        label: dataForItem.heading,
        cache: imageCache,
        placeholderTitle: "Product image unavailable",
        placeholderBody: trimText(dataForItem.heading, 48),
      });

      slide.addShape(RECT_SHAPE, {
        x: 7.0,
        y: 0.4,
        w: 4.14,
        h: 6.72,
        line: { color: "EEF1F5", pt: 0 },
        fill: { color: COLOR_PANEL },
      });
      slide.addText("TECHNICAL DETAILS", {
        x: 7.28,
        y: 0.68,
        w: 2.2,
        h: 0.08,
        fontSize: 8.5,
        bold: true,
        color: COLOR_LABEL,
        margin: 0,
      });
      slide.addText(trimText(dataForItem.heading, 64) ?? dataForItem.heading, {
        x: 7.28,
        y: 0.95,
        w: 3.45,
        h: 0.42,
        fontSize: 18,
        color: COLOR_TEXT,
        margin: 0,
      });
      if (dataForItem.isOptional) {
        slide.addText("OPTIONAL", {
          x: 7.28,
          y: 1.42,
          w: 0.9,
          h: 0.14,
          fontSize: 7.5,
          bold: true,
          color: "B91C1C",
          margin: 0,
        });
      }
      if (dataForItem.isRateOnly) {
        slide.addText("RATE ONLY", {
          x: 7.28 + (dataForItem.isOptional ? 0.92 : 0),
          y: 1.42,
          w: 0.92,
          h: 0.14,
          fontSize: 7.5,
          bold: true,
          color: "0369A1",
          margin: 0,
        });
      }

      let detailsCursor = dataForItem.isOptional || dataForItem.isRateOnly ? 1.88 : 1.75;
      if (settings.contentVisibility.specification && dataForItem.specification) {
        slide.addText(trimText(dataForItem.specification, 320) ?? dataForItem.specification, {
          x: 7.28,
          y: detailsCursor,
          w: 3.35,
          h: 1.1,
          fontSize: 10.3,
          color: COLOR_MUTED,
          margin: 0,
          valign: "top",
        });
        detailsCursor += 1.28;
      }

      const detailRowsToRender = dataForItem.meta.slice(0, 6);
      detailRowsToRender.forEach((row, index) => {
        const column = index % 2;
        const rowIndex = Math.floor(index / 2);
        const x = 7.28 + (column * 1.7);
        const y = detailsCursor + (rowIndex * 0.62);
        slide.addText(row.label.toUpperCase(), {
          x,
          y,
          w: 1.48,
          h: 0.07,
          fontSize: 7,
          bold: true,
          color: COLOR_LIGHT_TEXT,
          margin: 0,
        });
        slide.addText(trimText(row.value, 28) ?? row.value, {
          x,
          y: y + 0.15,
          w: 1.48,
          h: 0.16,
          fontSize: 8.8,
          bold: true,
          color: COLOR_TEXT,
          margin: 0,
        });
      });
      detailsCursor += Math.ceil(detailRowsToRender.length / 2) * 0.62;

      if (dataForItem.finishes.length) {
        slide.addText("FINISHES", {
          x: 7.28,
          y: Math.min(detailsCursor + 0.18, 5.35),
          w: 1.2,
          h: 0.07,
          fontSize: 7,
          bold: true,
          color: COLOR_LIGHT_TEXT,
          margin: 0,
        });

        const visibleFinishesToRender = dataForItem.finishes.slice(0, 4);
        for (const [finishIndex, finish] of visibleFinishesToRender.entries()) {
          const column = finishIndex % 2;
          const row = Math.floor(finishIndex / 2);
          const finishX = 7.28 + (column * 1.72);
          const finishY = Math.min(detailsCursor + 0.38 + (row * 0.7), 5.62 + (row * 0.7));
          await addFinishChip(slide, finish, finishX, finishY, 1.52, imageCache);
        }

        if (dataForItem.finishes.length > 4) {
          slide.addText(`+${dataForItem.finishes.length - 4} more`, {
            x: 9.95,
            y: 6.84,
            w: 0.7,
            h: 0.07,
            fontSize: 7,
            bold: true,
            color: COLOR_LIGHT_TEXT,
            align: "right",
            margin: 0,
          });
        }
      }

      addFooter(slide, data.companyProfile.displayName, data.quotation.quotation_no);
      continue;
    }

    if (slideDef.type === "thank-you") {
      addSlideBase(slide, "F7F8FA");
      slide.addShape(RECT_SHAPE, {
        x: 8.1,
        y: 0,
        w: 3.59,
        h: SLIDE_H,
        line: { color: COLOR_DARK, pt: 0 },
        fill: { color: COLOR_DARK },
      });
      slide.addText("THANK YOU", {
        x: 0.75,
        y: 0.82,
        w: 2.2,
        h: 0.1,
        fontSize: 10,
        bold: true,
        color: COLOR_LABEL,
        margin: 0,
      });
      slide.addShape(RECT_SHAPE, {
        x: 0.75,
        y: 1.02,
        w: 0.72,
        h: 0.02,
        line: { color: COLOR_ACCENT, pt: 0 },
        fill: { color: COLOR_ACCENT },
      });
      slide.addText(trimText(closingTitle, 80) ?? defaultClosingText.title, {
        x: 0.75,
        y: 1.35,
        w: 5.6,
        h: 0.52,
        fontSize: 28,
        color: COLOR_TEXT,
        margin: 0,
      });
      if (closingMessage) {
        slide.addText(trimText(closingMessage, 220) ?? closingMessage, {
          x: 0.75,
          y: 2.25,
          w: 4.9,
          h: 0.8,
          fontSize: 12.5,
          color: COLOR_MUTED,
          margin: 0,
        });
      }

      const logoData = await imageDataUri(data.companyProfile.logoUrl, imageCache);
      if (logoData) {
        slide.addImage({ data: logoData, x: 8.55, y: 0.86, w: 1.95, h: 0.56, sizing: { type: "contain", w: 1.95, h: 0.56 } });
      } else {
        slide.addText(data.companyProfile.displayName, {
          x: 8.55,
          y: 1.02,
          w: 2.2,
          h: 0.14,
          fontSize: 17,
          color: COLOR_WHITE,
          bold: true,
          margin: 0,
        });
      }

      slide.addText(safeLines([
        closingWebsite ? `Website: ${closingWebsite}` : null,
        closingEmail ? `Email: ${closingEmail}` : null,
        closingPhone ? `Phone: ${closingPhone}` : null,
        closingOfficeDetails ? `Office: ${closingOfficeDetails}` : null,
      ]).join("\n"), {
        x: 8.55,
        y: 5.72,
        w: 2.25,
        h: 1.1,
        fontSize: 10,
        color: "E5E7EB",
        margin: 0,
      });
      slide.addText("Furniture presentation", {
        x: 0.75,
        y: 7.18,
        w: 2.2,
        h: 0.08,
        fontSize: 8.5,
        bold: true,
        color: COLOR_LIGHT_TEXT,
        margin: 0,
      });
    }
  }

  const output = await pptx.write({ outputType: "nodebuffer", compression: true });
  const content = output instanceof Uint8Array ? Buffer.from(output) : Buffer.from(output as ArrayBuffer);

  return {
    content,
    fileName: `${presentationTitle(data.quotation, coverTitle)}.pptx`,
  };
}

function presentationTitle(
  quotation: Pick<PresentationQuotation, "quotation_no" | "title">,
  coverTitle: string | null,
) {
  const quotationNo = quotation.quotation_no ?? "Draft";
  const title = trimText(coverTitle ?? quotation.title, 80) ?? quotation.title;
  return `${quotationNo} - ${title}`.replace(/[\\/:*?"<>|]/g, "-");
}
