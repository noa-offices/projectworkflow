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
const USE_ARIAL_FALLBACK = false;
// Windows family names (name ID 1) from the official Geist static TTF name tables.
const GEIST_FONTS = {
  light: USE_ARIAL_FALLBACK ? "Arial" : "Geist Light",
  regular: USE_ARIAL_FALLBACK ? "Arial" : "Geist",
  medium: USE_ARIAL_FALLBACK ? "Arial" : "Geist Medium",
  semibold: USE_ARIAL_FALLBACK ? "Arial" : "Geist SemiBold",
} as const;
const SINGLE_PRODUCT_LAYOUT = {
  width: 11.6929, // PresentationPage: 297mm
  height: 8.2677, // PresentationPage: 210mm
  pxPerInch: 96, // CSS reference pixel
  ptPerPx: 0.75, // CSS px to PowerPoint pt
  zero: 0, // margin-0 / top-left origin
  one: 1, // one CSS border pixel / first item number
  columns: 2, // grid-cols-2
  leftFraction: 1.65, // grid-cols-[1.65fr_0.9fr]
  rightFraction: 0.9, // grid-cols-[1.65fr_0.9fr]
  leftPaddingX: 36, // px-9
  leftPaddingY: 32, // py-8
  rightPaddingX: 32, // px-8
  rightPaddingY: 36, // py-9
  headingZone: 220, // grid-rows-[220px_auto_1fr_96px]
  footerZone: 96, // grid-rows: 96px, h-[96px]
  gap2: 2, // mt-0.5
  gap4: 4, // mt-1 / gap-y-1
  gap8: 8, // mt-2 / gap-2 / p-2
  gap12: 12, // mt-3 / pt-3 / gap-y-3 / px-3
  gap16: 16, // mt-4 / gap-4 / px-4
  gap20: 20, // mt-5 / pb-5 / pt-5 / gap-x-5
  gap24: 24, // gap-6 / gap-x-6
  labelPx: 10, // text-[10px]
  labelLinePx: 15, // text-[10px], inherited normal line-height 1.5
  labelTracking: 0.24, // tracking-[0.24em]
  badgeTracking: 0.2, // tracking-[0.2em]
  titlePx: 24, // text-2xl
  titleLinePx: 32, // text-2xl default line-height
  detailTitlePx: 30, // text-3xl
  detailTitleLinePx: 36, // text-3xl default line-height
  titleTracking: -0.025, // tracking-tight
  titleLines: 2, // clampStyle(2)
  bodyPx: 14, // text-sm
  bodyLinePx: 24, // leading-6
  bodyDefaultLinePx: 20, // text-sm default line-height
  summaryLines: 2, // clampStyle(2)
  specificationLines: 5, // clampStyle(5)
  emptySpecificationLinePx: 28, // leading-7
  finishLimit: 4, // compactFinishes.slice(0, 4)
  finishSwatchPx: 28, // h-7 w-7 / grid-cols-[28px_1fr]
  finishRadiusPx: 8, // rounded-lg
  finishLabelPx: 9, // text-[9px]
  finishLabelLinePx: 13.5, // text-[9px], inherited normal line-height 1.5
  finishTracking: 0.16, // tracking-[0.16em]
  finishValuePx: 11, // text-[11px]
  finishValueLinePx: 16, // leading-4
  finishValueLines: 2, // clampStyle(2)
  moreTracking: 0.18, // tracking-[0.18em]
  optionalPx: 9, // left title badge text-[9px]
  optionalPaddingX: 6, // px-1.5
  optionalPaddingY: 2, // py-0.5
  optionalLineFactor: 1.5, // inherited normal line-height
  badgeRadius: 0.5, // rounded-full: radius bounded by half the height
  averageGlyphEm: 0.6, // intrinsic badge/area width approximation; native text metrics differ
  placeholderMinHeightMm: 120, // min-h-[120mm]
  placeholderMaxWidthPx: 448, // max-w-md
  placeholderLines: 3, // clampStyle(3)
  imageBounds: {
    current: { width: 0.82, height: 0.72 }, // presentationImageBoundsClass: w-[82%] h-[72%]
    medium: { width: 0.72, height: 0.62 }, // w-[72%] h-[62%]
    small: { width: 0.62, height: 0.52 }, // w-[62%] h-[52%]
  },
  positionDefault: 50, // object-position / transform-origin: 50% 50%
  percent: 100, // CSS percentage denominator
  scaleDefault: 1, // PresentationImageStage: scale(1)
  half: 0.5, // CSS half-leading: (line-height - font-size) / 2
  glyphSpaceEm: 0.25, // approximate Geist metrics for CSS intrinsic wrapping
  glyphNarrowEm: 0.25, // approximate narrow glyph width
  glyphNormalEm: 0.5, // approximate lowercase glyph width
  glyphUpperEm: 0.65, // approximate uppercase/digit width
  glyphWideEm: 0.85, // approximate wide glyph width
  imageHeader: {
    pngLength: 24, pngSignatureLength: 8, pngWidth: 16, pngHeight: 20, // PNG IHDR offsets
    jpegMinimum: 4, jpegStart: 2, marker: 0xff, startOfImage: 0xd8, // JPEG SOI / marker prefix
    endOfImage: 0xd9, startOfScan: 0xda, stuffed: 0x00, temporary: 0x01, // JPEG markers without dimensions
    restartStart: 0xd0, restartEnd: 0xd7, // standalone JPEG restart markers
    segmentLengthBytes: 2, frameHeight: 3, frameWidth: 5, frameMinimum: 7, // JPEG SOF segment offsets
    frames: [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf], // JPEG SOF markers
  },
  edgeTrim: {
    maximumPercent: 0.01, // remove at most 1% from each image edge
    minimumBrightness: 220, // light-grey / white CSS-hidden edge strip
    maximumChannelDifference: 12, // neutral strip: R, G, and B remain close
    minimumAlpha: 250, // opaque edge strip only
    maximumTransparentAlpha: 5, // transparent pixels just inside a partial-height edge strip
    insideColumns: 3, // inspect a few columns inside the outer 1% strip
  },
  white: "FFFFFF", // bg-white
  panel: "F3F4F6", // bg-[#f3f4f6]
  dark: "09090B", // text-zinc-950
  text: "18181B", // text-zinc-900
  summary: "3F3F46", // text-zinc-700
  muted: "52525B", // text-zinc-600
  label: "71717A", // text-zinc-500
  lightLabel: "A1A1AA", // text-zinc-400
  border: "E4E4E7", // border-zinc-200
  badgeBorder: "D4D4D8", // border-zinc-300
  panelBorder: "DEDFE1", // border-zinc-900/10 over #f3f4f6
  finishBackground: "FAFAFB", // bg-white/55 over #f3f4f6
  swatchBackground: "F4F4F5", // gradient fallback start #f4f4f5
  redText: "B91C1C", // text-red-700
  redBorder: "FCA5A5", // border-red-300
  redBackground: "FEF2F2", // bg-red-50
  skyText: "0369A1", // text-sky-700
  skyBorder: "7DD3FC", // border-sky-300
  skyBackground: "F0F9FF", // bg-sky-50
} as const;
const PAGE_MARGIN = 0.55;
// Browser CSS dimensions are kept in px; these renderers convert only at the PPTX boundary.
const COVER_LAYOUT = {
  width: 1122.5184, // 297mm at 96px/in
  height: 793.6992, // 210mm at 96px/in
  px: 96, // CSS px per inch
  pt: 0.75, // CSS px to pt
  zero: 0, // zero inner margins / origin
  one: 1, // h-px / border
  two: 2, // grid-cols-2 / half-leading
  pad: 48, // px-12 py-12
  sideX: 36, // px-9
  sideY: 40, // py-10
  leftFr: 1.5, // grid-cols-[1.5fr_0.7fr]
  rightFr: 0.7, // grid-cols-[1.5fr_0.7fr]
  blackWidth: 0.3, // w-[30%]
  radialWidth: 0.44, // w-[44%]
  radialStop: 0.55, // transparent_55%
  gradientAngle: 130, // linear-gradient(130deg,...)
  gradientStop: 0.44, // #f8fafc 44%, #ffffff 44%
  radialOpacity: 0.08, // rgba(39,39,42,0.08)
  pngWidth: 2339, // requested ~200dpi background
  pngHeight: 1654, // requested ~200dpi background
  fullTurn: 180, // degrees to radians
  gap4: 4, // mt-1
  gap8: 8, // mt-2
  gap12: 12, // gap-3 / py-3
  gap16: 16, // mt-4 / px-4 / gap-4
  gap28: 28, // pt-7
  gap32: 32, // mt-8 / pt-8
  gap40: 40, // mt-10 / gap-10
  labelSize: 11, // text-[11px]
  labelLine: 16.5, // normal 1.5 line-height
  labelTracking: 0.32, // tracking-[0.32em]
  smallSize: 10, // text-[10px]
  smallLine: 15, // normal 1.5 line-height
  smallTracking: 0.24, // tracking-[0.24em]
  titleSize: 56, // text-[56px]
  titleLeading: 1.02, // leading-[1.02]
  titleTracking: -0.04, // tracking-[-0.04em]
  paragraphSize: 18, // text-lg
  paragraphLine: 32, // leading-8
  paragraphMax: 672, // max-w-2xl
  projectSize: 24, // text-2xl
  projectLeading: 1.25, // leading-tight
  bodySize: 14, // text-sm
  bodyLine: 20, // text-sm default line-height
  contactLine: 24, // leading-6
  preparedTracking: 0.16, // tracking-[0.16em]
  lineWidth: 56, // w-14
  cardLeftFr: 1.1, // grid-cols-[1.1fr_0.9fr]
  cardRightFr: 0.9, // grid-cols-[1.1fr_0.9fr]
  cardRadius: 16, // rounded-2xl
  logoWidth: 150, // max-w-[150px]
  logoHeight: 56, // max-h-14
  glyphEm: 0.52, // intrinsic text-width estimate (PowerPoint/browser metrics differ)
  white: "FFFFFF", // bg-white
  black: "09090B", // bg-zinc-950
  dark: "09090B", // text-zinc-950
  text: "18181B", // text-zinc-900
  grey: "52525B", // text-zinc-600
  label: "71717A", // text-zinc-500
  light: "A1A1AA", // text-zinc-400
  border: "E4E4E7", // border-zinc-200
  lightBorder: "D4D4D8", // bg-zinc-300
  white45: "787879", // text-white/45 over zinc-950
  white70: "B5B5B6", // text-white/70 over zinc-950
  white90: "E6E6E7", // text-white/90 over zinc-950
  whiteBorder: "222224", // border-white/10 over zinc-950
  cardTransparency: 20, // bg-white/80
  channelWhite: 255, // brightness-0 invert: white RGB, preserve alpha
} as const;
const CLOSING_LAYOUT = { ...COVER_LAYOUT }; // same cover/closing CSS family
const DESIGN_LAYOUT = {
  ...COVER_LAYOUT,
  padY: 44, // py-11
  columnGap: 48, // gap-12
  leftFr: 0.9, // grid-cols-[0.9fr_1.1fr]
  rightFr: 1.1, // grid-cols-[0.9fr_1.1fr]
  columnPadding: 40, // pr-10
  titleSize: 48, // text-5xl
  titleLine: 48, // text-5xl default line-height
  titleGap: 20, // mt-5
  ruleWidth: 80, // w-20
  paragraphSize: 16, // text-base
  paragraphLine: 28, // leading-7
  paragraphMax: 384, // max-w-sm
  itemColumns: 2, // grid-cols-2
  itemRows: 4, // eight items in two columns
  itemGapX: 32, // gap-x-8
  itemGapY: 20, // gap-y-5
  itemPadding: 16, // pt-4
  itemTitle: 16, // text-base
  itemTitleLine: 24, // text-base default line-height
  itemTitleTracking: 0.12, // tracking-[0.12em]
  numberTracking: 0.22, // tracking-[0.22em]
} as const;
const MAIN_AREA_LAYOUT = {
  ...COVER_LAYOUT,
  sidebar: 96, // w-24
  left: 144, // pl-36
  right: 56, // px-14
  titleSize: 60, // text-6xl
  titleTracking: -0.045, // tracking-[-0.045em]
  titleGap: 28, // mt-7
  paragraphMax: 768, // max-w-3xl
  ruleWidth: 64, // w-16
  badgeTracking: 0.24, // tracking-[0.24em]
  visualPad: 16, // p-4
  visualLabelTracking: 0.22, // tracking-[0.22em]
  background: "FFFFFF", // PPT-3 explicit white-page requirement overrides CSS #f4f6f8
} as const;
const AREA_LAYOUT = { ...MAIN_AREA_LAYOUT }; // same area/section CSS geometry
const editorialBackgroundCache = new Map<"cover" | "design", Promise<string>>();

function editorialBackground(family: "cover" | "design") {
  let cached = editorialBackgroundCache.get(family);
  if (!cached) {
    const l = COVER_LAYOUT;
    const angle = l.gradientAngle * Math.PI / l.fullTurn;
    const dx = Math.sin(angle), dy = -Math.cos(angle);
    const length = Math.abs(l.width * dx) + Math.abs(l.height * dy);
    const x1 = (l.width - dx * length) / l.two, y1 = (l.height - dy * length) / l.two;
    const x2 = (l.width + dx * length) / l.two, y2 = (l.height + dy * length) / l.two;
    const radialWidth = l.width * l.radialWidth;
    const radius = Math.hypot(radialWidth, l.height) * l.radialStop;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}"><defs><linearGradient id="linear" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="#eef2f5"/><stop offset="${l.gradientStop}" stop-color="#f8fafc"/><stop offset="${l.gradientStop}" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff"/></linearGradient><radialGradient id="radial" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${radius}"><stop offset="0" stop-color="#27272a" stop-opacity="${l.radialOpacity}"/><stop offset="1" stop-color="#27272a" stop-opacity="0"/></radialGradient></defs><rect width="${l.width}" height="${l.height}" fill="url(#linear)"/>${family === "cover" ? `<rect width="${radialWidth}" height="${l.height}" fill="url(#radial)"/>` : ""}</svg>`;
    cached = sharp(Buffer.from(svg)).resize(l.pngWidth, l.pngHeight).png().toBuffer()
      .then((png) => `data:image/png;base64,${png.toString("base64")}`);
    editorialBackgroundCache.set(family, cached);
    cached.catch(() => editorialBackgroundCache.delete(family));
  }
  return cached;
}
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
    width: SINGLE_PRODUCT_LAYOUT.width,
    height: SINGLE_PRODUCT_LAYOUT.height,
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

    // PPT-3 renderers use CSS-pixel geometry. Product rendering below is unchanged.
    if (["cover", "design", "main-area", "section", "thank-you"].includes(slideDef.type)) {
      const l = COVER_LAYOUT;
      const inch = (px: number) => px / l.px;
      const pt = (px: number) => px * l.pt;
      const measure = (value: string, width: number, size: number, leading: number, tracking = l.zero as number) => {
        let rows: number = l.one, used: number = l.zero;
        for (const word of value.split(/(\s+)/)) {
          if (word.includes("\n")) { rows += word.split("\n").length - l.one; used = l.zero; continue; }
          const w = word.length * size * (l.glyphEm + tracking);
          if (used && used + w > width && word.trim()) { rows += l.one; used = l.zero; }
          if (word.trim() || used) used += w;
          while (used > width && width > l.zero) { rows += l.one; used -= width; }
        }
        return rows * size * leading;
      };
      const text = (value: string | null | undefined, x: number, y: number, w: number, h: number,
        size: number, face: string, color: string, leading = l.one as number, tracking = l.zero as number,
        align: "left" | "right" | "center" = "left", wrap = true) => {
        if (!value) return;
        slide.addText(value, { x: inch(x), y: inch(y - Math.max(l.zero, size * leading - size) / l.two),
          w: inch(w), h: inch(h), fontFace: face, fontSize: pt(size), color,
          margin: l.zero, valign: "top", wrap, charSpacing: pt(size * tracking),
          lineSpacing: pt(size * leading), paraSpaceAfter: l.zero, align });
      };
      const label = (value: string, x: number, y: number, w: number, color = l.label as string,
        size = l.smallSize as number, tracking = l.smallTracking as number, align: "left" | "right" | "center" = "left", wrap = true) =>
        text(value.toUpperCase(), x, y, w, size * l.leftFr, size, GEIST_FONTS.semibold, color, l.leftFr, tracking, align, wrap);
      const line = (x: number, y: number, w: number, color = l.border as string, h = l.zero as number) =>
        slide.addShape("line", { x: inch(x), y: inch(y), w: inch(w), h: inch(h), line: { color, pt: pt(l.one) } });
      const box = (x: number, y: number, w: number, h: number, fill: string, border = fill,
        radius = l.zero as number, transparency = l.zero as number) => {
        slide.addShape(radius ? "roundRect" : RECT_SHAPE, { x: inch(x), y: inch(y), w: inch(w), h: inch(h),
          fill: { color: fill, transparency }, line: { color: border, pt: border === fill ? l.zero : pt(l.one) },
          ...(radius ? { rectRadius: inch(radius), radius: inch(radius) } : {}) });
      };
      const picture = async (source: string | null, x: number, y: number, w: number, h: number, white = false) => {
        const encoded = await imageDataUri(source, imageCache);
        if (!encoded) return null;
        try {
          const pipeline = sharp(Buffer.from(encoded.slice(encoded.indexOf(",") + l.one), "base64"), { animated: false }).rotate().ensureAlpha();
          // CSS brightness-0 invert: turn RGB white while retaining the image alpha channel.
          if (white) pipeline.linear(l.zero, l.channelWhite);
          const result = await pipeline.png().toBuffer({ resolveWithObject: true });
          const scale = Math.min(w / result.info.width, h / result.info.height);
          const iw = result.info.width * scale, ih = result.info.height * scale;
          slide.addImage({ data: `data:image/png;base64,${result.data.toString("base64")}`,
            x: inch(x + (w - iw) / l.two), y: inch(y), w: inch(iw), h: inch(ih) });
          return { width: iw, height: ih };
        } catch { return null; }
      };
      const date = data.quotation.quotation_date
        ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(data.quotation.quotation_date))
        : null;

      if (slideDef.type === "cover" || slideDef.type === "thank-you") {
        const closing = slideDef.type === "thank-you";
        const c = closing ? CLOSING_LAYOUT : COVER_LAYOUT;
        slide.addImage({ data: await editorialBackground("cover"), x: inch(l.zero), y: inch(l.zero), w: inch(c.width), h: inch(c.height) });
        box(c.width * (l.one - c.blackWidth), l.zero, c.width * c.blackWidth, c.height, c.black);
        const leftWidth = c.width * c.leftFr / (c.leftFr + c.rightFr);
        const contentWidth = leftWidth - c.pad * l.two;
        const sideX = leftWidth + c.sideX, sideWidth = c.width - leftWidth - c.sideX * l.two;
        line(c.pad, c.pad + c.labelLine / l.two, c.lineWidth, c.light);
        label(closing ? "Closing Slide" : "Client Presentation", c.pad + c.lineWidth + c.gap12, c.pad,
          contentWidth - c.lineWidth - c.gap12, c.label, c.labelSize, c.labelTracking);
        const title = (closing ? closingTitle : coverTitle) || "";
        // PPT positions a line box below its first glyph; this cancels the measured 8px first-line offset.
        const titleY = c.pad + c.labelLine + c.gap40 - c.gap8;
        const titleHeight = measure(title, contentWidth, c.titleSize, c.titleLeading, c.titleTracking);
        text(title, c.pad, titleY, contentWidth, titleHeight, c.titleSize, GEIST_FONTS.light, c.dark, c.titleLeading, c.titleTracking);
        const paragraph = closing ? closingMessage : coverSubtitle;
        if (paragraph) {
          const width = Math.min(contentWidth, c.paragraphMax);
          text(paragraph, c.pad, titleY + titleHeight + c.gap32, width,
            measure(paragraph, width, c.paragraphSize, c.paragraphLine / c.paragraphSize),
            c.paragraphSize, GEIST_FONTS.regular, c.grey, c.paragraphLine / c.paragraphSize);
        }
        const cards = [{ label: "Project / Quote No.", value: data.quotation.quotation_no }, { label: "Date", value: date }]
          .filter((card): card is { label: string; value: string } => Boolean(card.value));
        const cardWidth = (contentWidth - c.gap40) * c.cardRightFr / (c.cardLeftFr + c.cardRightFr);
        const cardX = c.pad + contentWidth - cardWidth;
        const cardHeight = c.gap12 * l.two + c.smallLine + c.gap4 + c.bodyLine + c.one * l.two;
        const cardStackHeight = cards.length * cardHeight + Math.max(l.zero, cards.length - l.one) * c.gap12;
        const footerY = c.height - c.pad - cardStackHeight - c.gap32 - c.one;
        line(c.pad, footerY, contentWidth);
        cards.forEach((card, index) => {
          const y = footerY + c.gap32 + c.one + index * (cardHeight + c.gap12);
          box(cardX, y, cardWidth, cardHeight, c.white, c.border, c.cardRadius, c.cardTransparency);
          label(card.label, cardX + c.gap16, y + c.gap12, cardWidth - c.gap16 * l.two, c.light);
          text(card.value, cardX + c.gap16, y + c.gap12 + c.smallLine + c.gap4,
            cardWidth - c.gap16 * l.two, c.bodyLine, c.bodySize, GEIST_FONTS.semibold, c.text, c.bodyLine / c.bodySize);
        });
        if (!closing) {
          const projectWidth = contentWidth - cardWidth - c.gap40;
          let projectY = footerY + c.gap32;
          if (coverProjectDisplayName) {
            label("Project", c.pad, projectY, projectWidth, c.light);
            projectY += c.smallLine + c.gap8;
            const projectHeight = measure(coverProjectDisplayName, projectWidth, c.projectSize, c.projectLeading);
            text(coverProjectDisplayName, c.pad, projectY, projectWidth, projectHeight,
              c.projectSize, GEIST_FONTS.light, c.dark, c.projectLeading);
            projectY += projectHeight + c.gap16;
          }
          if (coverClientDisplayName) text(`Prepared for ${coverClientDisplayName}`.toUpperCase(), c.pad, projectY,
            projectWidth, measure(coverClientDisplayName, projectWidth, c.bodySize, c.bodyLine / c.bodySize, c.preparedTracking),
            c.bodySize, GEIST_FONTS.medium, c.label, c.bodyLine / c.bodySize, c.preparedTracking);
        }
        let logoSource = data.companyProfile.logoUrl || "/noa-logo.png";
        try { if (["noaoffices.com", "www.noaoffices.com"].includes(new URL(logoSource).hostname.toLowerCase())) logoSource = "/noa-logo.png"; } catch { /* Local asset path. */ }
        const logo = await picture(logoSource, sideX, c.sideY, Math.min(sideWidth, c.logoWidth), c.logoHeight, true);
        if (!logo) text(closing ? data.companyProfile.displayName : coverPreparedBy || data.companyProfile.displayName,
          sideX, c.sideY, sideWidth, c.projectSize * c.projectLeading, c.projectSize, GEIST_FONTS.light, c.white, c.projectLeading);
        if (!closing && coverWebsite) text(coverWebsite, sideX, c.sideY + (logo?.height ?? c.logoHeight) + c.gap16, sideWidth,
          c.contactLine, c.bodySize, GEIST_FONTS.regular, c.white70, c.contactLine / c.bodySize);
        const contacts = closing
          ? [{ label: "Website", value: closingWebsite }, { label: "Email", value: closingEmail }, { label: "Phone", value: closingPhone }, { label: "Office", value: closingOfficeDetails }]
          : [{ label: "Prepared By", value: coverPreparedBy }];
        const visibleContacts = contacts.filter((entry): entry is { label: string; value: string } => Boolean(entry.value));
        const contactHeights = visibleContacts.map((entry, index) => c.smallLine + c.gap4
          + measure(entry.value, sideWidth, c.bodySize, c.contactLine / c.bodySize)
          + (index < visibleContacts.length - l.one ? c.gap12 + c.one : l.zero));
        const contactsHeight = contactHeights.reduce<number>((sum, height) => sum + height, l.zero)
          + Math.max(l.zero, visibleContacts.length - l.one) * c.gap16;
        let contactY = c.height - c.sideY - contactsHeight;
        line(sideX, contactY - c.gap28, sideWidth, c.whiteBorder);
        visibleContacts.forEach((entry, index) => {
          label(entry.label, sideX, contactY, sideWidth, c.white45);
          text(entry.value, sideX, contactY + c.smallLine + c.gap4, sideWidth,
            contactHeights[index], c.bodySize, GEIST_FONTS.medium, closing ? c.white90 : c.white, c.contactLine / c.bodySize);
          if (index < visibleContacts.length - l.one) line(sideX, contactY + contactHeights[index], sideWidth, c.whiteBorder);
          contactY += contactHeights[index] + c.gap16;
        });
      } else if (slideDef.type === "design") {
        const d = DESIGN_LAYOUT;
        slide.addImage({ data: await editorialBackground("design"), x: inch(l.zero), y: inch(l.zero), w: inch(d.width), h: inch(d.height) });
        const innerWidth = d.width - d.pad * l.two;
        const leftWidth = (innerWidth - d.columnGap) * d.leftFr / (d.leftFr + d.rightFr);
        const dividerX = d.pad + leftWidth;
        const rightX = dividerX + d.columnGap, rightWidth = d.width - d.pad - rightX;
        line(dividerX, d.padY, l.zero, d.border, d.height - d.padY * l.two);
        const leftTextWidth = leftWidth - d.columnPadding - d.one;
        label("Design Considerations", d.pad, d.padY, leftTextWidth, d.label, d.labelSize, d.labelTracking);
        const titleY = d.padY + d.labelLine + d.titleGap;
        text("Design", d.pad, titleY, leftTextWidth, d.titleLine, d.titleSize, GEIST_FONTS.light, d.dark, l.one, d.titleTracking);
        text("Considerations", d.pad, titleY + d.titleLine, leftTextWidth, d.titleLine, d.titleSize, GEIST_FONTS.light, d.grey, l.one, d.titleTracking);
        line(d.pad, titleY + d.titleLine * l.two + d.gap32, d.ruleWidth, d.lightBorder);
        const paragraph = "Core principles reviewed when aligning furniture choices with workflow, brand expression, and long-term performance.";
        const paragraphWidth = Math.min(leftTextWidth, d.paragraphMax);
        const paragraphHeight = measure(paragraph, paragraphWidth, d.paragraphSize, d.paragraphLine / d.paragraphSize);
        const overviewY = d.height - d.padY - d.smallLine;
        label("Editorial Overview", d.pad, overviewY, leftTextWidth, d.light);
        text(paragraph, d.pad, overviewY - d.gap32 - paragraphHeight, paragraphWidth, paragraphHeight,
          d.paragraphSize, GEIST_FONTS.regular, d.grey, d.paragraphLine / d.paragraphSize);
        const itemWidth = (rightWidth - d.itemGapX) / d.itemColumns;
        const rowHeights = Array.from({ length: d.itemRows }, (_, row) => Math.max(...designConsiderations.slice(row * d.itemColumns, (row + l.one) * d.itemColumns).map((entry) =>
          d.one + d.itemPadding + d.smallLine + d.gap8
          + measure(entry.title.toUpperCase(), itemWidth, d.itemTitle, d.itemTitleLine / d.itemTitle, d.itemTitleTracking)
          + d.gap12 + measure(entry.body, itemWidth, d.bodySize, d.contactLine / d.bodySize))));
        // CSS grid starts at the same 44px top edge as the left label and divider.
        let rowY = d.padY;
        designConsiderations.forEach((entry, index) => {
          const column = index % d.itemColumns, row = Math.floor(index / d.itemColumns);
          const x = rightX + column * (itemWidth + d.itemGapX);
          line(x, rowY, itemWidth);
          label(String(index + l.one).padStart(l.two, "0"), x, rowY + d.one + d.itemPadding, itemWidth, d.light, d.smallSize, d.numberTracking);
          const titleY = rowY + d.one + d.itemPadding + d.smallLine + d.gap8;
          const titleHeight = measure(entry.title.toUpperCase(), itemWidth, d.itemTitle, d.itemTitleLine / d.itemTitle, d.itemTitleTracking);
          text(entry.title.toUpperCase(), x, titleY, itemWidth, titleHeight, d.itemTitle, GEIST_FONTS.semibold, d.text, d.itemTitleLine / d.itemTitle, d.itemTitleTracking);
          text(entry.body, x, titleY + titleHeight + d.gap12, itemWidth,
            measure(entry.body, itemWidth, d.bodySize, d.contactLine / d.bodySize), d.bodySize, GEIST_FONTS.regular, d.grey, d.contactLine / d.bodySize);
          if (column === d.itemColumns - l.one) rowY += rowHeights[row] + d.itemGapY;
        });
      } else if (slideDef.type === "main-area" || slideDef.type === "section") {
        const main = slideDef.type === "main-area";
        const a = main ? MAIN_AREA_LAYOUT : AREA_LAYOUT;
        const section = main ? slideDef.mainSection : slideDef.section;
        const title = (main ? mainSectionTitlesById : titledSectionsById).get(section.id) ?? section.section_title;
        const note = main ? resolvedOverrideValue(settings.mainSectionOverrides[section.id]?.note, section.section_notes) : sectionPresentationNote(section, settings);
        const contentWidth = a.width - a.left - a.right;
        box(l.zero, l.zero, a.width, a.height, a.background);
        box(l.zero, l.zero, a.sidebar, a.height, a.black);
        const heading = main ? "SPACE OVERVIEW" : "AREA";
        label(heading, a.left, a.pad, contentWidth, a.label, a.labelSize, a.labelTracking);
        const labelWidth = heading.length * a.labelSize * (a.glyphEm + a.labelTracking);
        line(a.left + labelWidth + a.gap16, a.pad + a.labelLine / l.two, a.ruleWidth, a.lightBorder);
        const titleY = a.pad + a.labelLine + a.titleGap;
        const titleHeight = measure(title, contentWidth, a.titleSize, a.titleLeading, a.titleTracking);
        text(title, a.left, titleY, contentWidth, titleHeight, a.titleSize, GEIST_FONTS.light, a.dark, a.titleLeading, a.titleTracking);
        let visualY = titleY + titleHeight;
        if (note) {
          const noteWidth = Math.min(a.paragraphMax, contentWidth);
          const noteHeight = measure(note, noteWidth, a.paragraphSize, a.paragraphLine / a.paragraphSize);
          text(note, a.left, visualY + a.titleGap, noteWidth, noteHeight, a.paragraphSize, GEIST_FONTS.regular, a.grey, a.paragraphLine / a.paragraphSize);
          visualY += a.titleGap + noteHeight;
        }
        const sectionSettings = settings.sectionOverrides[section.id];
        const signedSources = (data as LoadedQuotationPresentationData & {
          sectionOverrideImageUrlBySectionAndField?: Record<string, string | null>;
        }).sectionOverrideImageUrlBySectionAndField;
        const visuals = main
          ? (settings.mainSectionOverrides[section.id]?.layoutImageUrl && data.mainLayoutImageUrlById[section.id]
            ? [{ label: "Full Floor Layout", source: data.mainLayoutImageUrlById[section.id] }] : [])
          : [{ label: "Area Image", source: signedSources?.[`${section.id}:areaImageUrl`] ?? sectionSettings?.areaImageUrl },
            { label: "Section Layout Snapshot", source: signedSources?.[`${section.id}:sectionLayoutImageUrl`] ?? sectionSettings?.sectionLayoutImageUrl }]
            .filter((entry): entry is { label: string; source: string } => Boolean(entry.source));
        const parent = section.parent_section_id ? activeSections.find((entry) => entry.id === section.parent_section_id) : null;
        const parentTitle = parent ? titledSectionsById.get(parent.id) ?? parent.section_title : null;
        const footerLines = [{ label: main ? `Space ${String(mainSections.findIndex((entry) => entry.id === section.id) + l.one).padStart(l.two, "0")}`
          : `Section ${String(dividerSections.findIndex((entry) => entry.id === section.id) + l.one).padStart(l.two, "0")}`,
          text: main ? (visuals.length ? "Floor layout overview" : "Main area overview")
            : (() => { const count = productPagesBySection.get(section.id)?.length ?? l.zero; return count ? `${count} product ${count === l.one ? "page" : "pages"} follow` : "Section overview"; })() }];
        const footerHeight = a.smallLine + a.gap8 + a.bodyLine + (!main && parentTitle ? a.gap8 + a.bodyLine : l.zero);
        const footerY = a.height - a.pad - footerHeight - a.gap32 - a.one;
        line(a.left, footerY, contentWidth);
        label(footerLines[l.zero].label, a.left, footerY + a.gap32 + a.one, contentWidth, a.light);
        let footerTextY = footerY + a.gap32 + a.one + a.smallLine + a.gap8;
        if (!main && parentTitle) {
          text(`Within ${parentTitle}`, a.left, footerTextY, contentWidth, a.bodyLine, a.bodySize, GEIST_FONTS.medium, a.label, a.bodyLine / a.bodySize);
          footerTextY += a.bodyLine + a.gap8;
        }
        text(footerLines[l.zero].text, a.left, footerTextY, contentWidth, a.bodyLine, a.bodySize, GEIST_FONTS.regular, a.label, a.bodyLine / a.bodySize);
        const badge = data.project?.project_name ?? data.quotation.title;
        const badgeWidth = Math.min(contentWidth, badge.length * a.labelSize * (a.glyphEm + a.badgeTracking) + a.gap16 * l.two + a.one * l.two);
        const badgeHeight = a.labelLine + a.gap8 * l.two + a.one * l.two;
        const badgeX = a.width - a.right - badgeWidth, badgeY = a.height - a.pad - badgeHeight;
        box(badgeX, badgeY, badgeWidth, badgeHeight, a.white, a.lightBorder);
        label(badge, badgeX + a.one, badgeY + (badgeHeight - a.labelLine) / l.two,
          badgeWidth - a.one * l.two, a.label, a.labelSize, a.badgeTracking, "center", false);
        if (visuals.length) {
          visualY += a.gap32;
          const visualWidth = (contentWidth - (visuals.length - l.one) * a.gap16) / visuals.length;
          const visualHeight = Math.max(l.zero, footerY - visualY);
          for (const [index, visual] of visuals.entries()) {
            const x = a.left + index * (visualWidth + a.gap16);
            box(x, visualY, visualWidth, visualHeight, a.white, a.border, l.zero, a.cardTransparency);
            label(visual.label, x + a.visualPad, visualY + a.visualPad, visualWidth - a.visualPad * l.two,
              a.label, a.smallSize, a.visualLabelTracking);
            const imageY = visualY + a.visualPad + a.smallLine + a.gap12;
            if (visualHeight > a.visualPad * l.two + a.smallLine + a.gap12) await picture(visual.source ?? null,
              x + a.visualPad, imageY, visualWidth - a.visualPad * l.two, visualY + visualHeight - a.visualPad - imageY);
          }
        }
      }
      continue;
    }

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

      const l = SINGLE_PRODUCT_LAYOUT;
      const inch = (px: number) => px / l.pxPerInch;
      const pt = (px: number) => px * l.ptPerPx;
      const leftWidth = l.width * l.leftFraction / (l.leftFraction + l.rightFraction);
      const leftX = inch(l.leftPaddingX);
      const leftY = inch(l.leftPaddingY);
      const leftContentWidth = leftWidth - inch(l.leftPaddingX * l.columns);
      const rightX = leftWidth + inch(l.rightPaddingX);
      const rightY = inch(l.rightPaddingY);
      const rightWidth = l.width - leftWidth - inch(l.rightPaddingX * l.columns);
      // Estimate intrinsic CSS wrapping without altering or truncating the text.
      const wrappedLines = (value: string, width: number, sizePx: number, maximum: number, tracking = l.zero as number) => {
        const glyphWidth = (character: string) => {
          const em = /\s/.test(character) ? l.glyphSpaceEm
            : /[ilI.,:;!'|]/.test(character) ? l.glyphNarrowEm
              : /[MWmw@%]/.test(character) ? l.glyphWideEm
                : /[A-Z0-9]/.test(character) ? l.glyphUpperEm : l.glyphNormalEm;
          return sizePx * (em + tracking);
        };
        const limit = width * l.pxPerInch;
        let count: number = l.one;
        let used: number = l.zero;
        for (const word of value.split(/(\s+)/)) {
          if (word.includes("\n")) {
            count += word.split("\n").length - l.one;
            used = l.zero;
            continue;
          }
          const measured = Array.from(word).reduce<number>((sum, character) => sum + glyphWidth(character), l.zero);
          if (used && used + measured > limit && word.trim()) {
            count += l.one;
            used = l.zero;
          }
          if (word.trim() || used) used += measured;
          while (used > limit && limit > l.zero) {
            count += l.one;
            used -= limit;
          }
        }
        return Math.min(maximum, count);
      };
      type TextOptions = NonNullable<Parameters<PptxSlide["addText"]>[1]>;
      const text = (value: string, x: number, y: number, w: number, h: number,
        fontFace: string, sizePx: number, color: string, options: TextOptions = {}) => {
        const lineHeightPx = typeof options.lineSpacing === "number"
          ? options.lineSpacing / l.ptPerPx : sizePx * (options.lineSpacingMultiple ?? l.optionalLineFactor);
        // Remove PowerPoint's extra top leading; retain the CSS line-height for subsequent lines.
        const halfLeading = inch(Math.max(l.zero, lineHeightPx - sizePx) * l.half);
        slide.addText(value, {
          x, y: y - halfLeading, w, h, fontFace, fontSize: pt(sizePx), color,
          margin: l.zero, valign: "top", wrap: true,
          breakLine: false, paraSpaceAfter: l.zero,
          lineSpacingMultiple: l.optionalLineFactor,
          ...options,
        });
      };
      const rect = (x: number, y: number, w: number, h: number, fill: string,
        border = fill, rounded = false) => {
        slide.addShape(rounded ? "roundRect" : RECT_SHAPE, {
          x, y, w, h, fill: { color: fill },
          line: { color: border, pt: border === fill ? l.zero : pt(l.one) },
          ...(rounded ? { rectRadius: Math.min(h * l.badgeRadius, inch(l.finishRadiusPx)) } : {}),
        });
      };
      const line = (x: number, y: number, w: number, color: string) => {
        slide.addShape("line", { x, y, w, h: l.zero, line: { color, pt: pt(l.one) } });
      };
      const label = (value: string, x: number, y: number, w: number, color = l.lightLabel as string,
        options: TextOptions = {}) => text(value.toUpperCase(), x, y, w, inch(l.labelLinePx),
        GEIST_FONTS.semibold, l.labelPx, color,
        { charSpacing: pt(l.labelPx * l.labelTracking), lineSpacingMultiple: l.optionalLineFactor, ...options });

      rect(l.zero, l.zero, leftWidth, l.height, l.white);
      rect(leftWidth, l.zero, l.width - leftWidth, l.height, l.panel);
      const badgeText = `ITEM ${productNumberById.get(item.id) ?? l.one}`;
      const badgeWidth = inch(badgeText.length * l.labelPx * (l.averageGlyphEm + l.badgeTracking)
        + l.gap12 * l.columns + l.one * l.columns);
      const badgeHeight = inch(l.labelLinePx + l.gap4 * l.columns + l.one * l.columns);
      const badgeX = leftWidth - leftX - badgeWidth;
      rect(badgeX, leftY, badgeWidth, badgeHeight, l.white, l.badgeBorder, true);
      label(badgeText, badgeX + inch(l.gap12 + l.one), leftY + inch(l.gap4 + l.one),
        badgeWidth - inch((l.gap12 + l.one) * l.columns), l.label,
        { charSpacing: pt(l.labelPx * l.badgeTracking), align: "center" });
      const titleWidth = leftContentWidth - badgeWidth - inch(l.gap16);
      label(sectionTitle, leftX, leftY, titleWidth);
      const titleY = leftY + inch(l.labelLinePx + l.gap8);
      const titleHeight = inch(l.titleLinePx * wrappedLines(dataForItem.heading, titleWidth, l.titlePx, l.titleLines, l.titleTracking));
      text(dataForItem.heading, leftX, titleY, titleWidth, titleHeight,
        GEIST_FONTS.light, l.titlePx, l.dark,
        { fit: "shrink", charSpacing: pt(l.titlePx * l.titleTracking), lineSpacingMultiple: undefined, lineSpacing: pt(l.titleLinePx) });

      // Inline browser badges become separate editable boxes at the end of the title zone.
      const statusBadges = [
        ...(dataForItem.isOptional ? [{ value: "OPTIONAL", color: l.redText, fill: l.redBackground, border: l.redBorder }] : []),
        ...(dataForItem.isRateOnly ? [{ value: "RATE ONLY", color: l.skyText, fill: l.skyBackground, border: l.skyBorder }] : []),
      ];
      const addStatusBadges = (x: number, y: number, sizePx: number) => {
        let cursor = x;
        for (const badge of statusBadges) {
          const w = inch(badge.value.length * sizePx * l.averageGlyphEm + (l.optionalPaddingX + l.one) * l.columns);
          const h = inch(sizePx * l.optionalLineFactor + (l.optionalPaddingY + l.one) * l.columns);
          rect(cursor, y, w, h, badge.fill, badge.border);
          text(badge.value, cursor + inch(l.optionalPaddingX + l.one), y + inch(l.optionalPaddingY + l.one),
            w - inch((l.optionalPaddingX + l.one) * l.columns), inch(sizePx * l.optionalLineFactor),
            GEIST_FONTS.semibold, sizePx, badge.color, { bold: true });
          cursor += w + inch(l.gap8);
        }
      };
      addStatusBadges(leftX, titleY + titleHeight - inch(l.optionalPx * l.optionalLineFactor), l.optionalPx);

      const stageY = Math.max(titleY + titleHeight, leftY + badgeHeight) + inch(l.gap20);
      const leftFooterTop = l.height - inch(l.leftPaddingY + l.footerZone);
      const stageHeight = leftFooterTop - stageY;
      const itemOverride = settings.itemOverrides[item.id];
      const bounds = l.imageBounds[itemOverride?.imageFrameSize === "small" || itemOverride?.imageFrameSize === "medium"
        ? itemOverride.imageFrameSize : "current"];
      const imageWidth = leftContentWidth * bounds.width;
      const imageHeight = stageHeight * bounds.height;
      const imageX = leftX + (leftContentWidth - imageWidth) * l.half;
      const imageY = stageY + (stageHeight - imageHeight) * l.half;
      const image = await imageDataUri(dataForItem.imageUrl, imageCache);
      if (image) {
        let presentationImage = image;
        let pixels: { width: number; height: number } | null = null;
        try {
          const source = Buffer.from(image.slice(image.indexOf(",") + l.one), "base64");
          const sourceMetadata = await sharp(source, { animated: false }).metadata();
          if (!sourceMetadata.width || !sourceMetadata.height) throw new Error("Image dimensions are unavailable.");
          const requiresPng = sourceMetadata.format !== "png" && sourceMetadata.format !== "jpeg";
          const raw = await sharp(source, { animated: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const channels = raw.info.channels;
          const maximumEdge = Math.floor(raw.info.width * l.edgeTrim.maximumPercent);
          const opaqueNeutralColumn = (column: number, direction: number) => {
            let opaquePixels: number = l.zero;
            let transparentInside = true;
            for (let row = l.zero; row < raw.info.height; row += l.one) {
              const offset = (row * raw.info.width + column) * channels;
              const red = raw.data[offset] ?? l.zero;
              const green = raw.data[offset + l.one] ?? l.zero;
              const blue = raw.data[offset + l.columns] ?? l.zero;
              const alpha = raw.data[offset + channels - l.one] ?? l.zero;
              if (alpha <= l.edgeTrim.maximumTransparentAlpha) continue;
              if (alpha < l.edgeTrim.minimumAlpha || Math.min(red, green, blue) < l.edgeTrim.minimumBrightness
                || Math.max(red, green, blue) - Math.min(red, green, blue) > l.edgeTrim.maximumChannelDifference) return false;
              opaquePixels += l.one;
              const insideColumn = Math.min(raw.info.width - l.one, Math.max(l.zero,
                column + direction * (maximumEdge + l.edgeTrim.insideColumns)));
              const insideAlpha = raw.data[(row * raw.info.width + insideColumn) * channels + channels - l.one] ?? l.zero;
              if (insideAlpha > l.edgeTrim.maximumTransparentAlpha) transparentInside = false;
            }
            return opaquePixels > l.zero && (opaquePixels === raw.info.height || transparentInside);
          };
          let leftTrim = l.zero;
          let rightTrim = l.zero;
          while (leftTrim < maximumEdge && opaqueNeutralColumn(leftTrim, l.one)) leftTrim += l.one;
          while (rightTrim < maximumEdge && opaqueNeutralColumn(raw.info.width - l.one - rightTrim, -l.one)) rightTrim += l.one;
          const needsEdgeTrim = leftTrim > l.zero || rightTrim > l.zero;
          if (requiresPng || needsEdgeTrim) {
            const processed = sharp(source, { animated: false });
            if (needsEdgeTrim) {
              processed.extract({ left: leftTrim, top: l.zero, width: raw.info.width - leftTrim - rightTrim, height: raw.info.height });
            }
            const png = await processed.png().toBuffer();
            const metadata = await sharp(png).metadata();
            if (!metadata.width || !metadata.height) throw new Error("Processed image dimensions are unavailable.");
            presentationImage = `data:image/png;base64,${png.toString("base64")}`;
            pixels = { width: metadata.width, height: metadata.height };
          } else {
            pixels = { width: sourceMetadata.width, height: sourceMetadata.height };
          }
        } catch {
          pixels = null;
        }
        if (pixels && pixels.width > l.zero && pixels.height > l.zero) {
          const contain = Math.min(imageWidth / pixels.width, imageHeight / pixels.height);
          const baseWidth = pixels.width * contain;
          const baseHeight = pixels.height * contain;
          const requestedScale = Number(itemOverride?.imageScale);
          // Clamp zoom rather than crop: preserve an editable picture with its original aspect ratio.
          const scale = Math.min(Number.isFinite(requestedScale) && requestedScale > l.zero ? requestedScale : l.scaleDefault,
            imageWidth / baseWidth, imageHeight / baseHeight);
          const position = (value: unknown) => {
            const number = typeof value === "number" && Number.isFinite(value) ? value : l.positionDefault;
            return Math.min(l.percent, Math.max(l.zero, number)) / l.percent;
          };
          const w = baseWidth * scale;
          const h = baseHeight * scale;
          slide.addImage({ data: presentationImage, x: imageX + (imageWidth - w) * position(itemOverride?.imagePositionX),
            y: imageY + (imageHeight - h) * position(itemOverride?.imagePositionY), w, h, altText: dataForItem.heading });
        } else {
          console.warn(`Single-product PPTX: could not read image dimensions for item ${item.id}; using sizing contain without scale or position.`);
          slide.addImage({ data: image, x: imageX, y: imageY, w: imageWidth, h: imageHeight,
            sizing: { type: "contain", w: imageWidth, h: imageHeight }, altText: dataForItem.heading });
        }
      } else {
        const placeholderY = imageY + (imageHeight - inch(l.labelLinePx + l.gap20 + l.bodyLinePx * l.placeholderLines)) / l.columns;
        label("Visual pending", leftX, placeholderY, leftContentWidth, l.lightLabel, { align: "center" });
        text("No quotation image is available for this item yet. The item remains included so the presentation sequence stays complete.",
          leftX, placeholderY + inch(l.labelLinePx + l.gap20), leftContentWidth, inch(l.bodyLinePx * l.placeholderLines),
          GEIST_FONTS.regular, l.bodyPx, l.label, { align: "center", lineSpacingMultiple: undefined, lineSpacing: pt(l.bodyLinePx) });
      }
      const origin = formatBrandOriginSupplier({ brandName: item.brand_name_snapshot, origin: item.origin_snapshot, supplier: item.supplier_name_snapshot });
      const summary = [settings.contentVisibility.brand ? origin.brand : null, settings.contentVisibility.origin ? origin.origin : null].filter(Boolean).join(" - ")
        || item.category_name_snapshot || data.project?.project_name;
      const areaWidth = item.room_name_snapshot
        ? Math.min(leftContentWidth / l.columns, inch(item.room_name_snapshot.length * l.bodyPx * l.averageGlyphEm + l.gap16 * l.columns))
        : l.zero;
      const summaryWidth = leftContentWidth - (areaWidth ? areaWidth + inch(l.gap24) : l.zero);
      const summaryLineCount = summary ? wrappedLines(summary, summaryWidth, l.bodyPx, l.summaryLines) : l.one;
      const summaryValueHeight = inch(l.bodyLinePx * summaryLineCount);
      const summaryHeight = inch(l.labelLinePx + l.gap4) + summaryValueHeight;
      // The h-[96px] footer has mt-5: its children end 20px below the fixed grid track.
      const leftFooterBottom = l.height - inch(l.leftPaddingY) + inch(l.gap20);
      const summaryY = leftFooterBottom - summaryHeight;
      line(leftX, summaryY - inch(l.gap12), summaryWidth, l.border);
      if (summary) {
        label("Product Summary", leftX, summaryY, summaryWidth);
        text(summary, leftX, summaryY + inch(l.labelLinePx + l.gap4), summaryWidth, summaryValueHeight,
          GEIST_FONTS.medium, l.bodyPx, l.summary, { lineSpacingMultiple: undefined, lineSpacing: pt(l.bodyLinePx) });
      }
      if (item.room_name_snapshot) {
        const areaHeight = inch(l.gap12 * l.columns + l.labelLinePx + l.gap4 + l.bodyDefaultLinePx + l.one * l.columns);
        const areaX = leftWidth - leftX - areaWidth;
        const areaY = leftFooterBottom - areaHeight;
        rect(areaX, areaY, areaWidth, areaHeight, l.white, l.border);
        label("Area Tag", areaX + inch(l.gap16), areaY + inch(l.gap12), areaWidth - inch(l.gap16 * l.columns), l.lightLabel, { align: "right" });
        text(item.room_name_snapshot, areaX + inch(l.gap16), areaY + inch(l.gap12 + l.labelLinePx + l.gap4),
          areaWidth - inch(l.gap16 * l.columns), inch(l.bodyDefaultLinePx), GEIST_FONTS.semibold, l.bodyPx, l.text, { align: "right" });
      }

      label("Technical Details", rightX, rightY, rightWidth, l.label);
      const detailTitleY = rightY + inch(l.labelLinePx + l.gap12);
      const detailTitleHeight = inch(l.detailTitleLinePx * wrappedLines(dataForItem.heading, rightWidth, l.detailTitlePx, l.titleLines, l.titleTracking));
      text(dataForItem.heading, rightX, detailTitleY, rightWidth, detailTitleHeight,
        GEIST_FONTS.light, l.detailTitlePx, l.dark,
        { fit: "shrink", charSpacing: pt(l.detailTitlePx * l.titleTracking), lineSpacingMultiple: undefined, lineSpacing: pt(l.detailTitleLinePx) });
      addStatusBadges(rightX, detailTitleY + detailTitleHeight - inch(l.labelPx * l.optionalLineFactor), l.labelPx);
      const headingBottom = rightY + inch(l.headingZone);
      const specificationY = detailTitleY + detailTitleHeight + inch(l.gap16);
      const specificationLinePx = dataForItem.specification ? l.bodyLinePx : l.emptySpecificationLinePx;
      const specificationHeight = Math.min(inch(l.bodyLinePx * l.specificationLines),
        Math.max(l.zero, headingBottom - inch(l.gap20) - specificationY));
      const specification = dataForItem.specification || "Specification details not added yet.";
      if (settings.contentVisibility.specification) {
        text(specification, rightX,
          specificationY, rightWidth,
          specificationHeight, GEIST_FONTS.regular, l.bodyPx,
          dataForItem.specification ? l.muted : l.lightLabel,
          { lineSpacingMultiple: undefined, lineSpacing: pt(specificationLinePx) });
      }
      line(rightX, headingBottom, rightWidth, l.panelBorder);
      const metaY = headingBottom + inch(l.gap20);
      const metaWidth = (rightWidth - inch(l.gap20)) / l.columns;
      const metaRows = Array.from({ length: Math.ceil(dataForItem.meta.length / l.columns) }, (_, rowIndex) => {
        const entries = dataForItem.meta.slice(rowIndex * l.columns, rowIndex * l.columns + l.columns);
        const cells = entries.map((entry, column) => {
          const last = rowIndex * l.columns + column === dataForItem.meta.length - l.one;
          const valueHeight = inch(l.bodyDefaultLinePx * wrappedLines(entry.value, metaWidth, l.bodyPx, l.titleLines));
          // ProductDetail: gap-1, pb-2.5 and border-b; only the final CELL omits padding/border.
          return { entry, valueHeight, bordered: !last, height: inch(l.labelLinePx + l.gap4)
            + valueHeight + (last ? l.zero : inch(l.labelPx + l.one)) };
        });
        return { cells, height: Math.max(...cells.map((cell) => cell.height)) };
      });
      let metaRowY = metaY;
      metaRows.forEach((metaRow) => {
        metaRow.cells.forEach((cell, column) => {
        const row = cell.entry;
        const x = rightX + column * (metaWidth + inch(l.gap20));
        const y = metaRowY;
        label(row.label, x, y, metaWidth, l.lightLabel, { charSpacing: pt(l.labelPx * DESIGN_LAYOUT.numberTracking) });
        text(row.value, x, y + inch(l.labelLinePx + l.gap4), metaWidth, cell.valueHeight,
          GEIST_FONTS.medium, l.bodyPx, l.text, { lineSpacingMultiple: undefined, lineSpacing: pt(l.bodyDefaultLinePx) });
        if (cell.bordered) line(x, y + metaRow.height - inch(l.one), metaWidth, l.border);
        });
        metaRowY += metaRow.height + inch(l.gap12);
      });
      // CSS: <dl> has gap-y-3; the next block starts with mt-5 and its border.
      const finishesY = metaRowY - inch(l.gap12) + inch(l.gap20);
      line(rightX, finishesY, rightWidth, l.panelBorder);
      if (dataForItem.finishes.length) {
        label("Finishes", rightX, finishesY + inch(l.gap20), rightWidth, l.label);
        const finishWidth = (rightWidth - inch(l.gap8)) / l.columns;
        const finishHeight = inch(l.gap8 * l.columns + l.finishLabelLinePx + l.gap2 + l.finishValueLinePx * l.finishValueLines + l.one * l.columns);
        for (const [index, finish] of dataForItem.finishes.slice(l.zero, l.finishLimit).entries()) {
          const x = rightX + (index % l.columns) * (finishWidth + inch(l.gap8));
          const y = finishesY + inch(l.gap20 + l.labelLinePx + l.gap16) + Math.floor(index / l.columns) * (finishHeight + inch(l.gap8));
          rect(x, y, finishWidth, finishHeight, l.finishBackground, l.panelBorder, true);
          const swatchX = x + inch(l.gap8 + l.one);
          const swatchY = y + inch(l.gap8 + l.one);
          const swatchSize = inch(l.finishSwatchPx);
          rect(swatchX, swatchY, swatchSize, swatchSize, l.swatchBackground);
          const swatch = await imageDataUri(finish.imageUrl, imageCache);
          if (swatch) slide.addImage({ data: swatch, x: swatchX, y: swatchY, w: swatchSize, h: swatchSize,
            sizing: { type: "cover", w: swatchSize, h: swatchSize }, altText: finish.name || finish.label });
          const valueX = swatchX + swatchSize + inch(l.gap8);
          const valueWidth = finishWidth - (valueX - x) - inch(l.gap8 + l.one);
          text(finish.label.toUpperCase(), valueX, swatchY, valueWidth, inch(l.finishLabelLinePx),
            GEIST_FONTS.semibold, l.finishLabelPx, l.label, { charSpacing: pt(l.finishLabelPx * l.finishTracking) });
          text([finish.code, finish.name].filter(Boolean).join(" | ") || finish.description || "Selected finish",
            valueX, swatchY + inch(l.finishLabelLinePx + l.gap2), valueWidth, inch(l.finishValueLinePx * l.finishValueLines),
            GEIST_FONTS.semibold, l.finishValuePx, l.text, { lineSpacingMultiple: undefined, lineSpacing: pt(l.finishValueLinePx) });
        }
        if (dataForItem.finishes.length > l.finishLimit) {
          const rows = Math.ceil(Math.min(dataForItem.finishes.length, l.finishLimit) / l.columns);
          label(`+${dataForItem.finishes.length - l.finishLimit} more`, rightX,
            finishesY + inch(l.gap20 + l.labelLinePx + l.gap16) + rows * (finishHeight + inch(l.gap8)), rightWidth,
            l.lightLabel, { charSpacing: pt(l.labelPx * l.moreTracking) });
        }
      }
      const footerContentHeight = inch(l.gap12 + l.labelLinePx + l.gap4 + l.bodyDefaultLinePx);
      const footerY = l.height - inch(l.rightPaddingY) - footerContentHeight;
      line(rightX, footerY, rightWidth, l.panelBorder);
      const footerColumn = (rightWidth - inch(l.gap24)) / l.columns;
      label("Prepared By", rightX, footerY + inch(l.gap12), footerColumn);
      text(data.companyProfile.displayName, rightX, footerY + inch(l.gap12 + l.labelLinePx + l.gap4),
        footerColumn, inch(l.bodyDefaultLinePx), GEIST_FONTS.semibold, l.bodyPx, l.text);
      if (data.quotation.quotation_no) {
        const quoteX = rightX + footerColumn + inch(l.gap24);
        label("Project / Quote No.", quoteX, footerY + inch(l.gap12), footerColumn, l.lightLabel, { align: "right" });
        text(data.quotation.quotation_no, quoteX, footerY + inch(l.gap12 + l.labelLinePx + l.gap4),
          footerColumn, inch(l.bodyDefaultLinePx), GEIST_FONTS.semibold, l.bodyPx, l.text, { align: "right" });
      }
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
