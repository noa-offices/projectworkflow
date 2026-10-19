import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
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
  finishes: FinishEntry[];
  isOptional: boolean;
  isRateOnly: boolean;
};

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

const RECT_SHAPE: Parameters<PptxSlide["addShape"]>[0] = "rect";
// 16:9 slide (13.333 x 7.5in). The web slide is 1920x1080 units: 144 units per inch.
const PPTX_LAYOUT_NAME = "WIDESCREEN_16_9";
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
// New 16:9 design tokens (same values as the web slides).
const DESIGN_COLORS = {
  bg: "2B2D33",
  card: "363940",
  hairline: "4C5058",
  text: "F3F0EA",
  muted: "B9B4AB",
  bronze: "CC9366",
  white: "FFFFFF",
  ink: "23252A",
  mutedOnWhite: "6B6F76",
  hairlineOnWhite: "DADCE0",
} as const;
// Regular family names. Weight 600 uses bold; weight 500 has no PowerPoint equivalent and uses the regular face.
const DESIGN_FONTS = { serif: "Cormorant Garamond", sans: "DM Sans" } as const;
// Average glyph width in em for wrap estimates, measured in Chrome on the real fonts (mixed-case sentences,
// digits and capitals included): DM Sans 400 = 0.46, 500 = 0.56, 600 = 0.49, uppercase 0.59; Cormorant 500 = 0.43.
// Rounded up slightly so an estimate never gives a box that is too short.
const TEXT_METRICS = { sans: 0.47, sansMedium: 0.55, sansSemibold: 0.5, sansUpper: 0.6, serif: 0.43 } as const;

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
  const hasCustomImage = Boolean(itemOverride && (
    itemOverride.imageUrl || itemOverride.imageFit !== "contain" || itemOverride.imageFrameSize !== "current"
    || itemOverride.imagePositionX !== 50 || itemOverride.imagePositionY !== 50 || itemOverride.imageScale !== 1 || itemOverride.imageRect
  ));
  const cellImageSettings = item.cell_layout?.images?.[item.proposed_image_url_snapshot ? "proposed_image_url_snapshot" : "specified_image_url_snapshot"];
  const imageFit = (hasCustomImage ? itemOverride?.imageFit : (cellImageSettings as { fit?: string } | undefined)?.fit) === "cover" ? "cover" : "contain";

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
    finishes: data.initialSettings.contentVisibility.finishes
      ? visibleFinishes(item, data.finishImageUrlByItemAndFinishId)
      : [],
  };
}

function buildProductNumberById(sections: DisplaySection[], presentableItemsBySection: Map<string, PresentationItem[]>) {
  const orderedItems = sections.flatMap((section) => presentableItemsBySection.get(section.id) ?? []);
  return new Map(orderedItems.map((item, index) => [item.id, index + 1] as const));
}

// ---------------------------------------------------------------------------------------------------------------
// 16:9 design (cover, design considerations, closing). Every number below is a unit of the web slide's 1920x1080
// canvas, copied from quotation-presentation.tsx. 1920 units = 13.333in, so inches = units / 144 and points = units / 2.
// ---------------------------------------------------------------------------------------------------------------
const u = (value: number) => value / 144;
const unitPt = (value: number) => value / 2;

type DesignTextOptions = {
  align?: "left" | "center" | "right";
  bold?: boolean;
  color: string;
  face: string;
  leading?: number;
  tracking?: number; // letter-spacing in units
};

function addDesignText(
  slide: PptxSlide,
  value: string | Array<{ text: string; color: string; bold?: boolean }>,
  x: number, y: number, w: number, h: number, size: number, options: DesignTextOptions,
) {
  if (!value.length) return;
  const leading = options.leading ?? 1.2;
  const common = {
    x: u(x),
    // PowerPoint puts the extra line height above the text, CSS splits it above and below: cancel the half-leading.
    y: u(y - Math.max(0, size * leading - size) / 2),
    w: u(w),
    h: u(h),
    fontFace: options.face,
    fontSize: unitPt(size),
    color: options.color,
    bold: Boolean(options.bold),
    margin: 0,
    valign: "top" as const,
    wrap: true,
    charSpacing: unitPt(options.tracking ?? 0),
    lineSpacing: unitPt(size * leading),
    paraSpaceAfter: 0,
    align: options.align ?? "left",
  };
  if (typeof value === "string") slide.addText(value, common);
  else slide.addText(value.map((run) => ({ text: run.text, options: { color: run.color, bold: run.bold ?? Boolean(options.bold) } })), common);
}

function addDesignRect(slide: PptxSlide, x: number, y: number, w: number, h: number, fill: string) {
  slide.addShape(RECT_SHAPE, { x: u(x), y: u(y), w: u(w), h: u(h), fill: { color: fill }, line: { color: fill, pt: 0 } });
}

function wrapDesignLines(value: string, width: number, size: number, em: number, tracking = 0) {
  const perCharacter = size * em + tracking;
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (current && next.length * perCharacter > width + 0.01) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    lines.push(current);
  }
  return lines;
}

// Mirrors the web's line clamp: more lines than allowed are cut and end with an ellipsis.
function clampDesignText(value: string, width: number, size: number, em: number, maxLines: number, tracking = 0) {
  const lines = wrapDesignLines(value, width, size, em, tracking);
  if (lines.length <= maxLines) return { text: value, lines: lines.length };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s,.;:]+$/, "")}…`;
  return { text: kept.join(" "), lines: maxLines };
}

let designGlowCache: Promise<string> | null = null;
// Soft bronze glow of the cover/closing: radial-gradient(circle, rgba(204,147,102,0.22), transparent 62%) in a
// 1200x1200 box at left 1000, top -260. A circle gradient reaches the farthest corner: radius 600 * sqrt(2).
function designGlowImage() {
  if (!designGlowCache) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="1600" cy="340" r="848.53"><stop offset="0" stop-color="#${DESIGN_COLORS.bronze}" stop-opacity="0.22"/><stop offset="0.62" stop-color="#${DESIGN_COLORS.bronze}" stop-opacity="0"/><stop offset="1" stop-color="#${DESIGN_COLORS.bronze}" stop-opacity="0"/></radialGradient></defs><rect width="1920" height="1080" fill="url(#glow)"/></svg>`;
    designGlowCache = sharp(Buffer.from(svg)).resize(2400, 1350).png().toBuffer()
      .then((png) => `data:image/png;base64,${png.toString("base64")}`);
    designGlowCache.catch(() => { designGlowCache = null; });
  }
  return designGlowCache;
}

function formatDesignDate(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value))
    : null;
}

// White logo (CSS brightness-0 invert) fitted into a box, left aligned and vertically centred (object-contain object-left).
async function addDesignLogo(slide: PptxSlide, source: string, x: number, y: number, boxWidth: number, boxHeight: number, cache: Map<string, string | null>) {
  let logoSource = source;
  try { if (["noaoffices.com", "www.noaoffices.com"].includes(new URL(logoSource).hostname.toLowerCase())) logoSource = "/noa-logo.png"; } catch { /* Local asset path. */ }
  const encoded = await imageDataUri(logoSource, cache);
  if (!encoded) return false;
  try {
    const result = await sharp(Buffer.from(encoded.slice(encoded.indexOf(",") + 1), "base64"), { animated: false })
      .rotate().ensureAlpha().linear(0, 255).png().toBuffer({ resolveWithObject: true });
    const scale = Math.min(boxWidth / result.info.width, boxHeight / result.info.height);
    const width = result.info.width * scale, height = result.info.height * scale;
    slide.addImage({ data: `data:image/png;base64,${result.data.toString("base64")}`, x: u(x), y: u(y + (boxHeight - height) / 2), w: u(width), h: u(height) });
    return true;
  } catch {
    return false;
  }
}

type DesignInfoCell = { label: string; value: string };

// Label (22, uppercase, spaced) over value (26, weight 500). Returns the row height.
function addDesignInfoRow(slide: PptxSlide, cells: DesignInfoCell[], x: number, y: number, width: number, mode: { gap: number; between: boolean }) {
  const labelHeight = 22 * 1.2, valueLeading = 1.3, valueGap = 8;
  const natural = cells.map((cell) => Math.max(
    cell.label.length * (22 * TEXT_METRICS.sansUpper + 3),
    cell.value.length * 26 * TEXT_METRICS.sansMedium,
  ));
  const naturalTotal = natural.reduce((sum, w) => sum + w, 0) + mode.gap * Math.max(cells.length - 1, 0);
  const shrink = naturalTotal > width ? (width - mode.gap * Math.max(cells.length - 1, 0)) / (naturalTotal - mode.gap * Math.max(cells.length - 1, 0)) : 1;
  const widths = natural.map((w) => w * shrink);
  const gap = mode.between && cells.length > 1
    ? (width - widths.reduce((sum, w) => sum + w, 0)) / (cells.length - 1)
    : mode.gap;
  let cursor = x, rowHeight = 0;
  cells.forEach((cell, index) => {
    addDesignText(slide, cell.label.toUpperCase(), cursor, y, widths[index] + 4, labelHeight, 22,
      { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.muted, tracking: 3 });
    const lines = wrapDesignLines(cell.value, widths[index], 26, TEXT_METRICS.sansMedium).length;
    const valueHeight = lines * 26 * valueLeading;
    addDesignText(slide, cell.value, cursor, y + labelHeight + valueGap, widths[index] + 4, valueHeight, 26,
      { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.text, leading: valueLeading });
    rowHeight = Math.max(rowHeight, labelHeight + valueGap + valueHeight);
    cursor += widths[index] + gap;
  });
  return rowHeight;
}

function designInfoRowHeight(cells: DesignInfoCell[], width: number, gap: number) {
  const natural = cells.map((cell) => Math.max(cell.label.length * (22 * TEXT_METRICS.sansUpper + 3), cell.value.length * 26 * TEXT_METRICS.sansMedium));
  const gaps = gap * Math.max(cells.length - 1, 0);
  const total = natural.reduce((sum, w) => sum + w, 0) + gaps;
  const shrink = total > width ? (width - gaps) / (total - gaps) : 1;
  return Math.max(...cells.map((cell, index) => 22 * 1.2 + 8 + wrapDesignLines(cell.value, natural[index] * shrink, 26, TEXT_METRICS.sansMedium).length * 26 * 1.3));
}

type DesignSlideData = {
  cache: Map<string, string | null>;
  companyDisplayName: string;
  date: string | null;
  logoUrl: string | null;
  quotationNo: string | null;
};

async function addCoverSlide(slide: PptxSlide, v: DesignSlideData & {
  clientName: string | null; preparedBy: string | null; projectName: string | null; subtitle: string | null; title: string; website: string | null;
}) {
  slide.background = { color: DESIGN_COLORS.bg };
  slide.addImage({ data: await designGlowImage(), x: 0, y: 0, w: u(1920), h: u(1080) });
  addDesignRect(slide, 1790, 96, 2, 888, DESIGN_COLORS.bronze);

  const x = 128, top = 96, width = 1560, height = 888;
  // Row 1: logo left, website right (47 high).
  const logoDrawn = await addDesignLogo(slide, v.logoUrl || "/noa-logo.png", x, top, 280, 47, v.cache);
  if (!logoDrawn) addDesignText(slide, v.preparedBy ?? v.companyDisplayName, x, top + 3, 700, 40, 40, { face: DESIGN_FONTS.serif, color: DESIGN_COLORS.text, leading: 1 });
  if (v.website) addDesignText(slide, v.website, x + width - 600, top + (47 - 24 * 1.3) / 2, 600, 24 * 1.3, 24,
    { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.muted, leading: 1.3, align: "right" });

  // Row 3: hairline, then the info cells (Project, Quote no., Prepared for, Prepared by, Date).
  const cells: DesignInfoCell[] = [
    { label: "Project", value: v.projectName ?? "" },
    { label: "Quote no.", value: v.quotationNo ?? "" },
    { label: "Prepared for", value: v.clientName ?? "" },
    { label: "Prepared by", value: v.preparedBy ?? "" },
    { label: "Date", value: v.date ?? "" },
  ].filter((cell) => cell.value);
  const row3Height = cells.length ? 1 + 36 + designInfoRowHeight(cells, width, 48) : 0;

  // Row 2: eyebrow, title (1100 wide), bronze rule, subtitle (820 wide, 3 lines).
  const titleLines = wrapDesignLines(v.title, 1100, 120, TEXT_METRICS.serif).length;
  const subtitle = v.subtitle ? clampDesignText(v.subtitle, 820, 28, TEXT_METRICS.sans, 3) : null;
  const titleHeight = titleLines * 120 * 1.02;
  const row2Height = 24 * 1.2 + 32 + titleHeight + 36 + 3 + (subtitle ? 36 + subtitle.lines * 28 * 1.5 : 0);
  const free = height - 47 - row2Height - row3Height;
  const row2Top = top + 47 + free / 2;

  addDesignText(slide, "CLIENT PRESENTATION", x, row2Top, 900, 24 * 1.2, 24, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, bold: true, tracking: 5 });
  const titleTop = row2Top + 24 * 1.2 + 32;
  addDesignText(slide, v.title, x, titleTop, 1100, titleHeight, 120, { face: DESIGN_FONTS.serif, color: DESIGN_COLORS.text, leading: 1.02 });
  const ruleTop = titleTop + titleHeight + 36;
  addDesignRect(slide, x, ruleTop, 120, 3, DESIGN_COLORS.bronze);
  if (subtitle) addDesignText(slide, subtitle.text, x, ruleTop + 3 + 36, 820, subtitle.lines * 28 * 1.5, 28,
    { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.muted, leading: 1.5 });

  if (cells.length) {
    const row3Top = top + height - row3Height;
    addDesignRect(slide, x, row3Top, width, 1, DESIGN_COLORS.hairline);
    addDesignInfoRow(slide, cells, x, row3Top + 1 + 36, width, { gap: 48, between: true });
  }
}

async function addClosingSlide(slide: PptxSlide, v: DesignSlideData & {
  contacts: DesignInfoCell[]; message: string | null; title: string;
}) {
  slide.background = { color: DESIGN_COLORS.bg };
  slide.addImage({ data: await designGlowImage(), x: 0, y: 0, w: u(1920), h: u(1080) });

  const x = 128, top = 96, width = 1000, height = 888;
  const logoDrawn = await addDesignLogo(slide, v.logoUrl || "/noa-logo.png", x, top, 280, 47, v.cache);
  if (!logoDrawn) addDesignText(slide, v.companyDisplayName, x, top + 3, 700, 40, 40, { face: DESIGN_FONTS.serif, color: DESIGN_COLORS.text, leading: 1 });

  const cells: DesignInfoCell[] = [
    { label: "Quote no.", value: v.quotationNo ?? "" },
    { label: "Date", value: v.date ?? "" },
  ].filter((cell) => cell.value);
  const row3Height = cells.length ? 1 + 36 + designInfoRowHeight(cells, width, 96) : 0;

  const titleLines = wrapDesignLines(v.title, width, 120, TEXT_METRICS.serif).length;
  const message = v.message ? clampDesignText(v.message, 700, 28, TEXT_METRICS.sans, 4) : null;
  const titleHeight = titleLines * 120 * 1.02;
  const row2Height = titleHeight + 36 + 3 + (message ? 36 + message.lines * 28 * 1.5 : 0);
  const free = height - 47 - row2Height - row3Height;
  const row2Top = top + 47 + free / 2;

  addDesignText(slide, v.title, x, row2Top, width, titleHeight, 120, { face: DESIGN_FONTS.serif, color: DESIGN_COLORS.text, leading: 1.02 });
  const ruleTop = row2Top + titleHeight + 36;
  addDesignRect(slide, x, ruleTop, 120, 3, DESIGN_COLORS.bronze);
  if (message) addDesignText(slide, message.text, x, ruleTop + 3 + 36, 700, message.lines * 28 * 1.5, 28,
    { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.muted, leading: 1.5 });
  if (cells.length) {
    const row3Top = top + height - row3Height;
    addDesignRect(slide, x, row3Top, width, 1, DESIGN_COLORS.hairline);
    addDesignInfoRow(slide, cells, x, row3Top + 1 + 36, width, { gap: 96, between: false });
  }

  // Contact card: 560 wide at right 128, padding 48, 3-high bronze top border, vertically centred.
  const contacts = v.contacts.filter((entry) => entry.value);
  if (contacts.length) {
    const inner = 560 - 96;
    const blocks = contacts.map((entry) => {
      const lines = wrapDesignLines(entry.value, inner, 26, TEXT_METRICS.sansMedium).length;
      return { ...entry, height: 22 * 1.2 + 8 + lines * 26 * 1.35 };
    });
    const cardHeight = 3 + 96 + blocks.reduce((sum, block) => sum + block.height, 0) + 28 * (blocks.length - 1);
    const cardX = 1920 - 128 - 560, cardTop = 540 - cardHeight / 2;
    addDesignRect(slide, cardX, cardTop, 560, cardHeight, DESIGN_COLORS.card);
    addDesignRect(slide, cardX, cardTop, 560, 3, DESIGN_COLORS.bronze);
    let cursor = cardTop + 3 + 48;
    for (const block of blocks) {
      addDesignText(slide, block.label.toUpperCase(), cardX + 48, cursor, inner, 22 * 1.2, 22, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, tracking: 3 });
      addDesignText(slide, block.value, cardX + 48, cursor + 22 * 1.2 + 8, inner, block.height - 22 * 1.2 - 8, 26,
        { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.text, leading: 1.35 });
      cursor += block.height + 28;
    }
  }
}

function addDesignConsiderationsSlide(slide: PptxSlide) {
  slide.background = { color: DESIGN_COLORS.bg };
  const x = 128, top = 96, width = 1664, bottom = 984;

  addDesignText(slide, "EDITORIAL OVERVIEW", x, top, 900, 24 * 1.2, 24, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, bold: true, tracking: 5 });
  addDesignText(slide, [{ text: "Design ", color: DESIGN_COLORS.text }, { text: "considerations", color: DESIGN_COLORS.bronze }],
    x, top + 24 * 1.2 + 16, 980, 84 * 1.05, 84, { face: DESIGN_FONTS.serif, leading: 1.05, color: DESIGN_COLORS.text });
  const intro = clampDesignText("Core principles reviewed when aligning furniture choices with workflow, brand expression, and long-term performance.", 620, 28, TEXT_METRICS.sans, 4);
  addDesignText(slide, intro.text, x + width - 620, top, 620, intro.lines * 28 * 1.5, 28, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.muted, leading: 1.5 });

  // 4 x 2 grid, gap 24, equal row heights (grid-auto-rows 1fr), anchored to the bottom edge.
  const columnWidth = (width - 3 * 24) / 4, inner = columnWidth - 64;
  const cards = designConsiderations.map((entry) => {
    const title = wrapDesignLines(entry.title, inner, 28, TEXT_METRICS.sansSemibold).length;
    const body = clampDesignText(entry.body, inner, 24, TEXT_METRICS.sans, 4);
    return { entry, titleLines: title, body, height: 3 + 32 + 24 * 1.2 + 12 + title * 28 * 1.25 + 12 + body.lines * 24 * 1.45 + 32 };
  });
  const rowHeight = Math.max(...cards.map((card) => card.height));
  const gridTop = bottom - (2 * rowHeight + 24);
  cards.forEach((card, index) => {
    const cardX = x + (index % 4) * (columnWidth + 24);
    const cardY = gridTop + Math.floor(index / 4) * (rowHeight + 24);
    addDesignRect(slide, cardX, cardY, columnWidth, rowHeight, DESIGN_COLORS.card);
    addDesignRect(slide, cardX, cardY, columnWidth, 3, DESIGN_COLORS.bronze);
    addDesignText(slide, String(index + 1).padStart(2, "0"), cardX + 32, cardY + 3 + 32, inner, 24 * 1.2, 24,
      { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, bold: true, tracking: 2 });
    const titleY = cardY + 3 + 32 + 24 * 1.2 + 12;
    addDesignText(slide, card.entry.title, cardX + 32, titleY, inner, card.titleLines * 28 * 1.25, 28,
      { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.text, bold: true, leading: 1.25 });
    addDesignText(slide, card.body.text, cardX + 32, titleY + card.titleLines * 28 * 1.25 + 12, inner, card.body.lines * 24 * 1.45, 24,
      { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.muted, leading: 1.45 });
  });
}

type DesignImage = { data: string; height: number; width: number };
type DesignRect = { x: number; y: number; w: number; h: number };

// Decodes any supported source (URL, path, base64 or URL-encoded data URI) into a PNG with its pixel size.
async function loadDesignImage(source: string | null | undefined, cache: Map<string, string | null>): Promise<DesignImage | null> {
  const encoded = await imageDataUri(source ?? null, cache);
  if (!encoded) return null;
  try {
    const comma = encoded.indexOf(",");
    const payload = encoded.slice(comma + 1);
    const input = /;base64/i.test(encoded.slice(0, comma)) ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    const png = await sharp(input, { animated: false }).rotate().png().toBuffer({ resolveWithObject: true });
    return { data: `data:image/png;base64,${png.data.toString("base64")}`, height: png.info.height, width: png.info.width };
  } catch {
    return null;
  }
}

// Image in a box. "cover" crops through PptxGenJS sizing (the element carries the source aspect, sizing carries the box);
// "contain" is fitted and centred like CSS object-contain.
async function addDesignImage(
  slide: PptxSlide, source: string | null | undefined, x: number, y: number, w: number, h: number,
  fit: "contain" | "cover", cache: Map<string, string | null>,
) {
  const image = await loadDesignImage(source, cache);
  if (!image) return false;
  if (fit === "cover") {
    slide.addImage({ data: image.data, x: u(x), y: u(y), w: image.width / 96, h: image.height / 96, sizing: { type: "cover", w: u(w), h: u(h) } });
  } else {
    const scale = Math.min(w / image.width, h / image.height);
    const width = image.width * scale, height = image.height * scale;
    slide.addImage({ data: image.data, x: u(x + (w - width) / 2), y: u(y + (h - height) / 2), w: u(width), h: u(height) });
  }
  return true;
}

// Draws an image in a frame exactly like the web's PresentationImageStage: object-fit and object-position X%/Y% inside the
// frame, then scale() around the same X%/Y% point, all clipped to the frame. Whatever leaves the frame is cropped.
function placeDesignImage(slide: PptxSlide, image: DesignImage, frame: DesignRect, fit: "contain" | "cover", positionX: number, positionY: number, scale: number) {
  const fitScale = fit === "cover" ? Math.max(frame.w / image.width, frame.h / image.height) : Math.min(frame.w / image.width, frame.h / image.height);
  const width = image.width * fitScale, height = image.height * fitScale;
  const baseX = frame.x + (frame.w - width) * positionX / 100, baseY = frame.y + (frame.h - height) * positionY / 100;
  const originX = frame.x + frame.w * positionX / 100, originY = frame.y + frame.h * positionY / 100;
  const drawn: DesignRect = { x: originX + (baseX - originX) * scale, y: originY + (baseY - originY) * scale, w: width * scale, h: height * scale };
  const left = Math.max(drawn.x, frame.x), top = Math.max(drawn.y, frame.y);
  const right = Math.min(drawn.x + drawn.w, frame.x + frame.w), bottom = Math.min(drawn.y + drawn.h, frame.y + frame.h);
  if (right - left < 0.01 || bottom - top < 0.01) return;
  const cropped = left > drawn.x + 0.01 || top > drawn.y + 0.01 || right < drawn.x + drawn.w - 0.01 || bottom < drawn.y + drawn.h - 0.01;
  if (!cropped) {
    slide.addImage({ data: image.data, x: u(drawn.x), y: u(drawn.y), w: u(drawn.w), h: u(drawn.h) });
    return;
  }
  slide.addImage({
    data: image.data, x: u(left), y: u(top), w: u(drawn.w), h: u(drawn.h),
    sizing: { type: "crop", x: u(left - drawn.x), y: u(top - drawn.y), w: u(right - left), h: u(bottom - top) },
  });
}

const PRODUCT_FINISH_LIMIT = 25; // same cap as the web slide
const PRODUCT_FRAME_SIZES = { current: { w: 1, h: 1 }, medium: { w: 0.88, h: 0.86 }, small: { w: 0.76, h: 0.72 } } as const;

function finishCaption(finish: FinishEntry) {
  return (finish.name && finish.name !== finish.code ? finish.name : null) || (!finish.code ? finish.description || "Selected finish" : null);
}

type DesignProductSlide = {
  cache: Map<string, string | null>;
  frameSize: "small" | "medium" | "current";
  imageRect: { x: number; y: number; w: number; h: number } | null;
  imageScale: number;
  itemNumber: number;
  positionX: number;
  positionY: number;
  preparedBy: string;
  product: ProductPageData;
  quotationNo: string | null;
  sectionTitle: string;
  showSpecification: boolean;
  summary: string | null;
};

async function addProductSlide(slide: PptxSlide, v: DesignProductSlide) {
  const { product } = v;
  slide.background = { color: DESIGN_COLORS.white };
  addDesignRect(slide, 1240, 0, 680, 1080, DESIGN_COLORS.bg);

  // ---- Image box (60, 40, 1120 x 800), white. imageRect replaces scale, position and frame size.
  const box: DesignRect = { x: 60, y: 40, w: 1120, h: 800 };
  let frame: DesignRect, positionX = 50, positionY = 50, scale = 1;
  if (v.imageRect) {
    frame = { x: box.x + v.imageRect.x / 100 * box.w, y: box.y + v.imageRect.y / 100 * box.h, w: v.imageRect.w / 100 * box.w, h: v.imageRect.h / 100 * box.h };
  } else {
    const size = PRODUCT_FRAME_SIZES[v.frameSize];
    frame = { x: box.x + box.w * (1 - size.w) / 2, y: box.y + box.h * (1 - size.h) / 2, w: box.w * size.w, h: box.h * size.h };
    positionX = v.positionX;
    positionY = v.positionY;
    scale = v.imageScale;
  }
  const image = await loadDesignImage(product.imageUrl, v.cache);
  if (image) {
    placeDesignImage(slide, image, frame, product.imageFit, positionX, positionY, scale);
  } else {
    const note = clampDesignText("No quotation image is available for this item yet. The item remains included so the presentation sequence stays complete.", 640, 20, TEXT_METRICS.sans, 3);
    const chipWidth = "VISUAL PENDING".length * (17 * TEXT_METRICS.sansUpper + 3) + 2 * 18 + 2, chipHeight = 17 * 1.5 + 2 * 6 + 2;
    const stack = chipHeight + 20 + note.lines * 30;
    const top = frame.y + (frame.h - stack) / 2;
    slide.addShape(RECT_SHAPE, { x: u(frame.x + (frame.w - chipWidth) / 2), y: u(top), w: u(chipWidth), h: u(chipHeight),
      fill: { type: "none" }, line: { color: DESIGN_COLORS.hairlineOnWhite, width: unitPt(1), dashType: "dash" } });
    addDesignText(slide, "VISUAL PENDING", frame.x + (frame.w - chipWidth) / 2, top + 7, chipWidth, 17 * 1.5, 17,
      { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.mutedOnWhite, bold: true, tracking: 3, leading: 1.5, align: "center" });
    addDesignText(slide, note.text, frame.x + (frame.w - 640) / 2, top + chipHeight + 20, 640, note.lines * 30, 20,
      { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.mutedOnWhite, leading: 1.5, align: "center" });
  }

  // ---- Details row: x 60, width 1120, bottom edge 1040, grows upward (cells wrap, space-between).
  const cells = [
    ...product.meta.map((row) => ({ label: row.label, value: row.value })),
    { label: "Area", value: product.item.room_name_snapshot ?? "" },
    { label: "Quote no.", value: v.quotationNo ?? "" },
    { label: "Prepared by", value: v.preparedBy },
  ].filter((cell) => cell.value);
  if (cells.length) {
    const natural = cells.map((cell) => Math.min(1120, Math.max(cell.label.length * (17 * TEXT_METRICS.sansUpper + 2), cell.value.length * 22 * TEXT_METRICS.sansMedium)));
    const lines: Array<Array<number>> = [[]];
    let used = 0;
    natural.forEach((width, index) => {
      const row = lines[lines.length - 1];
      if (row.length && used + 40 + width > 1120) { lines.push([index]); used = width; } else { used += (row.length ? 40 : 0) + width; row.push(index); }
    });
    const cellHeight = (index: number) => 17 * 1.2 + 6 + wrapDesignLines(cells[index].value, natural[index], 22, TEXT_METRICS.sansMedium).length * 22 * 1.3;
    const rowHeights = lines.map((row) => Math.max(...row.map(cellHeight)));
    const total = 1 + 16 + rowHeights.reduce((sum, h) => sum + h, 0) + 16 * (lines.length - 1);
    const top = 1040 - total;
    addDesignRect(slide, 60, top, 1120, 1, DESIGN_COLORS.hairlineOnWhite);
    let rowY = top + 1 + 16;
    lines.forEach((row, rowIndex) => {
      const free = 1120 - row.reduce((sum, index) => sum + natural[index], 0);
      const gap = row.length > 1 ? free / (row.length - 1) : 0;
      let cursor = 60;
      for (const index of row) {
        addDesignText(slide, cells[index].label.toUpperCase(), cursor, rowY, natural[index] + 4, 17 * 1.2, 17, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.mutedOnWhite, tracking: 2 });
        addDesignText(slide, cells[index].value, cursor, rowY + 17 * 1.2 + 6, natural[index] + 4, cellHeight(index) - 17 * 1.2 - 6, 22,
          { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.ink, leading: 1.3 });
        cursor += natural[index] + gap;
      }
      rowY += rowHeights[rowIndex] + 16;
    });
  }

  // ---- Finishes (bottom of the right panel, bottom edge 1040), measured first so the top group can sit above it.
  const flat = product.finishes.length ? (() => {
    const groups = new Map<string, FinishEntry[]>();
    for (const finish of product.finishes) groups.set(finish.label, [...(groups.get(finish.label) ?? []), finish]);
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  })() : [];
  const allFinishCount = flat.reduce((sum, group) => sum + group.items.length, 0);
  let remaining = PRODUCT_FINISH_LIMIT;
  const shownGroups = flat.map((group) => {
    const items = group.items.slice(0, Math.max(remaining, 0));
    remaining -= items.length;
    return { label: group.label, items };
  }).filter((group) => group.items.length);
  const shownCount = shownGroups.reduce((sum, group) => sum + group.items.length, 0);
  const hiddenCount = Math.max(allFinishCount - shownCount, 0);

  const chipLines = (finish: FinishEntry) => Math.min(2, wrapDesignLines([finish.code, finishCaption(finish)].filter(Boolean).join(" "), 108, 15, TEXT_METRICS.sansSemibold).length);
  const groupLayouts = shownGroups.map((group) => {
    const rows: FinishEntry[][] = [];
    for (let i = 0; i < group.items.length; i += 5) rows.push(group.items.slice(i, i + 5));
    const rowHeights = rows.map((row) => 36 + 6 + Math.max(...row.map(chipLines)) * 15 * 1.2);
    return { label: group.label, rows, rowHeights, height: 18 * 1.5 + 10 + rowHeights.reduce((sum, h) => sum + h, 0) + 14 * (rows.length - 1) };
  });
  const finishesHeight = groupLayouts.length
    ? 1 + 18 + 18 * 1.5 + groupLayouts.reduce((sum, group) => sum + 16 + group.height, 0)
    : 0;
  const finishesTop = 1040 - finishesHeight;

  if (groupLayouts.length) {
    addDesignRect(slide, 1292, finishesTop, 580, 1, DESIGN_COLORS.hairline);
    let cursor = finishesTop + 1 + 18;
    addDesignText(slide, "FINISHES", 1292, cursor, 300, 18 * 1.5, 18, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.text, bold: true, tracking: 4, leading: 1.5 });
    if (hiddenCount) addDesignText(slide, `+${hiddenCount} MORE`, 1292 + 280, cursor + 1, 300, 17 * 1.5, 17, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, tracking: 2, leading: 1.5, align: "right" });
    cursor += 18 * 1.5;
    for (const group of groupLayouts) {
      cursor += 16;
      addDesignText(slide, group.label.toUpperCase(), 1292, cursor, 580, 18 * 1.5, 18, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, bold: true, tracking: 3, leading: 1.5 });
      cursor += 18 * 1.5 + 10;
      for (const [rowIndex, row] of group.rows.entries()) {
        for (const [chipIndex, finish] of row.entries()) {
          const x = 1292 + chipIndex * (108 + 10);
          // Swatch 108 x 36: grey placeholder, optional thumbnail (cover) inside the 1-unit border.
          slide.addShape(RECT_SHAPE, { x: u(x + 0.5), y: u(cursor + 0.5), w: u(107), h: u(35), fill: { color: "ECECEE" }, line: { color: DESIGN_COLORS.hairline, width: unitPt(1) } });
          if (finish.imageUrl) await addDesignImage(slide, finish.imageUrl, x + 1, cursor + 1, 106, 34, "cover", v.cache);
          const caption = finishCaption(finish);
          const runs: Array<{ text: string; color: string; bold?: boolean }> = [];
          if (finish.code) runs.push({ text: finish.code, color: DESIGN_COLORS.text, bold: true });
          if (caption) runs.push({ text: `${finish.code ? " " : ""}${caption}`, color: DESIGN_COLORS.muted });
          addDesignText(slide, runs, x, cursor + 36 + 6, 108, chipLines(finish) * 15 * 1.2, 15, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.muted, leading: 1.2 });
        }
        cursor += group.rowHeights[rowIndex] + 14;
      }
      cursor -= 14;
    }
  }

  // ---- Top group (x 1292, y 56, width 580): eyebrow, name (+ badges), subtitle, description.
  const x = 1292, width = 580;
  const limit = finishesHeight ? finishesTop - 24 : 1040;
  let y = 56;
  const eyebrow = clampDesignText(`ITEM ${v.itemNumber}${v.sectionTitle ? ` · ${v.sectionTitle}` : ""}`.toUpperCase(), width, 20, TEXT_METRICS.sansUpper, 1, 5);
  addDesignText(slide, eyebrow.text, x, y, width, 20 * 1.2, 20, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, bold: true, tracking: 5 });
  y += 20 * 1.2 + 20;

  const title = clampDesignText(product.heading, width, 60, TEXT_METRICS.serif, 2, -1);
  addDesignText(slide, title.text, x, y, width, title.lines * 60, 60, { face: DESIGN_FONTS.serif, color: DESIGN_COLORS.text, leading: 1, tracking: -1 });
  y += title.lines * 60;
  const badges = [product.isOptional ? "OPTIONAL" : null, product.isRateOnly ? "RATE ONLY" : null].filter((label): label is string => Boolean(label));
  if (badges.length) {
    y += 12;
    let badgeX = x;
    for (const label of badges) {
      const badgeWidth = label.length * (17 * TEXT_METRICS.sansUpper + 2) + 2 * 10 + 2, badgeHeight = 17 * 1.5 + 2 * 2 + 2;
      slide.addShape(RECT_SHAPE, { x: u(badgeX + 0.5), y: u(y + 0.5), w: u(badgeWidth - 1), h: u(badgeHeight - 1), fill: { type: "none" }, line: { color: DESIGN_COLORS.bronze, width: unitPt(1) } });
      addDesignText(slide, label, badgeX + 1 + 10, y + 1 + 2, badgeWidth, 17 * 1.5, 17, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, bold: true, tracking: 2, leading: 1.5 });
      badgeX += badgeWidth + 8;
    }
    y += 17 * 1.5 + 2 * 2 + 2;
  }
  y += 20;

  if (v.summary) {
    const summary = clampDesignText(v.summary.toUpperCase(), width, 19, TEXT_METRICS.sansUpper, 2, 3);
    addDesignText(slide, summary.text, x, y, width, summary.lines * 19 * 1.3, 19, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, bold: true, tracking: 3, leading: 1.3 });
    y += summary.lines * 19 * 1.3 + 20;
  }

  if (v.showSpecification) {
    // Same rule as the web: 4 lines with 3+ finish types or more than 18 swatches, otherwise 6; fewer if the space is short.
    const ruleLines = shownGroups.length >= 3 || shownCount > 18 ? 4 : 6;
    const fitting = Math.floor((limit - y) / 30);
    const maxLines = Math.min(ruleLines, fitting);
    if (product.specification && maxLines >= 1) {
      const description = clampDesignText(product.specification, width, 20, TEXT_METRICS.sans, maxLines);
      addDesignText(slide, description.text, x, y, width, description.lines * 30, 20, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.muted, leading: 1.5 });
    } else if (!product.specification && fitting >= 1) {
      addDesignText(slide, "Specification details not added yet.", x, y, width, 30, 20, { face: DESIGN_FONTS.sans, color: "8E8B87", leading: 1.5 });
    }
  }
}

type DesignColumnBlock =
  | { chip: string }
  | { text: string; size: number; leading: number; color: string; clamp?: number; medium?: boolean };

// Left column of the section and area slides: eyebrow + title at the top, a bottom group (gap 20) ending at y 984,
// and the footer line. Column x 128, width 380.
function addDesignSectionColumn(slide: PptxSlide, v: {
  blocks: DesignColumnBlock[]; companyDisplayName: string; eyebrow: string; quotationNo: string | null; title: string;
}) {
  const x = 128, width = 380, top = 96, bottom = 984;
  const eyebrowLines = wrapDesignLines(v.eyebrow.toUpperCase(), width, 24, TEXT_METRICS.sansUpper, 5).length;
  const eyebrowHeight = eyebrowLines * 24 * 1.2;
  const title = clampDesignText(v.title, width, 72, TEXT_METRICS.serif, 3, -1);
  addDesignText(slide, v.eyebrow.toUpperCase(), x, top, width, eyebrowHeight, 24, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, bold: true, tracking: 5 });
  addDesignText(slide, title.text, x, top + eyebrowHeight + 24, width, title.lines * 72 * 1.05, 72,
    { face: DESIGN_FONTS.serif, color: DESIGN_COLORS.text, leading: 1.05, tracking: -1 });

  // Bottom group, measured first so it can be stacked upwards from the bottom edge.
  const placed = v.blocks.map((block) => {
    if ("chip" in block) {
      const text = v.blocks.length ? block.chip.toUpperCase() : "";
      const inner = width - 2 * 26 - 2 * 2;
      const clamped = clampDesignText(text, inner, 22, TEXT_METRICS.sansUpper, 2, 4);
      const lines = wrapDesignLines(clamped.text, inner, 22, TEXT_METRICS.sansUpper, 4);
      const textWidth = Math.max(...lines.map((line) => line.length * (22 * TEXT_METRICS.sansUpper + 4)));
      return { block, text: clamped.text, lines: clamped.lines, chipWidth: Math.min(width, textWidth + 2 * 26 + 2 * 2), height: clamped.lines * 22 * 1.2 + 2 * 12 + 2 * 2 };
    }
    const em = block.medium ? TEXT_METRICS.sansMedium : TEXT_METRICS.sans;
    const clamped = block.clamp ? clampDesignText(block.text, width, block.size, em, block.clamp) : { text: block.text, lines: wrapDesignLines(block.text, width, block.size, em).length };
    return { block, text: clamped.text, lines: clamped.lines, chipWidth: 0, height: clamped.lines * block.size * block.leading };
  });
  const total = placed.reduce((sum, entry) => sum + entry.height, 0) + 20 * Math.max(placed.length - 1, 0);
  let cursor = bottom - total;
  for (const entry of placed) {
    if ("chip" in entry.block) {
      // 2-unit bronze border drawn as an outline inset by half its width; no fill.
      slide.addShape(RECT_SHAPE, { x: u(x + 1), y: u(cursor + 1), w: u(entry.chipWidth - 2), h: u(entry.height - 2),
        fill: { type: "none" }, line: { color: DESIGN_COLORS.bronze, width: unitPt(2) } });
      addDesignText(slide, entry.text, x + 2 + 26, cursor + 2 + 12, entry.chipWidth - 2 * 26 - 2 * 2 + 6, entry.lines * 22 * 1.2, 22,
        { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.bronze, bold: true, tracking: 4 });
    } else {
      addDesignText(slide, entry.text, x, cursor, width, entry.height, entry.block.size,
        { face: DESIGN_FONTS.sans, color: entry.block.color, leading: entry.block.leading });
    }
    cursor += entry.height + 20;
  }

  const footer = clampDesignText([v.companyDisplayName, v.quotationNo].filter(Boolean).join(" · "), 900, 22, TEXT_METRICS.sans, 1);
  addDesignText(slide, footer.text, x, 1080 - 40 - 22 * 1.3, 900, 22 * 1.3, 22, { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.muted, leading: 1.3 });
}

async function addSectionSlide(slide: PptxSlide, v: {
  cache: Map<string, string | null>; chipText: string; companyDisplayName: string; eyebrow: string;
  layoutSource: string | null; note: string | null; quotationNo: string | null; title: string;
}) {
  slide.background = { color: DESIGN_COLORS.bg };
  addDesignSectionColumn(slide, {
    companyDisplayName: v.companyDisplayName,
    eyebrow: v.eyebrow,
    quotationNo: v.quotationNo,
    title: v.title,
    blocks: [
      { text: v.layoutSource ? "Floor layout overview" : "Main area overview", size: 30, leading: 1.3, color: DESIGN_COLORS.muted },
      ...(v.note ? [{ text: v.note, size: 24, leading: 1.5, color: DESIGN_COLORS.muted, clamp: 4 }] : []),
      { chip: v.chipText },
    ],
  });

  // White card with the floor layout (only when the web draws it): 1212 x 888 at (580, 96), padding 24, label then image.
  if (v.layoutSource) {
    addDesignRect(slide, 580, 96, 1212, 888, DESIGN_COLORS.white);
    addDesignText(slide, "FULL FLOOR LAYOUT", 580 + 24, 96 + 24, 1164, 24, 20, { face: DESIGN_FONTS.sans, color: "7A7A7A", bold: true, tracking: 3 });
    await addDesignImage(slide, v.layoutSource, 580 + 24, 96 + 24 + 24 + 12, 1164, 888 - 48 - 24 - 12, "contain", v.cache);
  }
}

async function addAreaSlide(slide: PptxSlide, v: {
  cache: Map<string, string | null>; chipText: string; companyDisplayName: string; count: string; eyebrow: string; note: string | null;
  quotationNo: string | null; title: string; within: string | null;
  visuals: Array<{ key: "area" | "snapshot"; label: string; source: string }>;
}) {
  slide.background = { color: DESIGN_COLORS.bg };
  addDesignSectionColumn(slide, {
    companyDisplayName: v.companyDisplayName,
    eyebrow: v.eyebrow,
    quotationNo: v.quotationNo,
    title: v.title,
    blocks: [
      ...(v.note ? [{ text: v.note, size: 24, leading: 1.5, color: DESIGN_COLORS.muted, clamp: 4 }] : []),
      ...(v.within ? [{ text: `Within ${v.within}`, size: 32, leading: 1.25, color: DESIGN_COLORS.text, medium: true }] : []),
      { text: v.count, size: 28, leading: 1.3, color: DESIGN_COLORS.muted },
      { chip: v.chipText },
    ],
  });

  // Right area 1212 x 888 at (580, 96), gap 24. A single image takes the full width; no image leaves it empty.
  const single = v.visuals.length === 1;
  let cursor = 580;
  for (const visual of v.visuals) {
    if (visual.key === "area") {
      const width = single ? 1212 : 520;
      addDesignRect(slide, cursor, 96, width, 888, DESIGN_COLORS.card);
      await addDesignImage(slide, visual.source, cursor, 96, width, 888, "cover", v.cache);
      // Label chip: left 20, bottom 20, #2B2D33 at 80 percent, padding 10/16.
      const text = visual.label.toUpperCase();
      const chipWidth = text.length * (20 * TEXT_METRICS.sansUpper + 3) + 2 * 16, chipHeight = 20 * 1.2 + 2 * 10;
      const chipY = 96 + 888 - 20 - chipHeight;
      slide.addShape(RECT_SHAPE, { x: u(cursor + 20), y: u(chipY), w: u(chipWidth), h: u(chipHeight),
        fill: { color: DESIGN_COLORS.bg, transparency: 20 }, line: { color: DESIGN_COLORS.bg, pt: 0 } });
      addDesignText(slide, text, cursor + 20 + 16, chipY + 10, chipWidth - 2 * 16 + 6, 20 * 1.2, 20,
        { face: DESIGN_FONTS.sans, color: DESIGN_COLORS.text, bold: true, tracking: 3 });
      cursor += width + 24;
    } else {
      const width = single ? 1212 : 668;
      addDesignRect(slide, cursor, 96, width, 888, DESIGN_COLORS.white);
      addDesignText(slide, visual.label.toUpperCase(), cursor + 24, 96 + 24, width - 48, 24, 20, { face: DESIGN_FONTS.sans, color: "7A7A7A", bold: true, tracking: 3 });
      await addDesignImage(slide, visual.source, cursor + 24, 96 + 24 + 24 + 12, width - 48, 888 - 48 - 24 - 12, "contain", v.cache);
      cursor += width + 24;
    }
  }
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
      // The PowerPoint export always uses one product per slide, also when the web layout is two per page.
      return [section.id, sectionItems.map((item) => [item])] as const;
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
    name: PPTX_LAYOUT_NAME,
    width: SLIDE_W,
    height: SLIDE_H,
  });
  pptx.layout = PPTX_LAYOUT_NAME;
  pptx.author = data.companyProfile.displayName || FALLBACK_COMPANY_PROFILE.displayName;
  pptx.company = data.companyProfile.companyName || FALLBACK_COMPANY_PROFILE.companyName;
  pptx.subject = "Quotation Presentation";
  pptx.title = presentationTitle(data.quotation, coverTitle);

  const imageCache = new Map<string, string | null>();

  for (const slideDef of slides) {
    const slide = pptx.addSlide();

    if (slideDef.type === "cover" || slideDef.type === "design" || slideDef.type === "thank-you") {
      const shared = {
        cache: imageCache,
        companyDisplayName: data.companyProfile.displayName,
        date: formatDesignDate(data.quotation.quotation_date),
        logoUrl: data.companyProfile.logoUrl,
        quotationNo: data.quotation.quotation_no,
      };
      if (slideDef.type === "cover") {
        await addCoverSlide(slide, {
          ...shared,
          clientName: coverClientDisplayName,
          preparedBy: coverPreparedBy,
          projectName: coverProjectDisplayName,
          subtitle: coverSubtitle,
          title: coverTitle || "",
          website: coverWebsite,
        });
      } else if (slideDef.type === "thank-you") {
        await addClosingSlide(slide, {
          ...shared,
          contacts: [
            { label: "Website", value: closingWebsite ?? "" },
            { label: "Email", value: closingEmail ?? "" },
            { label: "Phone", value: closingPhone ?? "" },
            { label: "Office", value: closingOfficeDetails ?? "" },
          ],
          message: closingMessage,
          title: closingTitle || "",
        });
      } else {
        addDesignConsiderationsSlide(slide);
      }
      continue;
    }

    if (slideDef.type === "main-area" || slideDef.type === "section") {
      const main = slideDef.type === "main-area";
      const section = main ? slideDef.mainSection : slideDef.section;
      const title = (main ? mainSectionTitlesById : titledSectionsById).get(section.id) ?? section.section_title;
      const note = main
        ? resolvedOverrideValue(settings.mainSectionOverrides[section.id]?.note, section.section_notes)
        : sectionPresentationNote(section, settings);
      const shared = {
        cache: imageCache,
        chipText: data.project?.project_name ?? data.quotation.title,
        companyDisplayName: data.companyProfile.displayName,
        note,
        quotationNo: data.quotation.quotation_no,
        title,
      };
      if (main) {
        const layoutSource = settings.mainSectionOverrides[section.id]?.layoutImageUrl
          ? data.mainLayoutImageUrlById[section.id] ?? null
          : null;
        await addSectionSlide(slide, {
          ...shared,
          eyebrow: `Space overview \u00b7 ${String(mainSections.findIndex((entry) => entry.id === section.id) + 1).padStart(2, "0")}`,
          layoutSource,
        });
      } else {
        const parent = section.parent_section_id ? activeSections.find((entry) => entry.id === section.parent_section_id) : null;
        const pageCount = productPagesBySection.get(section.id)?.length ?? 0;
        const visuals = [
          { key: "area" as const, label: "Area Image", source: data.sectionOverrideImageUrlBySectionAndField[`${section.id}:areaImageUrl`] },
          { key: "snapshot" as const, label: "Section Layout Snapshot", source: data.sectionOverrideImageUrlBySectionAndField[`${section.id}:sectionLayoutImageUrl`] },
        ].filter((visual): visual is { key: "area" | "snapshot"; label: string; source: string } => Boolean(visual.source));
        await addAreaSlide(slide, {
          ...shared,
          count: pageCount ? `${pageCount} product ${pageCount === 1 ? "page" : "pages"} follow` : "Section overview",
          eyebrow: `Area \u00b7 ${String(dividerSections.findIndex((entry) => entry.id === section.id) + 1).padStart(2, "0")}`,
          visuals,
          within: parent && parent.id !== section.id ? titledSectionsById.get(parent.id) ?? parent.section_title : null,
        });
      }
      continue;
    }

    if (slideDef.type === "product") {
      const section = slideDef.section;
      const item = slideDef.itemIds
        .map((itemId) => (presentableItemsBySection.get(section.id) ?? []).find((entry) => entry.id === itemId) ?? null)
        .find((entry): entry is PresentationItem => Boolean(entry));
      if (item) {
        const override = settings.itemOverrides[item.id];
        const product = productPageData(item, data, effectivePresentationImageUrlByItemId);
        const originDisplay = formatBrandOriginSupplier({ brandName: item.brand_name_snapshot, origin: item.origin_snapshot, supplier: item.supplier_name_snapshot });
        const visibleBrandOrigin = [settings.contentVisibility.brand ? originDisplay.brand : null, settings.contentVisibility.origin ? originDisplay.origin : null].filter(Boolean).join(" - ");
        await addProductSlide(slide, {
          cache: imageCache,
          frameSize: override?.imageFrameSize ?? "current",
          imageRect: override?.imageRect ?? null,
          imageScale: override?.imageScale ?? 1,
          itemNumber: productNumberById.get(item.id) ?? 1,
          positionX: override?.imagePositionX ?? 50,
          positionY: override?.imagePositionY ?? 50,
          preparedBy: data.companyProfile.displayName,
          product,
          quotationNo: data.quotation.quotation_no,
          sectionTitle: titledSectionsById.get(section.id) ?? section.section_title,
          showSpecification: settings.contentVisibility.specification,
          summary: visibleBrandOrigin || item.category_name_snapshot?.trim() || data.project?.project_name || null,
        });
      }
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
