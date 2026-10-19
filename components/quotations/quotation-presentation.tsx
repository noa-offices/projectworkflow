"use client";

import Link from "next/link";
import {
  ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, CircleAlert, CircleCheck, ClipboardList, Eye, File as FileIcon, FileCheck, FileText,
  Image as ImageIcon, Layers, LayoutGrid, List, ListRestart, Package, RotateCcw, Save, Settings, Settings2, SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ClipboardEvent, type CSSProperties, type ReactNode } from "react";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import { presentationSans, presentationSerif } from "@/components/quotations/presentation-fonts";
import { ProductImageEditBox } from "@/components/quotations/presentation-image-editor";
import { PresentationPptxExportButton } from "@/components/quotations/presentation-pptx-export-button";
import { PrintActions } from "@/components/quotations/print-actions";
import type { CompanyProfile } from "@/lib/company-profile";
import type { ImageDisplaySettings } from "@/lib/image-display-settings";
import { resolveQuotationImageUrl, normalizeStoredImagePath } from "@/lib/quotation-image-path";
import {
  DEFAULT_PRESENTATION_CONTENT_VISIBILITY,
  DEFAULT_PRESENTATION_CLOSING_OVERRIDES,
  DEFAULT_PRESENTATION_COVER_OVERRIDES,
  DEFAULT_PRESENTATION_FLOW_ORDER,
  DEFAULT_PRESENTATION_ITEM_OVERRIDE,
  normalizePresentationImageRect,
  DEFAULT_PRESENTATION_PAGE_VISIBILITY,
  DEFAULT_PRESENTATION_VISUALS,
  normalizeFlowOrder,
  normalizePresentationSettings,
  type PresentationClosingOverrides,
  type PresentationContentVisibility,
  type PresentationCoverOverrides,
  type PresentationFlowOrder,
  type PresentationImageFrameSize,
  type PresentationImageRect,
  type PresentationImageFit,
  type PresentationItemOverride,
  type PresentationLayoutMode,
  type PresentationMainSectionOverride,
  type PresentationPageVisibility,
  type PresentationSectionOverride,
  type QuotationPresentationSettings,
} from "@/lib/quotations/presentation-settings";
import {
  formatBrandOriginSupplier,
  specificationWithoutDuplicateCode,
} from "@/lib/quotations/format-quotation-row";
import {
  uploadQuotationItemImage,
  uploadQuotationPresentationMainLayoutImage,
  uploadQuotationPresentationSectionImage,
} from "@/lib/quotation-image-upload";

type PresentationQuotation = {
  id: string;
  quotation_no: string | null;
  title: string;
  quotation_date: string;
};

type PresentationClient = {
  id: string;
  company_name: string;
} | null;

type PresentationProject = {
  id: string;
  project_name: string | null;
  location: string | null;
  attention_to: string | null;
} | null;

type PresentationSection = {
  id: string;
  section_title: string;
  section_notes: string | null;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
  sort_order: number;
  is_active: boolean;
};

type PresentationItem = {
  id: string;
  section_id: string | null;
  item_type: string;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  brand_name_snapshot: string | null;
  category_name_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  specification_snapshot: string | null;
  finish_selections_snapshot: unknown;
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  warranty_snapshot: string | null;
  supplier_name_snapshot: string | null;
  sort_order: number;
  is_optional?: boolean;
  is_rate_only?: boolean;
  line_style: string;
  is_active: boolean;
  cell_layout: {
    images?: Record<string, unknown>;
  } | null;
};

type DisplaySection = PresentationSection & {
  renderAsMainOnly?: boolean;
};

type FinishEntry = {
  id: string;
  label: string;
  code: string | null;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
};

type ImageUrlRecord = Record<string, string | null>;
type ItemOverrideStatusMap = Record<string, { status: "idle" | "uploading" | "failed"; error: string | null }>;
type MainLayoutStatusMap = Record<string, { status: "idle" | "uploading" | "failed"; error: string | null }>;
type SectionOverrideStatusMap = Record<string, { status: "idle" | "uploading" | "failed"; error: string | null }>;
type SaveState = "idle" | "saving" | "saved" | "error";
type VisibilityField = keyof PresentationContentVisibility;
type PageVisibilityField = keyof PresentationPageVisibility;
type CoverOverrideField = keyof PresentationCoverOverrides;
type ClosingOverrideField = keyof PresentationClosingOverrides;
type SettingsSectionKey = "flow" | "items" | "layout" | "content" | "pages" | "areasSections" | "mainLayouts" | "sections" | "cover" | "closing" | "presets";
type PresentationPresetKey = "detailed" | "image_first" | "compact" | "client_review";
type ProductPageData = {
  item: PresentationItem;
  heading: string;
  imageUrl: string | null;
  imageSettings: Partial<ImageDisplaySettings> | undefined;
  imageFrameSize: PresentationImageFrameSize;
  imagePositionX: number;
  imagePositionY: number;
  imageScale: number;
  imageRect: PresentationImageRect | null;
  summary: string | null;
  meta: Array<{ label: string; value: string | null }>;
  finishGroups: Array<{ label: string; items: FinishEntry[] }>;
  cleanedSpecification: string | null;
};
type SaveResponsePayload = {
  success?: boolean;
  settings?: unknown;
  error?: string;
  details?: string;
  code?: string;
};
type SectionImageField = "areaImageUrl" | "sectionLayoutImageUrl";
type FlowGroup = {
  id: string;
  mainSection: PresentationSection | null;
  sections: PresentationSection[];
};

type OrderedPresentationHierarchy = {
  allPresentableItemsBySection: Map<string, PresentationItem[]>;
  childrenByParent: Map<string, PresentationSection[]>;
  displaySections: DisplaySection[];
  flowGroups: FlowGroup[];
  mainSections: PresentationSection[];
  sectionsById: Map<string, PresentationSection>;
  sectionsByMainId: Map<string, PresentationSection[]>;
};

type PresentationSlide =
  | { type: "cover"; key: string; title: string }
  | { type: "design"; key: string; title: string }
  | { type: "main-area"; key: string; title: string; mainSection: PresentationSection }
  | { type: "section"; key: string; title: string; section: DisplaySection }
  | { type: "product"; key: string; title: string; section: DisplaySection; itemIds: string[] }
  | { type: "thank-you"; key: string; title: string };

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

const contentVisibilityOptions: Array<{ key: VisibilityField; label: string; description: string }> = [
  { key: "specification", label: "Specification", description: "Show the technical description panel text." },
  { key: "dimensions", label: "Dimensions", description: "Show product dimensions when available." },
  { key: "finishes", label: "Finishes", description: "Show selected material and finish swatches when available." },
  { key: "brand", label: "Brand", description: "Show brand information in product details." },
  { key: "origin", label: "Origin", description: "Show origin information in product details." },
  { key: "model", label: "Model", description: "Show product model values." },
  { key: "code", label: "Code", description: "Show quotation/product code values." },
];
const compactContentVisibilityKeys: VisibilityField[] = ["code", "brand", "origin"];
const compactContentVisibilityOptions = contentVisibilityOptions.filter((option) => compactContentVisibilityKeys.includes(option.key));
const fullContentVisibilityOptions = contentVisibilityOptions;

const layoutModeOptions: Array<{ value: PresentationLayoutMode; label: string; description: string }> = [
  { value: "single", label: "One item per page", description: "Render each visible product on its own landscape slide." },
  { value: "two_per_page", label: "Two items per page", description: "Pair visible products within each section on shared slides." },
];
const pageVisibilityOptions: Array<{ key: PageVisibilityField; label: string; description: string }> = [
  { key: "cover", label: "Show Cover Page", description: "Include the opening presentation cover slide." },
  { key: "designConsiderations", label: "Show Design Considerations Page", description: "Include the design considerations overview slide." },
  { key: "mainLayoutPages", label: "Show Main Area Layout Pages", description: "Render the configured main area or floor pages before section pages." },
  { key: "sectionDividers", label: "Show Section Divider Pages", description: "Insert section divider slides before each visible section." },
  { key: "thankYou", label: "Show Thank You Page", description: "Include the closing thank-you slide." },
];
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
const settingsSections: Array<{ key: SettingsSectionKey; label: string }> = [
  { key: "flow", label: "Flow" },
  { key: "items", label: "Items" },
  { key: "layout", label: "Layout" },
  { key: "content", label: "Slide Content" },
  { key: "pages", label: "Pages" },
  { key: "areasSections", label: "Areas & Sections" },
  { key: "cover", label: "Cover" },
  { key: "closing", label: "Closing" },
  { key: "presets", label: "Presets" },
];
const presentationPresets: Array<{
  key: PresentationPresetKey;
  name: string;
  description: string;
  changes: string;
  layoutMode: PresentationLayoutMode;
  contentVisibility: PresentationContentVisibility;
  pageVisibility: PresentationPageVisibility;
}> = [
  {
    key: "detailed",
    name: "Detailed Presentation",
    description: "Full technical product slides with all available details.",
    changes: "Single-item pages, all product details visible, all major page types enabled.",
    layoutMode: "single",
    contentVisibility: {
      specification: true,
      dimensions: true,
      finishes: true,
      brand: true,
      origin: true,
      model: true,
      code: true,
    },
    pageVisibility: {
      cover: true,
      designConsiderations: true,
      mainLayoutPages: true,
      sectionDividers: true,
      thankYou: true,
    },
  },
  {
    key: "image_first",
    name: "Image-First Presentation",
    description: "Premium visual proposal with cleaner product details.",
    changes: "Single-item pages, keeps visuals rich, hides model values only.",
    layoutMode: "single",
    contentVisibility: {
      specification: true,
      dimensions: true,
      finishes: true,
      brand: true,
      origin: true,
      model: false,
      code: true,
    },
    pageVisibility: {
      cover: true,
      designConsiderations: true,
      mainLayoutPages: true,
      sectionDividers: true,
      thankYou: true,
    },
  },
  {
    key: "compact",
    name: "Compact Presentation",
    description: "Shorter deck using two products per page and minimal metadata.",
    changes: "Two products per page, no design page, compact brand/origin/code metadata.",
    layoutMode: "two_per_page",
    contentVisibility: {
      specification: false,
      dimensions: false,
      finishes: false,
      brand: true,
      origin: true,
      model: false,
      code: true,
    },
    pageVisibility: {
      cover: true,
      designConsiderations: false,
      mainLayoutPages: true,
      sectionDividers: true,
      thankYou: true,
    },
  },
  {
    key: "client_review",
    name: "Client Review",
    description: "Clean approval deck with product details but less internal coding.",
    changes: "Single-item pages, hides design page, removes code and model values.",
    layoutMode: "single",
    contentVisibility: {
      specification: true,
      dimensions: true,
      finishes: true,
      brand: true,
      origin: true,
      model: false,
      code: false,
    },
    pageVisibility: {
      cover: true,
      designConsiderations: false,
      mainLayoutPages: true,
      sectionDividers: true,
      thankYou: true,
    },
  },
];

function formatPresentationDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

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

function imageSettingsValue(value: unknown) {
  return isRecord(value) ? value as Partial<ImageDisplaySettings> : undefined;
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

function visibleFinishes(item: PresentationItem, finishImageUrlByItemAndFinishId: ImageUrlRecord) {
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

function groupedFinishes(finishes: FinishEntry[]) {
  const groups = new Map<string, FinishEntry[]>();

  finishes.forEach((finish) => {
    groups.set(finish.label, [...(groups.get(finish.label) ?? []), finish]);
  });

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function compactFinishRows(finishGroups: Array<{ label: string; items: FinishEntry[] }>) {
  return finishGroups.flatMap((group) =>
    group.items.map((finish) => ({
      id: finish.id,
      label: group.label,
      code: finish.code,
      name: finish.name,
      description: finish.description,
      imageUrl: finish.imageUrl,
    })),
  );
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

function moveOrderedEntry(ids: string[], entryId: string, direction: "up" | "down") {
  const currentIndex = ids.indexOf(entryId);
  if (currentIndex < 0) return ids;

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= ids.length) return ids;

  const nextIds = [...ids];
  const [entry] = nextIds.splice(currentIndex, 1);
  nextIds.splice(nextIndex, 0, entry);
  return nextIds;
}

function canonicalFlowOrderSignature(flowOrder: PresentationFlowOrder) {
  return {
    mainSectionKeys: flowOrder.mainSectionKeys,
    sectionKeysByMain: Object.fromEntries(
      Object.entries(flowOrder.sectionKeysByMain)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    ),
    itemIdsBySection: Object.fromEntries(
      Object.entries(flowOrder.itemIdsBySection)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    ),
  };
}

function buildOrderedPresentationHierarchy(
  sections: PresentationSection[],
  items: PresentationItem[],
  flowOrder: PresentationFlowOrder,
): OrderedPresentationHierarchy {
  const orderedSectionRows = orderedPresentationSections(sections);
  const sectionsById = new Map(orderedSectionRows.map((section) => [section.id, section]));
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
  const flowGroups: FlowGroup[] = [];

  for (const section of mainSections) {
    const orderedChildren = sectionsByMainId.get(section.id) ?? [];
    childrenByParent.set(section.id, orderedChildren);
    rows.push({ ...section, renderAsMainOnly: true });
    orderedChildren.forEach((child) => rows.push(child));
    flowGroups.push({
      id: `main:${section.id}`,
      mainSection: section,
      sections: (allPresentableItemsBySection.get(section.id) ?? []).length
        ? [section, ...orderedChildren]
        : orderedChildren,
    });
  }

  orphanSections.forEach((section) => {
    rows.push(section);
    flowGroups.push({
      id: `section:${section.id}`,
      mainSection: null,
      sections: [section],
    });
  });

  return {
    allPresentableItemsBySection,
    childrenByParent,
    displaySections: rows,
    flowGroups,
    mainSections,
    sectionsById,
    sectionsByMainId,
  };
}

function productTitle(item: PresentationItem) {
  return item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || "Quotation Item";
}

function detailValue(values: Array<string | null | undefined>) {
  const value = values.find((entry) => typeof entry === "string" && entry.trim());
  return value?.trim() ?? null;
}

function detailRows(item: PresentationItem, contentVisibility: PresentationContentVisibility) {
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
  ].filter((row): row is { label: string; value: string | null } => Boolean(row?.value));
}

function productSummary(
  item: PresentationItem,
  project: PresentationProject,
  contentVisibility: PresentationContentVisibility,
) {
  const originDisplay = formatBrandOriginSupplier({
    brandName: item.brand_name_snapshot,
    origin: item.origin_snapshot,
    supplier: item.supplier_name_snapshot,
  });
  const visibleBrandOrigin = [
    contentVisibility.brand ? originDisplay.brand : null,
    contentVisibility.origin ? originDisplay.origin : null,
  ].filter(Boolean).join(" - ");

  return detailValue([
    visibleBrandOrigin || null,
    item.category_name_snapshot,
    project?.project_name,
  ]);
}

function settingsSignature(value: QuotationPresentationSettings) {
  return JSON.stringify({
    hiddenItemIds: [...value.hiddenItemIds].sort(),
    flowOrder: canonicalFlowOrderSignature(value.flowOrder),
    contentVisibility: value.contentVisibility,
    layoutMode: value.layoutMode,
    pageVisibility: value.pageVisibility,
    mainSectionOverrides: Object.fromEntries(
      Object.entries(value.mainSectionOverrides)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, override]) => [key, {
          title: override.title,
          note: override.note,
          layoutImageUrl: override.layoutImageUrl,
        }]),
    ),
    sectionOverrides: Object.fromEntries(
      Object.entries(value.sectionOverrides)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, override]) => [key, {
          title: override.title,
          note: override.note,
          areaImageUrl: override.areaImageUrl,
          sectionLayoutImageUrl: override.sectionLayoutImageUrl,
        }]),
    ),
    presentationVisuals: value.presentationVisuals,
    coverOverrides: value.coverOverrides,
    closingOverrides: value.closingOverrides,
    itemOverrides: Object.fromEntries(
      Object.entries(value.itemOverrides)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, override]) => [key, {
          imageUrl: override.imageUrl,
          imageFit: override.imageFit,
          imageFrameSize: override.imageFrameSize,
          imagePosition: override.imagePosition,
          imagePositionX: override.imagePositionX,
          imagePositionY: override.imagePositionY,
          imageScale: override.imageScale,
          imageRect: override.imageRect,
        }]),
    ),
  });
}

function sectionPresentationTitle(
  section: Pick<PresentationSection, "id" | "section_title">,
  settings: QuotationPresentationSettings,
) {
  return settings.sectionOverrides[section.id]?.title?.trim() || section.section_title;
}

function sectionPresentationNote(
  section: Pick<PresentationSection, "id" | "section_notes">,
  settings: QuotationPresentationSettings,
) {
  return settings.sectionOverrides[section.id]?.note?.trim() || section.section_notes || null;
}

function normalizedPresentationSectionOverride(value: PresentationSectionOverride | undefined): PresentationSectionOverride {
  return {
    title: value?.title?.trim() ?? "",
    note: value?.note?.trim() ?? "",
    areaImageUrl: value?.areaImageUrl?.trim() ?? "",
    sectionLayoutImageUrl: value?.sectionLayoutImageUrl?.trim() ?? "",
  };
}

function sectionOverrideHasCustomValue(value: PresentationSectionOverride | undefined) {
  const normalized = normalizedPresentationSectionOverride(value);
  return Boolean(
    normalized.title ||
    normalized.note ||
    normalized.areaImageUrl ||
    normalized.sectionLayoutImageUrl
  );
}

function normalizedPresentationMainSectionOverride(
  value: PresentationMainSectionOverride | undefined,
): PresentationMainSectionOverride {
  return {
    title: value?.title?.trim() ?? "",
    note: value?.note?.trim() ?? "",
    layoutImageUrl: value?.layoutImageUrl?.trim() ?? "",
  };
}

function mainSectionOverrideHasCustomValue(value: PresentationMainSectionOverride | undefined) {
  const normalized = normalizedPresentationMainSectionOverride(value);
  return Boolean(normalized.title || normalized.note || normalized.layoutImageUrl);
}

function resolvedOverrideValue(value: string | null | undefined, fallback: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed) return trimmed;
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : null;
}

function normalizedPresentationItemOverride(value: PresentationItemOverride | undefined): PresentationItemOverride {
  const imageRect = normalizePresentationImageRect(value?.imageRect);

  return {
    imageUrl: value?.imageUrl?.trim() ?? "",
    imageFit: value?.imageFit === "cover" ? "cover" : "contain",
    imageFrameSize: value?.imageFrameSize === "small" || value?.imageFrameSize === "medium" ? value.imageFrameSize : "current",
    imagePosition: "center" as const,
    imagePositionX: Math.min(Math.max(Number.isFinite(Number(value?.imagePositionX)) ? Number(value?.imagePositionX) : 50, 0), 100),
    imagePositionY: Math.min(Math.max(Number.isFinite(Number(value?.imagePositionY)) ? Number(value?.imagePositionY) : 50, 0), 100),
    imageScale: Math.min(Math.max(Number(value?.imageScale) || 1, 0.6), 1.2),
    ...(imageRect ? { imageRect } : {}),
  };
}

function itemOverrideHasCustomValue(value: PresentationItemOverride | undefined) {
  const normalized = normalizedPresentationItemOverride(value);
  return Boolean(
    normalized.imageUrl ||
    normalized.imageFit !== DEFAULT_PRESENTATION_ITEM_OVERRIDE.imageFit ||
    normalized.imageFrameSize !== DEFAULT_PRESENTATION_ITEM_OVERRIDE.imageFrameSize ||
    normalized.imagePosition !== DEFAULT_PRESENTATION_ITEM_OVERRIDE.imagePosition ||
    normalized.imagePositionX !== DEFAULT_PRESENTATION_ITEM_OVERRIDE.imagePositionX ||
    normalized.imagePositionY !== DEFAULT_PRESENTATION_ITEM_OVERRIDE.imagePositionY ||
    normalized.imageScale !== DEFAULT_PRESENTATION_ITEM_OVERRIDE.imageScale ||
    normalized.imageRect
  );
}

function presentationImageSettings(value: PresentationItemOverride | undefined): Partial<ImageDisplaySettings> | null {
  if (!itemOverrideHasCustomValue(value)) return null;

  const normalized = normalizedPresentationItemOverride(value);

  return {
    fit: normalized.imageFit,
    zoom: 1,
    positionX: normalized.imagePositionX,
    positionY: normalized.imagePositionY,
  };
}

function textInputClassName() {
  return "mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400";
}

function textareaClassName() {
  return "mt-2 min-h-[92px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-6 text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400";
}

function clampStyle(lines: number) {
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  } as const;
}

function formatUpdatedAt(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatSaveError(payload: SaveResponsePayload | null, fallback: string) {
  const error = typeof payload?.error === "string" && payload.error.trim() ? payload.error.trim() : fallback;
  const details = typeof payload?.details === "string" && payload.details.trim() ? payload.details.trim() : "";
  const code = typeof payload?.code === "string" && payload.code.trim() ? payload.code.trim() : "";
  const suffix = [details, code ? `code: ${code}` : ""].filter(Boolean).join(" / ");

  return suffix ? `${error}: ${suffix}` : error;
}

function slideTypeLabel(type: PresentationSlide["type"]) {
  switch (type) {
    case "cover":
      return "Cover";
    case "design":
      return "Design";
    case "main-area":
      return "Main Area";
    case "section":
      return "Section";
    case "product":
      return "Product";
    case "thank-you":
      return "Thank You";
    default:
      return "Slide";
  }
}

function slideDomId(index: number) {
  return `presentation-slide-${index + 1}`;
}

function buildPresentationSlides({
  closingTitle,
  coverTitle,
  dividerSections,
  mainSectionTitlesById,
  productPagesBySection,
  sectionTitlesById,
  settings,
}: {
  closingTitle: string | null;
  coverTitle: string | null;
  dividerSections: DisplaySection[];
  mainSectionTitlesById: Map<string, string>;
  productPagesBySection: Map<string, PresentationItem[][]>;
  sectionTitlesById: Map<string, string>;
  settings: QuotationPresentationSettings;
}) {
  const slides: PresentationSlide[] = [];

  if (settings.pageVisibility.cover) {
    slides.push({
      type: "cover",
      key: "cover",
      title: coverTitle ?? "Cover",
    });
  }

  if (settings.pageVisibility.designConsiderations) {
    slides.push({
      type: "design",
      key: "design-considerations",
      title: "Design Considerations",
    });
  }

  dividerSections.forEach((section) => {
    if (section.section_kind === "main" && settings.pageVisibility.mainLayoutPages) {
      slides.push({
        type: "main-area",
        key: `main-area:${section.id}`,
        title: mainSectionTitlesById.get(section.id) ?? section.section_title,
        mainSection: section,
      });
    }

    if (section.section_kind !== "main" && settings.pageVisibility.sectionDividers) {
      slides.push({
        type: "section",
        key: `section:${section.id}`,
        title: sectionTitlesById.get(section.id) ?? section.section_title,
        section,
      });
    }

    (productPagesBySection.get(section.id) ?? []).forEach((pageItems, pageIndex) => {
      const firstItem = pageItems[0];
      if (!firstItem) return;

      slides.push({
        type: "product",
        key: `product:${section.id}:${pageIndex + 1}`,
        title: productTitle(firstItem),
        section,
        itemIds: pageItems.map((item) => item.id),
      });
    });
  });

  if (settings.pageVisibility.thankYou) {
    slides.push({
      type: "thank-you",
      key: "thank-you",
      title: closingTitle ?? "Thank You",
    });
  }

  return slides;
}

// 16:9 slide. Design sizes come from a 1920x1080 canvas and are written as `u(N)` (N * --u).
const PRESENTATION_PAGE_WIDTH = "13.333in";
const PRESENTATION_PAGE_HEIGHT = "7.5in";
const PRESENTATION_DESIGN_UNIT = "calc(13.333in / 1920)";

function u(value: number) {
  return `calc(${value} * var(--u))`;
}

const presentationTheme = {
  bg: "#2B2D33",
  card: "#363940",
  hairline: "#4C5058",
  text: "#F3F0EA",
  muted: "#B9B4AB",
  bronze: "#CC9366",
} as const;

const darkSlideStyle: CSSProperties = { background: presentationTheme.bg, color: presentationTheme.text };
const bronzeGlowBackground = "radial-gradient(circle, rgba(204,147,102,0.22), rgba(43,45,51,0) 62%)";
const themeLogoClassName = "h-[calc(47*var(--u))] w-[calc(280*var(--u))] object-contain object-left brightness-0 invert";
const themeLogoFallbackClassName = "presentation-serif text-[length:calc(40*var(--u))] leading-none text-[#F3F0EA]";

const productTheme = {
  ink: "#23252A",
  mutedOnWhite: "#6B6F76",
  hairlineOnWhite: "#DADCE0",
} as const;
const PRODUCT_FINISH_LIMIT = 25;

function ProductDetailCell({ compact = false, label, value }: { compact?: boolean; label: string; value: string | null | undefined }) {
  if (!value) return null;

  return (
    <div className="min-w-0">
      <p className="uppercase" style={{ fontSize: u(compact ? 15 : 17), letterSpacing: u(2), lineHeight: 1.2, color: productTheme.mutedOnWhite }}>{label}</p>
      <p className="[overflow-wrap:anywhere]" style={{ marginTop: u(6), fontSize: u(compact ? 19 : 22), fontWeight: 500, lineHeight: 1.3, color: productTheme.ink }}>{value}</p>
    </div>
  );
}

function ProductFinishChip({ compact = false, finish }: { compact?: boolean; finish: FinishEntry }) {
  const caption = (finish.name && finish.name !== finish.code ? finish.name : null) || (!finish.code ? finish.description || "Selected finish" : null);

  return (
    <div className="flex flex-col" style={{ width: u(108), gap: u(6) }}>
      <div className="overflow-hidden bg-[linear-gradient(135deg,_#f4f4f5,_#e4e4e7)]" style={{ width: u(108), height: u(compact ? 32 : 36), border: `1px solid ${presentationTheme.hairline}` }}>
        {finish.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={finish.imageUrl} alt={finish.name || finish.code || finish.label} className="h-full w-full object-cover" />
        ) : null}
      </div>
      {/* One line: code then name. Only the name wraps (max 2 lines, clipped without an ellipsis). */}
      <p className="min-w-0 overflow-hidden" style={{ fontSize: u(15), lineHeight: 1.2, maxHeight: "2.4em" }}>
        {finish.code ? <span className="whitespace-nowrap" style={{ fontWeight: 600, color: presentationTheme.text }}>{finish.code}</span> : null}
        {finish.code && caption ? " " : null}
        {caption ? <span className="[overflow-wrap:anywhere]" style={{ fontWeight: 400, color: presentationTheme.muted }}>{caption}</span> : null}
      </p>
    </div>
  );
}

function PresentationPage({
  children,
  className = "",
  id,
  slideIndex,
  style,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  slideIndex?: number;
  style?: CSSProperties;
}) {
  return (
    <section
      id={id}
      data-presentation-slide="true"
      data-slide-index={typeof slideIndex === "number" ? slideIndex : undefined}
      className={`presentation-page overflow-hidden break-after-page bg-white text-zinc-900 shadow-[0_24px_80px_rgba(15,23,42,0.12)] print:shadow-none ${className}`}
      style={{
        ...style,
        width: PRESENTATION_PAGE_WIDTH,
        height: PRESENTATION_PAGE_HEIGHT,
        "--u": PRESENTATION_DESIGN_UNIT,
      } as CSSProperties}
    >
      {children}
    </section>
  );
}

function ThemeBronzeGlow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{ left: u(1000), top: u(-260), width: u(1200), height: u(1200), background: bronzeGlowBackground }}
    />
  );
}

function ThemeEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="uppercase" style={{ fontSize: u(24), fontWeight: 600, letterSpacing: u(5), lineHeight: 1.2, color: presentationTheme.bronze }}>
      {children}
    </p>
  );
}

function ThemeInfoCell({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;

  return (
    <div className="min-w-0">
      <p className="uppercase" style={{ fontSize: u(22), letterSpacing: u(3), lineHeight: 1.2, color: presentationTheme.muted }}>{label}</p>
      <p style={{ marginTop: u(8), fontSize: u(26), fontWeight: 500, lineHeight: 1.3, color: presentationTheme.text }}>{value}</p>
    </div>
  );
}

function ThemeTagChip({ children }: { children: ReactNode }) {
  return (
    <p
      className="self-start uppercase [overflow-wrap:anywhere]"
      style={{ ...clampStyle(2), border: `${u(2)} solid ${presentationTheme.bronze}`, padding: `${u(12)} ${u(26)}`, fontSize: u(22), fontWeight: 600, letterSpacing: u(4), lineHeight: 1.2, color: presentationTheme.bronze }}
    >
      {children}
    </p>
  );
}

function ThemeSlideFooter({ companyName, quotationNo }: { companyName: string | null | undefined; quotationNo: string | null | undefined }) {
  const text = [companyName, quotationNo].filter(Boolean).join(" · ");
  if (!text) return null;

  return (
    <p className="absolute" style={{ ...clampStyle(1), left: u(128), bottom: u(40), width: u(900), fontSize: u(22), lineHeight: 1.3, color: presentationTheme.muted }}>
      {text}
    </p>
  );
}

function ThemeContactRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;

  return (
    <div className="min-w-0">
      <p className="uppercase" style={{ fontSize: u(22), letterSpacing: u(3), lineHeight: 1.2, color: presentationTheme.bronze }}>{label}</p>
      <p className="[overflow-wrap:anywhere]" style={{ marginTop: u(8), fontSize: u(26), fontWeight: 500, lineHeight: 1.35, color: presentationTheme.text }}>{value}</p>
    </div>
  );
}

function presentationLogoUrl(value: string | null | undefined) {
  if (!value) return "/noa-logo.png";

  try {
    const url = new URL(value, typeof window !== "undefined" ? window.location.origin : "https://example.com");
    if (["noaoffices.com", "www.noaoffices.com"].includes(url.hostname.toLowerCase())) {
      return "/noa-logo.png";
    }
  } catch {
    // Keep original value for invalid-but-displayable relative paths.
  }

  return value;
}

function PresentationBrandLogo({
  logoUrl,
  fallbackText,
  className = "max-h-14 max-w-[150px] object-contain brightness-0 invert",
  fallbackClassName = "text-2xl font-light leading-tight text-white",
}: {
  logoUrl: string | null | undefined;
  fallbackText: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const safeLogoUrl = presentationLogoUrl(logoUrl);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const hasError = safeLogoUrl === failedLogoUrl;

  if (!safeLogoUrl || hasError) {
    return <p className={fallbackClassName}>{fallbackText}</p>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={safeLogoUrl}
      alt={fallbackText}
      className={className}
      onError={() => setFailedLogoUrl(safeLogoUrl)}
    />
  );
}

function EmptySectionVisualState() {
  return <div aria-hidden="true" className="mt-8 min-h-0 flex-1" />;
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function displayNumberByItemId(items: PresentationItem[]) {
  return new Map(items.map((item, index) => [item.id, index + 1] as const));
}

function LayoutOption({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${checked ? "border-zinc-950 bg-white" : "border-zinc-200 bg-white"}`}>
      <input
        checked={checked}
        className="mt-1 h-4 w-4 border-zinc-300 text-zinc-950 focus:ring-zinc-400"
        onChange={onChange}
        type="radio"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-900">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span>
      </span>
    </label>
  );
}

function PresentationImageStage({
  alt,
  boundsClassName,
  emptyContent,
  fit,
  imageRect = null,
  imageUrl,
  positionX,
  positionY,
  scale,
}: {
  alt: string;
  boundsClassName: string;
  emptyContent: ReactNode;
  fit: PresentationImageFit;
  imageRect?: PresentationImageRect | null;
  imageUrl: string | null;
  positionX: number;
  positionY: number;
  scale: number;
}) {
  // Custom frame (one-per-page product slide only): the image fills a box placed in percent of the image area.
  // scale, position and frame size are ignored for drawing in this case.
  if (imageRect) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-white">
        <div
          className="pointer-events-none absolute overflow-hidden"
          style={{ left: `${imageRect.x}%`, top: `${imageRect.y}%`, width: `${imageRect.w}%`, height: `${imageRect.h}%` }}
        >
          <QuotationImageFrame
            alt={alt}
            className="h-full w-full overflow-hidden bg-white"
            imageClassName="block h-full w-full bg-white"
            imageUrl={imageUrl}
            emptyContent={emptyContent}
            settings={{ fit, zoom: 1, positionX: 50, positionY: 50 }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-white">
      <div className={`relative overflow-hidden ${boundsClassName}`}>
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: `${positionX}% ${positionY}%`,
          }}
        >
          <QuotationImageFrame
            alt={alt}
            className="h-full w-full overflow-hidden bg-white"
            imageClassName="block h-full w-full bg-white"
            imageUrl={imageUrl}
            emptyContent={emptyContent}
            settings={{
              fit,
              zoom: 1,
              positionX: positionX === 0 ? Number.EPSILON : positionX,
              positionY: positionY === 0 ? Number.EPSILON : positionY,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function presentationImageBoundsClass(frameSize: PresentationImageFrameSize, compact: boolean) {
  if (compact) {
    if (frameSize === "small") return "h-[70%] w-[75%]";
    if (frameSize === "medium") return "h-[80%] w-[85%]";
    return "h-[90%] w-[95%]";
  }

  // One-per-page stage box is 1120x800 (design units). "current" fills it; smaller sizes keep their old relative steps.
  if (frameSize === "small") return "h-[72%] w-[76%]";
  if (frameSize === "medium") return "h-[86%] w-[88%]";
  return "h-full w-full";
}

const settingsSectionIcons: Record<SettingsSectionKey, LucideIcon> = {
  flow: Layers,
  items: Package,
  layout: LayoutGrid,
  content: FileText,
  pages: FileIcon,
  areasSections: ImageIcon,
  mainLayouts: ImageIcon,
  sections: ImageIcon,
  cover: ImageIcon,
  closing: FileCheck,
  presets: SlidersHorizontal,
};

function SettingsSectionButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 w-full items-center justify-center gap-1.5 border-b-2 bg-transparent px-0.5 py-2 text-center text-xs font-semibold leading-tight transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 ${
        active
          ? "border-emerald-800 text-emerald-800"
          : "border-transparent text-[#6B7380] hover:text-[#151A24]"
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}

function SectionVisibilityCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      checked={checked}
      className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-400"
      onChange={(event) => onChange(event.target.checked)}
      type="checkbox"
    />
  );
}

function FlowMoveButtons({
  disableDown,
  disableUp,
  onMoveDown,
  onMoveUp,
}: {
  disableDown: boolean;
  disableUp: boolean;
  onMoveDown: () => void;
  onMoveUp: () => void;
}) {
  const buttonClassName = "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D5DAE2] bg-white text-[#6B7380] transition hover:bg-zinc-50 hover:text-[#151A24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onMoveUp}
        disabled={disableUp}
        aria-label="Up"
        title="Up"
        className={buttonClassName}
      >
        <ArrowUp aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={disableDown}
        aria-label="Down"
        title="Down"
        className={buttonClassName}
      >
        <ArrowDown aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

function buildProductPageData({
  contentVisibility,
  finishImageUrlByItemAndFinishId,
  imageUrl,
  itemOverride,
  item,
  project,
}: {
  contentVisibility: PresentationContentVisibility;
  finishImageUrlByItemAndFinishId: ImageUrlRecord;
  imageUrl: string | null;
  itemOverride?: PresentationItemOverride;
  item: PresentationItem;
  project: PresentationProject;
}): ProductPageData {
  const cleanedSpecification = specificationWithoutDuplicateCode({
    code: item.item_code_snapshot,
    specification: item.specification_snapshot,
  });
  const finishes = contentVisibility.finishes
    ? visibleFinishes(item, finishImageUrlByItemAndFinishId)
    : [];

  return {
    item,
    heading: productTitle(item),
    imageUrl,
    imageSettings: presentationImageSettings(itemOverride) ?? imageSettingsValue(
      item.proposed_image_url_snapshot
        ? item.cell_layout?.images?.proposed_image_url_snapshot
        : item.cell_layout?.images?.specified_image_url_snapshot,
    ),
    imageFrameSize: normalizedPresentationItemOverride(itemOverride).imageFrameSize,
    imagePositionX: normalizedPresentationItemOverride(itemOverride).imagePositionX,
    imagePositionY: normalizedPresentationItemOverride(itemOverride).imagePositionY,
    imageScale: normalizedPresentationItemOverride(itemOverride).imageScale,
    imageRect: normalizedPresentationItemOverride(itemOverride).imageRect ?? null,
    summary: productSummary(item, project, contentVisibility),
    meta: detailRows(item, contentVisibility),
    finishGroups: groupedFinishes(finishes),
    cleanedSpecification,
  };
}

// Two-per-page card (one column of the 1920x1080 slide). Finishes are capped to what fits under the description.
const TWO_PER_PAGE_FINISH_LIMIT = 14;
const TWO_PER_PAGE_FINISH_MINIMUM = 10;
const TWO_PER_PAGE_CHIPS_PER_ROW = 7;
// With 3 or more finish types each heading sits beside its chips, which leaves room for 6 chips per row.
const TWO_PER_PAGE_DENSE_CHIPS_PER_ROW = 6;
const TWO_PER_PAGE_DENSE_TYPE_COUNT = 3;

function limitFinishGroups(finishGroups: ProductPageData["finishGroups"], limit: number) {
  const all = compactFinishRows(finishGroups);
  const shown = all.slice(0, limit);
  const shownKeys = new Set(shown.map((finish) => `${finish.label}:${finish.id}`));
  const groups = finishGroups
    .map((group) => ({ label: group.label, items: group.items.filter((finish) => shownKeys.has(`${group.label}:${finish.id}`)) }))
    .filter((group) => group.items.length);

  return { groups, hidden: Math.max(all.length - shown.length, 0), total: all.length };
}

// Rough heights in design units, used only to pick the finishes cap and description clamp.
function estimatedFinishesHeight(groups: Array<{ items: FinishEntry[] }>, dense = false) {
  if (!groups.length) return 0;
  const rowsPerGroup = groups.map((group) => Math.ceil(group.items.length / (dense ? TWO_PER_PAGE_DENSE_CHIPS_PER_ROW : TWO_PER_PAGE_CHIPS_PER_ROW)));
  const rows = rowsPerGroup.reduce((sum, count) => sum + count, 0);
  // 62 per chip row leaves room for a name that wraps onto a second line.
  if (dense) return 15 + 20 + groups.length * 12 + rows * 62 + (rows - groups.length) * 12;
  return 15 + 20 + groups.length * (12 + 21 + 10) + rows * 62 + (rows - groups.length) * 12;
}

function twoPerPageCardPlan(data: ProductPageData, showDescription: boolean) {
  const hasDescription = showDescription;
  const topHeight = (descriptionLines: number) =>
    22 + 10 + (data.heading.length > 36 ? 88 : 44) + (data.item.is_optional || data.item.is_rate_only ? 36 : 0)
    + (data.summary ? 32 : 0) + (hasDescription ? 10 + descriptionLines * 27 : 0);
  const budget = 448 - 18;
  const dense = data.finishGroups.length >= TWO_PER_PAGE_DENSE_TYPE_COUNT;

  // 3 lines at the full cap first, then 2 lines with a lower cap (down to the minimum). Only when even that does not
  // fit (many types with one chip each) the description is shortened to 1 line, then left out.
  for (const descriptionLines of [3, 2]) {
    for (let cap = TWO_PER_PAGE_FINISH_LIMIT; cap >= (descriptionLines === 3 ? TWO_PER_PAGE_FINISH_LIMIT : TWO_PER_PAGE_FINISH_MINIMUM); cap -= 1) {
      const limited = limitFinishGroups(data.finishGroups, cap);
      if (topHeight(descriptionLines) + estimatedFinishesHeight(limited.groups, dense) <= budget) return { dense, descriptionLines, limited };
    }
  }

  const limited = limitFinishGroups(data.finishGroups, TWO_PER_PAGE_FINISH_MINIMUM);
  for (const descriptionLines of [1, 0]) {
    if (topHeight(descriptionLines) + estimatedFinishesHeight(limited.groups, dense) <= budget) return { dense, descriptionLines, limited };
  }

  return { dense, descriptionLines: 0, limited };
}

function TwoPerPageCard({
  data,
  itemNumber,
  left,
  preparedBy,
  quotationNo,
  sectionTitle,
  showDescription,
}: {
  data: ProductPageData;
  itemNumber: number | null;
  left: number;
  preparedBy: string | null | undefined;
  quotationNo: string | null | undefined;
  sectionTitle: string;
  showDescription: boolean;
}) {
  const minimalMeta = data.meta.filter((row) => ["Code", "Brand", "Origin"].includes(row.label));
  // Same cells and data as the one-per-page details row; a cell is skipped when its value is empty.
  const detailCells = [
    ...minimalMeta.map((row) => ({ label: row.label, value: row.value })),
    { label: "Quote no.", value: quotationNo },
    { label: "Prepared by", value: preparedBy },
  ].filter((cell): cell is { label: string; value: string } => Boolean(cell.value));
  // Estimate whether the row wraps (860 wide, 28 gap). It is anchored to the panel edge so it grows upward, and the
  // image box gets shorter when two lines are expected so the two never overlap.
  const detailRowWidth = detailCells.reduce((sum, cell) => sum + Math.max(cell.label.length * 12.5, cell.value.length * 10.6), 0) + Math.max(detailCells.length - 1, 0) * 28;
  const imageBoxHeight = detailRowWidth > 860 ? 390 : 430;
  const { dense, descriptionLines, limited } = twoPerPageCardPlan(data, showDescription);
  const showDescriptionText = showDescription && descriptionLines > 0;
  const eyebrow = [itemNumber ? `Item ${itemNumber}` : null, sectionTitle].filter(Boolean).join(" · ");
  const badgeStyle = { border: `1px solid ${presentationTheme.bronze}`, padding: `${u(2)} ${u(8)}`, fontSize: u(15), fontWeight: 600, letterSpacing: u(2), color: presentationTheme.bronze };

  return (
    <article className="absolute top-0 overflow-hidden bg-white" style={{ left: u(left), width: u(956), height: "100%" }}>
      <div className="absolute bg-white" style={{ left: u(48), top: u(36), width: u(860), height: u(imageBoxHeight) }}>
        <PresentationImageStage
          alt={data.heading}
          boundsClassName={presentationImageBoundsClass(data.imageFrameSize, true)}
          emptyContent={(
            <div className="flex h-full w-full items-center justify-center bg-white text-center uppercase" style={{ padding: `0 ${u(40)}`, fontSize: u(15), letterSpacing: u(3), color: productTheme.mutedOnWhite }}>
              Visual pending
            </div>
          )}
          fit={data.imageSettings?.fit === "cover" ? "cover" : "contain"}
          imageUrl={data.imageUrl}
          positionX={data.imagePositionX}
          positionY={data.imagePositionY}
          scale={data.imageScale}
        />
      </div>

      {detailCells.length ? (
        <div
          className="absolute flex flex-wrap justify-between bg-white"
          style={{ left: u(48), bottom: u(532), width: u(860), borderTop: `1px solid ${productTheme.hairlineOnWhite}`, paddingTop: u(12), columnGap: u(28), rowGap: u(10) }}
        >
          {detailCells.map((cell) => (
            <ProductDetailCell key={cell.label} compact label={cell.label} value={cell.value} />
          ))}
        </div>
      ) : null}

      <div className="absolute" style={{ left: 0, top: u(560), width: u(956), height: u(520), background: presentationTheme.bg }}>
        <div className="absolute flex flex-col justify-between" style={{ left: u(40), top: u(36), width: u(876), height: u(448), gap: u(18) }}>
          <div className="flex min-h-0 flex-col overflow-hidden [&>*]:shrink-0" style={{ gap: u(10) }}>
            <p className="uppercase" style={{ ...clampStyle(1), fontSize: u(18), fontWeight: 600, letterSpacing: u(5), lineHeight: 1.2, color: presentationTheme.bronze }}>{eyebrow}</p>
            <div>
              <h3 className="presentation-serif" style={{ ...clampStyle(2), fontSize: u(44), fontWeight: 500, lineHeight: 1, letterSpacing: u(-1), color: presentationTheme.text }}>
                {data.heading}
              </h3>
              {data.item.is_optional || data.item.is_rate_only ? (
                <div className="flex flex-wrap" style={{ marginTop: u(8), gap: u(8) }}>
                  {data.item.is_optional ? <span className="uppercase" style={badgeStyle}>Optional</span> : null}
                  {data.item.is_rate_only ? <span className="uppercase" style={badgeStyle}>Rate only</span> : null}
                </div>
              ) : null}
            </div>
            {data.summary ? (
              <p className="uppercase" style={{ ...clampStyle(1), fontSize: u(17), fontWeight: 600, letterSpacing: u(3), lineHeight: 1.3, color: presentationTheme.bronze }}>{data.summary}</p>
            ) : null}
            {showDescriptionText ? (
              data.cleanedSpecification ? (
                <p className="whitespace-pre-wrap" style={{ ...clampStyle(descriptionLines), fontSize: u(18), lineHeight: 1.5, color: presentationTheme.muted }}>{data.cleanedSpecification}</p>
              ) : (
                <p style={{ fontSize: u(18), lineHeight: 1.5, color: presentationTheme.muted, opacity: 0.7 }}>Specification details not added yet.</p>
              )
            ) : null}
          </div>

          {limited.groups.length ? (
            <div className="flex shrink-0 flex-col" style={{ borderTop: `1px solid ${presentationTheme.hairline}`, paddingTop: u(14), gap: u(12) }}>
              <div className="flex items-baseline justify-between" style={{ gap: u(16) }}>
                <p className="uppercase" style={{ fontSize: u(16), fontWeight: 600, letterSpacing: u(4), color: presentationTheme.text }}>Finishes</p>
                {limited.hidden ? <p className="uppercase" style={{ fontSize: u(15), letterSpacing: u(2), color: presentationTheme.bronze }}>+{limited.hidden} more</p> : null}
              </div>
              {limited.groups.map((group) => dense ? (
                <div key={group.label} className="flex items-start" style={{ gap: u(18) }}>
                  <p className="shrink-0 uppercase [overflow-wrap:anywhere]" style={{ width: u(120), fontSize: u(16), fontWeight: 600, letterSpacing: u(3), lineHeight: 1.2, color: presentationTheme.bronze }}>{group.label}</p>
                  <div className="flex min-w-0 flex-1 flex-wrap" style={{ rowGap: u(12), columnGap: u(10) }}>
                    {group.items.map((finish) => <ProductFinishChip key={finish.id} compact finish={finish} />)}
                  </div>
                </div>
              ) : (
                <div key={group.label} className="flex flex-col" style={{ gap: u(10) }}>
                  <p className="uppercase" style={{ fontSize: u(16), fontWeight: 600, letterSpacing: u(3), color: presentationTheme.bronze }}>{group.label}</p>
                  <div className="flex flex-wrap" style={{ width: u(876), rowGap: u(12), columnGap: u(10) }}>
                    {group.items.map((finish) => <ProductFinishChip key={finish.id} compact finish={finish} />)}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ControlToggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3">
      <input
        checked={checked}
        className="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-400"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-900">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span>
      </span>
    </label>
  );
}

function TextField({
  compact = false,
  description,
  label,
  onChange,
  placeholder,
  value,
}: {
  compact?: boolean;
  description: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className={`block rounded-2xl border border-zinc-200 bg-white ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
      <span className="block text-sm font-semibold text-zinc-900">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={textInputClassName()}
      />
    </label>
  );
}

function TextAreaField({
  compact = false,
  description,
  label,
  onChange,
  placeholder,
  value,
}: {
  compact?: boolean;
  description: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className={`block rounded-2xl border border-zinc-200 bg-white ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
      <span className="block text-sm font-semibold text-zinc-900">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-zinc-500">{description}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={textareaClassName()}
      />
    </label>
  );
}

function PresentationImageInput({
  description,
  fieldLabel,
  imageUrl,
  inputId,
  onFileSelected,
  onReset,
  status,
  uploadDisabled = false,
}: {
  description: string;
  fieldLabel: string;
  imageUrl: string | null;
  inputId: string;
  onFileSelected: (file: File) => Promise<void>;
  onReset: () => void;
  status: { status: "idle" | "uploading" | "failed"; error: string | null };
  uploadDisabled?: boolean;
}) {
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const pasteTargetRef = useRef<HTMLDivElement | null>(null);

  async function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (uploadDisabled) return;
    event.preventDefault();
    setPasteMessage(null);

    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const imageItem = clipboardItems.find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const file = imageItem?.getAsFile() ?? null;

    if (!file) {
      setPasteMessage("No image found in clipboard.");
      return;
    }

    await onFileSelected(file);
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">{fieldLabel}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">{imageUrl ? "Presentation image added." : "No presentation image added."}</p>
        </div>
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-zinc-50 ring-1 ring-zinc-200">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={fieldLabel} className="h-full w-full object-contain" />
          ) : (
            <span className="px-1 text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-400">No Image</span>
          )}
        </div>
      </div>

      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        disabled={uploadDisabled}
        onChange={async (event) => {
          if (uploadDisabled) return;
          setPasteMessage(null);
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          await onFileSelected(file);
        }}
      />

      <div
        ref={pasteTargetRef}
        tabIndex={0}
        role="button"
        aria-label={`${fieldLabel} paste target`}
        onClick={() => {
          if (uploadDisabled) return;
          pasteTargetRef.current?.focus();
        }}
        onPaste={handlePaste}
        className={`mt-3 rounded-2xl border border-dashed px-4 py-3 text-left outline-none transition ${
          uploadDisabled
            ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
            : "cursor-text border-zinc-300 bg-zinc-50 focus:border-zinc-500 focus:bg-white"
        }`}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Paste Image</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          {uploadDisabled
            ? "Image upload is disabled in the development preview."
            : "Click here, then press Ctrl+V / Cmd+V to paste an image from your clipboard."}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label htmlFor={uploadDisabled ? undefined : inputId} className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
          uploadDisabled
            ? "cursor-not-allowed text-zinc-400"
            : status.status === "uploading"
              ? "cursor-pointer text-zinc-400"
              : "cursor-pointer text-zinc-700 hover:text-zinc-950"
        }`}>
          {uploadDisabled ? "Upload disabled" : status.status === "uploading" ? "Uploading..." : imageUrl ? "Change image" : "Upload image"}
        </label>
        {imageUrl ? (
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 transition hover:text-red-700"
          >
            Reset image
          </button>
        ) : null}
      </div>

      {pasteMessage ? <p className="mt-2 text-xs text-zinc-500">{pasteMessage}</p> : null}
      {status.error ? <p className="mt-2 text-xs text-red-700">{status.error}</p> : null}
    </div>
  );
}

function PresentationItemImageControl({
  fit,
  frameSize,
  hasOverrideImage,
  imageRect = null,
  imageScale,
  positionX,
  positionY,
  itemId,
  onClearImageRect,
  onFileSelected,
  onFitChange,
  onFrameSizeChange,
  onPositionXChange,
  onPositionYChange,
  onScaleChange,
  onResetImage,
  onUseOriginalImage,
  previewUrl,
  status,
  uploadDisabled = false,
}: {
  fit: PresentationImageFit;
  frameSize: PresentationImageFrameSize;
  hasOverrideImage: boolean;
  imageRect?: PresentationImageRect | null;
  imageScale: number;
  positionX: number;
  positionY: number;
  itemId: string;
  onClearImageRect?: () => void;
  onFileSelected: (file: File) => Promise<void>;
  onFitChange: (fit: PresentationImageFit) => void;
  onFrameSizeChange: (frameSize: PresentationImageFrameSize) => void;
  onPositionXChange: (position: number) => void;
  onPositionYChange: (position: number) => void;
  onScaleChange: (scale: number) => void;
  onResetImage: () => void;
  onUseOriginalImage: () => void;
  previewUrl: string | null;
  status: { status: "idle" | "uploading" | "failed"; error: string | null };
  uploadDisabled?: boolean;
}) {
  const [inputKey, setInputKey] = useState(0);
  const inputId = `presentation-image-upload-${itemId}-${inputKey}`;
  const hasCustomFrame = Boolean(imageRect);

  return (
    <div className="mt-3 rounded-2xl border border-zinc-100 bg-zinc-50 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Presentation Image</p>
          <p className="mt-1 text-xs text-zinc-500">{hasOverrideImage ? "Using presentation override image." : "Using quote image."}</p>
        </div>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
          {previewUrl ? (
            <QuotationImageFrame
              alt="Presentation image preview"
              className="h-full w-full overflow-hidden"
              imageClassName="block h-full w-full"
              imageUrl={previewUrl}
              minimumZoom={0.6}
              settings={{
                fit,
                zoom: imageScale,
                positionX: positionX === 0 ? Number.EPSILON : positionX,
                positionY: positionY === 0 ? Number.EPSILON : positionY,
              }}
            />
          ) : (
            <span className="px-1 text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-400">No Image</span>
          )}
        </div>
      </div>

      <input
        key={inputKey}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        id={inputId}
        disabled={uploadDisabled}
        onChange={async (event) => {
          if (uploadDisabled) return;
          const file = event.target.files?.[0];
          if (!file) return;
          await onFileSelected(file);
          setInputKey((current) => current + 1);
        }}
      />

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label
          htmlFor={uploadDisabled ? undefined : inputId}
          className={`inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 bg-white px-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] ${
            uploadDisabled
              ? "cursor-not-allowed text-zinc-400"
              : status.status === "uploading"
                ? "text-zinc-400"
                : "text-zinc-700 hover:text-zinc-950"
          }`}
        >
          {uploadDisabled ? "Upload disabled" : status.status === "uploading" ? "Uploading..." : "Replace image"}
        </label>
        <button
          type="button"
          disabled={!hasOverrideImage}
          onClick={onUseOriginalImage}
          className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 bg-white px-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-950 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-300"
        >
          Use original image
        </button>
      </div>

      {hasCustomFrame ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[#E3E7ED] bg-white px-3 py-2">
          <p className="text-xs text-[#151A24]">Custom frame set on the slide</p>
          <button
            type="button"
            onClick={onClearImageRect}
            className="shrink-0 rounded-[10px] border border-[#D5DAE2] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#151A24] transition hover:bg-zinc-50"
          >
            Clear custom frame
          </button>
        </div>
      ) : null}

      <div className="mt-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Image frame size</span>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(["small", "medium", "current"] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={hasCustomFrame}
              onClick={() => onFrameSizeChange(option)}
              className={`inline-flex h-10 min-w-0 items-center justify-center rounded-full border px-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                frameSize === option
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-950"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Fit</span>
        {(["contain", "cover"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onFitChange(option)}
            className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
              fit === option
                ? "border-zinc-950 bg-zinc-950 text-white"
                : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-950"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Image scale</span>
          <span className="text-[10px] font-semibold text-zinc-500">{Math.round(imageScale * 100)}%</span>
        </div>
        <input
          type="range"
          min={0.6}
          max={1.2}
          step={0.05}
          value={imageScale}
          disabled={hasCustomFrame}
          onChange={(event) => onScaleChange(Number(event.target.value))}
          className="mt-2 w-full accent-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Horizontal position</span>
          <span className="text-[10px] font-semibold text-zinc-500">{Math.round(positionX)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={positionX}
          disabled={hasCustomFrame}
          onChange={(event) => onPositionXChange(Number(event.target.value))}
          className="mt-2 w-full accent-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Vertical position</span>
          <span className="text-[10px] font-semibold text-zinc-500">{Math.round(positionY)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={positionY}
          disabled={hasCustomFrame}
          onChange={(event) => onPositionYChange(Number(event.target.value))}
          className="mt-2 w-full accent-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <p className="mt-3 text-xs leading-5 text-zinc-500">Frame size changes the available image area. Image scale changes the product size inside the frame. Position controls move it within the frame.</p>

      <button
        type="button"
        onClick={onResetImage}
        className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-full border border-zinc-300 bg-white px-4 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
      >
        Reset this item to presentation defaults
      </button>

      {status.error ? <p className="mt-2 text-xs text-red-700">{status.error}</p> : null}
    </div>
  );
}

export function QuotationPresentation({
  client,
  companyProfile,
  finishImageUrlByItemAndFinishId,
  imageUrlByItemId,
  mainLayoutImageUrlById,
  presentationOverrideImageUrlByItemId,
  sectionOverrideImageUrlBySectionAndField,
  initialSettings,
  project,
  quotation,
  sections,
  items,
  previewMode,
  printMode = false,
}: {
  client: PresentationClient;
  companyProfile: CompanyProfile;
  finishImageUrlByItemAndFinishId: ImageUrlRecord;
  imageUrlByItemId: ImageUrlRecord;
  mainLayoutImageUrlById: ImageUrlRecord;
  presentationOverrideImageUrlByItemId: ImageUrlRecord;
  sectionOverrideImageUrlBySectionAndField: ImageUrlRecord;
  initialSettings: QuotationPresentationSettings;
  project: PresentationProject;
  quotation: PresentationQuotation;
  sections: PresentationSection[];
  items: PresentationItem[];
  previewMode?: {
    disablePersistence?: boolean;
    disableUploads?: boolean;
  };
  printMode?: boolean;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionKey>("items");
  const [expandedFlowGroupIds, setExpandedFlowGroupIds] = useState<string[] | null>(null);
  const [expandedFlowSectionIds, setExpandedFlowSectionIds] = useState<string[] | null>(null);
  const [selectedPresentationItemId, setSelectedPresentationItemId] = useState<string | null>(null);
  // On-slide image editor: one selected product image at a time (editor preview only, never print).
  const [selectedSlideImageItemId, setSelectedSlideImageItemId] = useState<string | null>(null);
  const [expandedMainSectionLayoutIds, setExpandedMainSectionLayoutIds] = useState<string[] | null>(null);
  const [expandedSectionSettingsKeys, setExpandedSectionSettingsKeys] = useState<string[] | null>(null);
  const [overridePreviewUrlByItemId, setOverridePreviewUrlByItemId] = useState<ImageUrlRecord>(presentationOverrideImageUrlByItemId);
  const [mainLayoutPreviewUrlById, setMainLayoutPreviewUrlById] = useState<ImageUrlRecord>(mainLayoutImageUrlById);
  const [sectionOverridePreviewUrlBySectionAndField, setSectionOverridePreviewUrlBySectionAndField] = useState<ImageUrlRecord>(sectionOverrideImageUrlBySectionAndField);
  const [itemOverrideStatusByItemId, setItemOverrideStatusByItemId] = useState<ItemOverrideStatusMap>({});
  const [mainLayoutStatusById, setMainLayoutStatusById] = useState<MainLayoutStatusMap>({});
  const [sectionOverrideStatusByKey, setSectionOverrideStatusByKey] = useState<SectionOverrideStatusMap>({});
  const [savedSignature, setSavedSignature] = useState(() => settingsSignature(initialSettings));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSlideNavigatorOpen, setIsSlideNavigatorOpen] = useState(false);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [previewZoomMode, setPreviewZoomMode] = useState<"fit-width" | "manual">("fit-width");
  const [fitPreviewScale, setFitPreviewScale] = useState(1);
  const [manualPreviewScale, setManualPreviewScale] = useState(1);
  const [previewStackSize, setPreviewStackSize] = useState({ height: 0, width: 0 });
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const previewStackRef = useRef<HTMLDivElement>(null);
  const [isPending, startTransition] = useTransition();
  const persistenceDisabled = previewMode?.disablePersistence === true;
  const uploadsDisabled = previewMode?.disableUploads === true;

  useEffect(() => {
    Object.entries(settings.itemOverrides).forEach(([itemId, override]) => {
      if (!override.imageUrl || overridePreviewUrlByItemId[itemId]) return;

      void resolveQuotationImageUrl(override.imageUrl)
        .then((resolvedUrl) => {
          setOverridePreviewUrlByItemId((current) => ({
            ...current,
            [itemId]: resolvedUrl,
          }));
        })
        .catch(() => {
          setItemOverrideStatus(itemId, "failed", "Presentation image could not be loaded.");
        });
    });
  }, [overridePreviewUrlByItemId, settings.itemOverrides]);

  useEffect(() => {
    Object.entries(settings.mainSectionOverrides).forEach(([sectionId, override]) => {
      if (!override.layoutImageUrl || mainLayoutPreviewUrlById[sectionId]) return;

      void resolveQuotationImageUrl(override.layoutImageUrl)
        .then((resolvedUrl) => {
          setMainLayoutPreviewUrlById((current) => ({
            ...current,
            [sectionId]: resolvedUrl,
          }));
        })
        .catch(() => {
          setMainLayoutStatusById((current) => ({
            ...current,
            [sectionId]: { status: "failed", error: "Main layout image could not be loaded." },
          }));
        });
    });
  }, [mainLayoutPreviewUrlById, settings.mainSectionOverrides]);

  const activeItems = items.filter((item) => item.is_active !== false);
  const presentableItems = activeItems.filter(isPresentationItem);
  const hiddenItemIds = new Set(settings.hiddenItemIds);
  const itemsBySection = new Map<string, PresentationItem[]>();

  for (const item of activeItems) {
    const key = item.section_id ?? "unsectioned";
    itemsBySection.set(key, [...(itemsBySection.get(key) ?? []), item]);
  }

  const activeSections = [
    ...sections.filter((section) => section.is_active !== false),
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
    flowGroups,
    mainSections,
    sectionsById,
    sectionsByMainId,
  } = buildOrderedPresentationHierarchy(activeSections, activeItems, settings.flowOrder);
  const presentableItemsBySection = new Map(
    activeSections.map((section) => [
      section.id,
      (allPresentableItemsBySection.get(section.id) ?? []).filter((item) => !hiddenItemIds.has(item.id)),
    ] as const),
  );
  const visiblePresentableItems = presentableItems.filter((item) => !hiddenItemIds.has(item.id));
  const visibleCount = visiblePresentableItems.length;
  const totalCount = presentableItems.length;
  const isDirty = settingsSignature(settings) !== savedSignature;

  // Warn before leaving only while there are unsaved presentation changes.
  useEffect(() => {
    if (!isDirty || printMode) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, printMode]);
  const updatedAtLabel = formatUpdatedAt(settings.updatedAt);
  const isCompactLayout = settings.layoutMode === "two_per_page";
  const visibleContentOptions = isCompactLayout ? compactContentVisibilityOptions : fullContentVisibilityOptions;
  const controlSections = displaySections
    .map((section) => ({
      section,
      items: allPresentableItemsBySection.get(section.id) ?? [],
    }))
    .filter((entry) => entry.items.length > 0);
  const orderedPresentationItemsForSettings = controlSections.flatMap((entry) => entry.items);
  const orderedVisiblePresentationItems = controlSections.flatMap((entry) => (
    entry.items.filter((item) => !hiddenItemIds.has(item.id))
  ));
  const settingsItemNumberById = displayNumberByItemId(orderedPresentationItemsForSettings);
  const visibleSlideItemNumberById = displayNumberByItemId(orderedVisiblePresentationItems);
  const titledSectionsById = new Map(
    activeSections.map((section) => [section.id, sectionPresentationTitle(section, settings)] as const),
  );
  const mainSectionTitlesById = new Map(
    mainSections.map((section) => {
      const override = normalizedPresentationMainSectionOverride(settings.mainSectionOverrides[section.id]);
      return [section.id, resolvedOverrideValue(override.title, section.section_title) ?? section.section_title] as const;
    }),
  );
  const notedSectionsById = new Map(
    activeSections.map((section) => [section.id, sectionPresentationNote(section, settings)] as const),
  );
  const coverTitle = resolvedOverrideValue(settings.coverOverrides.title, defaultCoverText.title);
  const coverSubtitle = resolvedOverrideValue(settings.coverOverrides.subtitle, defaultCoverText.subtitle);
  const coverProjectDisplayName = resolvedOverrideValue(settings.coverOverrides.projectDisplayName, project?.project_name ?? quotation.title);
  const coverClientDisplayName = resolvedOverrideValue(settings.coverOverrides.clientDisplayName, client?.company_name ?? null);
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
    if (mainSectionOverrideHasCustomValue(settings.mainSectionOverrides[section.id])) return true;
    return (childrenByParent.get(section.id) ?? []).some((child) => (presentableItemsBySection.get(child.id) ?? []).length > 0);
  };
  const effectivePresentationImageUrlByItemId: ImageUrlRecord = { ...imageUrlByItemId };

  Object.entries(settings.itemOverrides).forEach(([itemId, override]) => {
    const overridePreviewUrl = overridePreviewUrlByItemId[itemId] ?? null;
    if (override.imageUrl && overridePreviewUrl) {
      effectivePresentationImageUrlByItemId[itemId] = overridePreviewUrl;
    }
  });
  const selectedPresentationItem = orderedPresentationItemsForSettings.find((item) => item.id === selectedPresentationItemId)
    ?? orderedPresentationItemsForSettings[0]
    ?? null;
  const selectedPresentationSection = selectedPresentationItem
    ? controlSections.find(({ items: sectionItems }) => sectionItems.some((item) => item.id === selectedPresentationItem.id))?.section ?? null
    : null;

  const dividerSections = displaySections.filter(sectionHasContent);
  const productPagesBySection = new Map(
    dividerSections.map((section) => {
      const sectionItems = presentableItemsBySection.get(section.id) ?? [];
      const groups = settings.layoutMode === "two_per_page"
        ? chunkItems(sectionItems, 2)
        : sectionItems.map((item) => [item]);
      return [section.id, groups] as const;
    }),
  );
  const presentationSlides = buildPresentationSlides({
    closingTitle,
    coverTitle,
    dividerSections,
    mainSectionTitlesById,
    productPagesBySection,
    sectionTitlesById: titledSectionsById,
    settings,
  });
  const visibleSlideCount = presentationSlides.length;
  const previewScale = previewZoomMode === "fit-width" ? fitPreviewScale : manualPreviewScale;

  // The editor preview always scales to fit its column (desktop and mobile). Print/PDF stays at natural size.
  const scalePreview = !printMode;

  useEffect(() => {
    if (!scalePreview) return;

    const viewport = previewViewportRef.current;
    const stack = previewStackRef.current;
    if (!viewport || !stack) return;

    const updatePreviewSize = () => {
      const width = stack.scrollWidth;
      const height = stack.scrollHeight;
      setPreviewStackSize({ height, width });

      if (previewZoomMode === "fit-width" && width > 0) {
        setFitPreviewScale(Math.min(Math.max((viewport.clientWidth - 8) / width, 0.2), 1));
      }
    };

    updatePreviewSize();
    const resizeObserver = new ResizeObserver(updatePreviewSize);
    resizeObserver.observe(viewport);
    resizeObserver.observe(stack);
    return () => resizeObserver.disconnect();
  }, [scalePreview, previewZoomMode, visibleSlideCount]);

  function adjustPreviewZoom(change: number) {
    setManualPreviewScale(Math.min(Math.max(previewScale + change, 0.2), 1.5));
    setPreviewZoomMode("manual");
  }
  const sectionsWithoutVisibleItemsCount = displaySections.filter((section) => {
    const totalItems = allPresentableItemsBySection.get(section.id) ?? [];
    const visibleItems = presentableItemsBySection.get(section.id) ?? [];
    return totalItems.length > 0 && visibleItems.length === 0;
  }).length;

  function updateSettings(next: QuotationPresentationSettings) {
    setSettings(next);
    if (saveState !== "idle") {
      setSaveState("idle");
      setSaveMessage(null);
    }
  }

  function toggleHiddenItem(itemId: string, include: boolean) {
    const nextHiddenItemIds = include
      ? settings.hiddenItemIds.filter((entry) => entry !== itemId)
      : Array.from(new Set([...settings.hiddenItemIds, itemId]));

    updateSettings({
      ...settings,
      hiddenItemIds: nextHiddenItemIds,
    });
  }

  function toggleFlowGroupExpanded(groupId: string) {
    setExpandedFlowGroupIds((current) => {
      const base = current ?? (flowGroups[0] ? [flowGroups[0].id] : []);
      return base.includes(groupId)
        ? base.filter((entry) => entry !== groupId)
        : [...base, groupId];
    });
  }

  function toggleFlowSectionExpanded(sectionId: string) {
    setExpandedFlowSectionIds((current) => {
      const defaultSectionId = flowGroups[0]?.sections[0]?.id ?? null;
      const base = current ?? (defaultSectionId ? [defaultSectionId] : []);
      return base.includes(sectionId)
        ? base.filter((entry) => entry !== sectionId)
        : [...base, sectionId];
    });
  }

  function toggleSectionSettingsExpanded(sectionId: string) {
    setExpandedSectionSettingsKeys((current) => {
      const base = current ?? [];
      return base.includes(sectionId)
        ? base.filter((entry) => entry !== sectionId)
        : [...base, sectionId];
    });
  }

  function toggleMainSectionLayoutExpanded(sectionId: string) {
    setExpandedMainSectionLayoutIds((current) => {
      const base = current ?? [];
      return base.includes(sectionId)
        ? base.filter((entry) => entry !== sectionId)
        : [...base, sectionId];
    });
  }

  function toggleSectionItems(itemIds: string[], include: boolean) {
    const uniqueItemIds = Array.from(new Set(itemIds));
    const nextHiddenItemIds = include
      ? settings.hiddenItemIds.filter((entry) => !uniqueItemIds.includes(entry))
      : Array.from(new Set([...settings.hiddenItemIds, ...uniqueItemIds]));

    updateSettings({
      ...settings,
      hiddenItemIds: nextHiddenItemIds,
    });
  }

  function toggleMainAreaItems(sectionIds: string[], include: boolean) {
    const itemIds = sectionIds.flatMap((sectionId) => (
      allPresentableItemsBySection.get(sectionId) ?? []
    )).map((item) => item.id);

    toggleSectionItems(itemIds, include);
  }

  function updateContentVisibility(field: VisibilityField, checked: boolean) {
    updateSettings({
      ...settings,
      contentVisibility: {
        ...settings.contentVisibility,
        [field]: checked,
      },
    });
  }

  function resetHiddenItems() {
    updateSettings({
      ...settings,
      hiddenItemIds: [],
    });
  }

  function updateFlowOrder(nextFlowOrder: PresentationFlowOrder) {
    updateSettings({
      ...settings,
      flowOrder: normalizeFlowOrder(nextFlowOrder),
    });
  }

  function moveMainSection(sectionId: string, direction: "up" | "down") {
    const orderedIds = mainSections.map((section) => section.id);
    const nextIds = moveOrderedEntry(orderedIds, sectionId, direction);
    if (nextIds.join("|") === orderedIds.join("|")) return;

    updateFlowOrder({
      ...settings.flowOrder,
      mainSectionKeys: nextIds,
    });
  }

  function moveSectionWithinMain(mainSectionId: string, sectionId: string, direction: "up" | "down") {
    const orderedSections = sectionsByMainId.get(mainSectionId) ?? [];
    const orderedIds = orderedSections.map((section) => section.id);
    const nextIds = moveOrderedEntry(orderedIds, sectionId, direction);
    if (nextIds.join("|") === orderedIds.join("|")) return;

    updateFlowOrder({
      ...settings.flowOrder,
      sectionKeysByMain: {
        ...settings.flowOrder.sectionKeysByMain,
        [mainSectionId]: nextIds,
      },
    });
  }

  function moveItemWithinSection(sectionId: string, itemId: string, direction: "up" | "down") {
    const orderedIds = (allPresentableItemsBySection.get(sectionId) ?? []).map((item) => item.id);
    const nextIds = moveOrderedEntry(orderedIds, itemId, direction);
    if (nextIds.join("|") === orderedIds.join("|")) return;

    updateFlowOrder({
      ...settings.flowOrder,
      itemIdsBySection: {
        ...settings.flowOrder.itemIdsBySection,
        [sectionId]: nextIds,
      },
    });
  }

  function resetFlowOrder() {
    updateFlowOrder(DEFAULT_PRESENTATION_FLOW_ORDER);
  }

  function resetSlideFields() {
    updateSettings({
      ...settings,
      contentVisibility: DEFAULT_PRESENTATION_CONTENT_VISIBILITY,
    });
  }

  function updateLayoutMode(layoutMode: PresentationLayoutMode) {
    updateSettings({
      ...settings,
      layoutMode,
    });
  }

  function updatePageVisibility(field: PageVisibilityField, checked: boolean) {
    updateSettings({
      ...settings,
      pageVisibility: {
        ...settings.pageVisibility,
        [field]: checked,
      },
    });
  }

  function applyPresentationPreset(presetKey: PresentationPresetKey) {
    const preset = presentationPresets.find((entry) => entry.key === presetKey);
    if (!preset) return;

    const confirmed = window.confirm(
      `Apply ${preset.name} preset? This will update layout, slide content, and page visibility only. It will not change hidden items, images, titles, flow order, or quotation data.`,
    );
    if (!confirmed) return;

    updateSettings({
      ...settings,
      layoutMode: preset.layoutMode,
      contentVisibility: {
        ...DEFAULT_PRESENTATION_CONTENT_VISIBILITY,
        ...settings.contentVisibility,
        ...preset.contentVisibility,
      },
      pageVisibility: {
        ...DEFAULT_PRESENTATION_PAGE_VISIBILITY,
        ...settings.pageVisibility,
        ...preset.pageVisibility,
      },
    });
    setSaveState("idle");
    setSaveMessage("Preset applied. Save to keep these changes.");
    setActiveSettingsSection("presets");
  }

  function updateSectionOverride(sectionId: string, patch: Partial<PresentationSectionOverride>) {
    const currentOverride = normalizedPresentationSectionOverride(settings.sectionOverrides[sectionId]);
    const nextOverride: PresentationSectionOverride = {
      ...currentOverride,
      ...patch,
      title: typeof patch.title === "string" ? patch.title.trim() : currentOverride.title,
      note: typeof patch.note === "string" ? patch.note.trim() : currentOverride.note,
      areaImageUrl: typeof patch.areaImageUrl === "string" ? patch.areaImageUrl.trim() : currentOverride.areaImageUrl,
      sectionLayoutImageUrl: typeof patch.sectionLayoutImageUrl === "string" ? patch.sectionLayoutImageUrl.trim() : currentOverride.sectionLayoutImageUrl,
    };
    const nextOverrides = { ...settings.sectionOverrides };

    if (sectionOverrideHasCustomValue(nextOverride)) {
      nextOverrides[sectionId] = nextOverride;
    } else {
      delete nextOverrides[sectionId];
    }

    updateSettings({
      ...settings,
      sectionOverrides: nextOverrides,
    });
  }

  function updateMainSectionOverride(sectionId: string, patch: Partial<PresentationMainSectionOverride>) {
    const currentOverride = normalizedPresentationMainSectionOverride(settings.mainSectionOverrides[sectionId]);
    const nextOverride: PresentationMainSectionOverride = {
      ...currentOverride,
      ...patch,
      title: typeof patch.title === "string" ? patch.title.trim() : currentOverride.title,
      note: typeof patch.note === "string" ? patch.note.trim() : currentOverride.note,
      layoutImageUrl: typeof patch.layoutImageUrl === "string" ? patch.layoutImageUrl.trim() : currentOverride.layoutImageUrl,
    };
    const nextOverrides = { ...settings.mainSectionOverrides };

    if (mainSectionOverrideHasCustomValue(nextOverride)) {
      nextOverrides[sectionId] = nextOverride;
    } else {
      delete nextOverrides[sectionId];
    }

    updateSettings({
      ...settings,
      mainSectionOverrides: nextOverrides,
    });
  }

  function resetPageVisibility() {
    updateSettings({
      ...settings,
      pageVisibility: DEFAULT_PRESENTATION_PAGE_VISIBILITY,
    });
  }

  function resetSectionOverrides() {
    updateSettings({
      ...settings,
      sectionOverrides: {},
    });
    setSectionOverridePreviewUrlBySectionAndField({});
    setSectionOverrideStatusByKey({});
  }

  function resetPresentationVisuals() {
    updateSettings({
      ...settings,
      mainSectionOverrides: {},
      presentationVisuals: DEFAULT_PRESENTATION_VISUALS,
    });
    setMainLayoutPreviewUrlById({});
    setMainLayoutStatusById({});
    setExpandedMainSectionLayoutIds(null);
  }

  function updateCoverOverride(field: CoverOverrideField, value: string) {
    updateSettings({
      ...settings,
      coverOverrides: {
        ...settings.coverOverrides,
        [field]: value,
      },
    });
  }

  function resetCoverOverrides() {
    updateSettings({
      ...settings,
      coverOverrides: DEFAULT_PRESENTATION_COVER_OVERRIDES,
    });
  }

  function updateClosingOverride(field: ClosingOverrideField, value: string) {
    updateSettings({
      ...settings,
      closingOverrides: {
        ...settings.closingOverrides,
        [field]: value,
      },
    });
  }

  function resetClosingOverrides() {
    updateSettings({
      ...settings,
      closingOverrides: DEFAULT_PRESENTATION_CLOSING_OVERRIDES,
    });
  }

  function setItemOverrideStatus(itemId: string, status: "idle" | "uploading" | "failed", error: string | null = null) {
    setItemOverrideStatusByItemId((current) => ({
      ...current,
      [itemId]: { status, error },
    }));
  }

  function setSectionOverrideStatus(key: string, status: "idle" | "uploading" | "failed", error: string | null = null) {
    setSectionOverrideStatusByKey((current) => ({
      ...current,
      [key]: { status, error },
    }));
  }

  function setMainLayoutStatus(layoutId: string, status: "idle" | "uploading" | "failed", error: string | null = null) {
    setMainLayoutStatusById((current) => ({
      ...current,
      [layoutId]: { status, error },
    }));
  }

  function updateItemOverride(itemId: string, patch: Partial<PresentationItemOverride>) {
    const currentOverride = normalizedPresentationItemOverride(settings.itemOverrides[itemId]);
    const nextOverride: PresentationItemOverride = {
      ...currentOverride,
      ...patch,
      imageUrl: typeof patch.imageUrl === "string" ? patch.imageUrl.trim() : currentOverride.imageUrl,
      imagePosition: "center",
    };
    const nextItemOverrides = { ...settings.itemOverrides };

    if (itemOverrideHasCustomValue(nextOverride)) {
      nextItemOverrides[itemId] = nextOverride;
    } else {
      delete nextItemOverrides[itemId];
    }

    updateSettings({
      ...settings,
      itemOverrides: nextItemOverrides,
    });
  }

  async function handlePresentationItemImageUpload(itemId: string, file: File) {
    setItemOverrideStatus(itemId, "uploading");

    try {
      const upload = await uploadQuotationItemImage({ file, itemId, quotationId: quotation.id });
      const storedPath = normalizeStoredImagePath(upload.bucket, upload.path);
      const resolvedUrl = await resolveQuotationImageUrl(storedPath);

      setOverridePreviewUrlByItemId((current) => ({
        ...current,
        [itemId]: resolvedUrl,
      }));
      updateItemOverride(itemId, { imageUrl: storedPath });
      setItemOverrideStatus(itemId, "idle");
    } catch (error) {
      setItemOverrideStatus(itemId, "failed", error instanceof Error ? error.message : "Image upload failed.");
    }
  }

  function resetPresentationItemImage(itemId: string) {
    setOverridePreviewUrlByItemId((current) => ({
      ...current,
      [itemId]: null,
    }));
    updateItemOverride(itemId, { ...DEFAULT_PRESENTATION_ITEM_OVERRIDE, imageRect: undefined });
    setSelectedSlideImageItemId((current) => (current === itemId ? null : current));
    setItemOverrideStatus(itemId, "idle");
  }

  function restoreOriginalPresentationItemImage(itemId: string) {
    setOverridePreviewUrlByItemId((current) => ({
      ...current,
      [itemId]: null,
    }));
    updateItemOverride(itemId, { imageUrl: "" });
    setItemOverrideStatus(itemId, "idle");
  }

  async function handleSectionOverrideImageUpload(sectionId: string, field: SectionImageField, file: File) {
    const statusKey = `${sectionId}:${field}`;
    setSectionOverrideStatus(statusKey, "uploading");

    try {
      const variant = field === "areaImageUrl" ? "area" : "section-layout";
      const upload = await uploadQuotationPresentationSectionImage({ file, quotationId: quotation.id, sectionId, variant });
      const storedPath = normalizeStoredImagePath(upload.bucket, upload.path);
      const resolvedUrl = await resolveQuotationImageUrl(storedPath);

      setSectionOverridePreviewUrlBySectionAndField((current) => ({
        ...current,
        [statusKey]: resolvedUrl,
      }));
      updateSectionOverride(sectionId, { [field]: storedPath });
      setSectionOverrideStatus(statusKey, "idle");
    } catch (error) {
      setSectionOverrideStatus(statusKey, "failed", error instanceof Error ? error.message : "Image upload failed.");
    }
  }

  function resetSectionOverrideImage(sectionId: string, field: SectionImageField) {
    const statusKey = `${sectionId}:${field}`;
    setSectionOverridePreviewUrlBySectionAndField((current) => ({
      ...current,
      [statusKey]: null,
    }));
    updateSectionOverride(sectionId, { [field]: "" });
    setSectionOverrideStatus(statusKey, "idle");
  }

  async function handleMainLayoutImageUpload(sectionId: string, file: File) {
    setMainLayoutStatus(sectionId, "uploading");

    try {
      const upload = await uploadQuotationPresentationMainLayoutImage({ file, quotationId: quotation.id, layoutId: sectionId });
      const storedPath = normalizeStoredImagePath(upload.bucket, upload.path);
      const resolvedUrl = await resolveQuotationImageUrl(storedPath);

      setMainLayoutPreviewUrlById((current) => ({
        ...current,
        [sectionId]: resolvedUrl,
      }));
      updateMainSectionOverride(sectionId, { layoutImageUrl: storedPath });
      setMainLayoutStatus(sectionId, "idle");
    } catch (error) {
      setMainLayoutStatus(sectionId, "failed", error instanceof Error ? error.message : "Image upload failed.");
    }
  }

  function resetMainLayoutImage(sectionId: string) {
    setMainLayoutPreviewUrlById((current) => ({
      ...current,
      [sectionId]: null,
    }));
    updateMainSectionOverride(sectionId, { layoutImageUrl: "" });
    setMainLayoutStatus(sectionId, "idle");
  }

  function resetPresentationSettings() {
    updateSettings(normalizePresentationSettings({}));
    setOverridePreviewUrlByItemId({});
    setMainLayoutPreviewUrlById({});
    setSectionOverridePreviewUrlBySectionAndField({});
    setItemOverrideStatusByItemId({});
    setMainLayoutStatusById({});
    setExpandedFlowGroupIds(null);
    setExpandedFlowSectionIds(null);
    setExpandedMainSectionLayoutIds(null);
    setSectionOverrideStatusByKey({});
  }

  function saveSettings() {
    if (persistenceDisabled) {
      setSaveState("idle");
      setSaveMessage("Development preview only. Saving is disabled.");
      return;
    }

    startTransition(async () => {
      setSaveState("saving");
      setSaveMessage(null);

      try {
        const response = await fetch(`/api/quotations/${quotation.id}/presentation-settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings }),
        });
        const payload = await response.json() as SaveResponsePayload;

        if (!response.ok) {
          throw new Error(formatSaveError(payload, "Failed to save presentation settings."));
        }

        const savedSettings = normalizePresentationSettings(payload.settings);
        setSettings(savedSettings);
        setSavedSignature(settingsSignature(savedSettings));
        setSaveState("saved");
        setSaveMessage("Presentation settings saved.");
      } catch (error) {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "Failed to save presentation settings.");
      }
    });
  }

  function jumpToSlide(index: number) {
    const element = document.getElementById(slideDomId(index));
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
    setIsSlideNavigatorOpen(false);
  }

  return (
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-[#edf0f3] px-3 py-3 print:bg-white print:px-0 print:py-0 xl:overflow-x-visible xl:px-4 xl:py-6">
      <style>{`
        @page { size: ${PRESENTATION_PAGE_WIDTH} ${PRESENTATION_PAGE_HEIGHT}; margin: 0; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .presentation-theme { font-family: var(--font-presentation-sans), Arial, Helvetica, sans-serif; }
        .presentation-theme .presentation-serif { font-family: var(--font-presentation-serif), Georgia, "Times New Roman", serif; }
        /* Settings sidebar (editor page only): one shared set of overrides instead of per-control rewrites. */
        .presentation-settings-panel .text-zinc-950, .presentation-settings-panel .text-zinc-900, .presentation-settings-panel .text-zinc-800 { color: #151A24; }
        .presentation-settings-panel .text-zinc-700, .presentation-settings-panel .text-zinc-600 { color: #3B4252; }
        .presentation-settings-panel .text-zinc-500 { color: #6B7380; }
        .presentation-settings-panel .text-zinc-400 { color: #8A93A1; }
        .presentation-settings-panel .border-zinc-300 { border-color: #D5DAE2; }
        .presentation-settings-panel .border-zinc-200 { border-color: #E3E7ED; }
        .presentation-settings-panel .border-zinc-100 { border-color: #EEF1F5; }
        .presentation-settings-panel .ring-zinc-200 { --tw-ring-color: #E3E7ED; }
        .presentation-settings-panel .bg-zinc-50, .presentation-settings-panel .bg-zinc-50\/60, .presentation-settings-panel .bg-zinc-50\/70 { background-color: #F7F8FA; }
        .presentation-settings-panel .rounded-full { border-radius: 10px; }
        .presentation-settings-panel .rounded-lg, .presentation-settings-panel .rounded-xl, .presentation-settings-panel .rounded-2xl, .presentation-settings-panel .rounded-\[24px\] { border-radius: 12px; }
        .presentation-settings-panel .rounded-lg.h-8 { border-radius: 8px; }
        .presentation-settings-panel .bg-zinc-950, .presentation-settings-panel .bg-zinc-900 { background-color: #064e3b; border-color: #064e3b; color: #ffffff; }
        .presentation-settings-panel .border-zinc-950, .presentation-settings-panel .border-zinc-900 { border-color: #064e3b; }
        .presentation-settings-panel .hover\:bg-zinc-800:hover { background-color: #065f46; }
        .presentation-settings-panel .hover\:border-zinc-400:hover { border-color: #9AA1AD; }
        .presentation-settings-panel .hover\:text-zinc-950:hover { color: #151A24; }
        .presentation-settings-panel .disabled\:bg-zinc-300:disabled { background-color: #D3D7DE; color: #9AA1AD; }
        .presentation-settings-panel input[type="checkbox"], .presentation-settings-panel input[type="radio"] { accent-color: #064e3b; color: #064e3b; }
        .presentation-settings-panel input[type="range"], .presentation-settings-panel .accent-zinc-900 { accent-color: #064e3b; }
        .presentation-settings-panel input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]), .presentation-settings-panel textarea, .presentation-settings-panel select {
          border-color: #D5DAE2; border-radius: 10px; background-color: #ffffff; color: #151A24;
        }
        .presentation-settings-panel input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):focus, .presentation-settings-panel textarea:focus, .presentation-settings-panel select:focus {
          border-color: #064e3b; outline: 2px solid #064e3b; outline-offset: 1px; box-shadow: none;
        }
        .presentation-settings-panel button:focus-visible, .presentation-settings-panel label:focus-within, .presentation-settings-panel [tabindex]:focus-visible { outline: 2px solid #064e3b; outline-offset: 2px; }
        @media print {
          html, body { background: #ffffff; }
          .presentation-page { width: ${PRESENTATION_PAGE_WIDTH} !important; height: ${PRESENTATION_PAGE_HEIGHT} !important; break-after: page; page-break-after: always; overflow: hidden !important; }
          .presentation-page:last-child { break-after: auto !important; page-break-after: auto !important; }
          .presentation-stack { gap: 0 !important; }
          .presentation-preview-reservation { width: auto !important; height: auto !important; }
          .presentation-preview-content { width: auto !important; transform: none !important; }
          .presentation-workspace { display: block !important; max-width: none !important; }
        }
      `}</style>

      <div className={`mx-auto mb-4 grid max-w-full gap-3 print:hidden xl:hidden ${printMode ? "hidden" : ""}`}>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#151A24]">Presentation</p>
            <p className="mt-1 text-xs text-[#6B7380]">{visibleSlideCount} visible {visibleSlideCount === 1 ? "slide" : "slides"}</p>
          </div>
          <Link href={`/quotations/${quotation.id}`} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] px-3 text-xs font-semibold border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintActions>
            <PresentationPptxExportButton />
          </PrintActions>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-[#E3E7ED] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6B7380]">Presentation Settings</p>
            <p className="mt-1 text-xs text-[#151A24]">{visibleCount} visible / {totalCount} total items</p>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileSettingsOpen(true)}
            className="inline-flex h-10 shrink-0 items-center rounded-[10px] px-4 text-sm font-semibold border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
          >
            Open settings
          </button>
        </div>
      </div>

      <div className={`mx-auto mb-5 hidden w-full max-w-[1570px] print:hidden xl:block ${printMode ? "xl:hidden" : ""}`}>
        <div className="mb-4 flex items-center gap-4 rounded-2xl border border-[#E3E7ED] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <Link href={`/quotations/${quotation.id}`} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] px-3 text-sm font-semibold border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-[#151A24]">{[quotation.quotation_no, project?.project_name ?? quotation.title].filter(Boolean).join(" - ")}</p>
            <p className="truncate text-xs text-[#6B7380]">{[client?.company_name, project?.project_name, quotation.quotation_no].filter(Boolean).join(" / ")}</p>
          </div>
          <PrintActions showHint={false}>
            <PresentationPptxExportButton />
          </PrintActions>
        </div>

        <div className="flex items-stretch gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl border border-[#E3E7ED] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#EDF0F4] text-[#151A24]">
              <Layers aria-hidden="true" className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#151A24]">Quotation Presentation</p>
              <p className="mt-1 text-sm text-[#6B7380]">{visibleSlideCount} visible {visibleSlideCount === 1 ? "slide" : "slides"}. Landscape presentation preview. Use browser print to save as PDF.</p>
              <p className={`mt-1 text-xs ${isDirty ? "text-amber-700" : "text-[#6B7380]"}`}>
                {isDirty ? "Preview includes unsaved changes. Save to keep them." : "Preview matches the latest saved presentation settings."}
              </p>
            </div>
          </div>
          {[
            { icon: Layers, value: String(visibleSlideCount), label: "Visible slides", caption: `Total items: ${totalCount}` },
            { icon: ClipboardList, value: String(visibleCount), label: "Presentation items", caption: `${visibleCount} visible / ${totalCount} total` },
            { icon: Settings2, value: "Landscape", label: "Page orientation", caption: "Optimized for print" },
          ].map((card) => (
            <div key={card.label} className="flex w-[230px] shrink-0 items-center gap-3 rounded-2xl border border-[#E3E7ED] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EDF0F4] text-[#151A24]">
                <card.icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-lg font-bold leading-tight text-[#151A24]">{card.value}</p>
                <p className="truncate text-sm font-semibold text-[#151A24]">{card.label}</p>
                <p className="truncate text-xs text-[#6B7380]">{card.caption}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="presentation-workspace mx-auto w-full max-w-[1570px] min-w-0 print:block xl:grid xl:grid-cols-[minmax(0,1fr)_440px] xl:items-start xl:gap-6">
      <section className={`${isMobileSettingsOpen ? "fixed inset-3 z-50 block max-h-[calc(100dvh-1.5rem)] overflow-y-auto" : "hidden"} mx-auto w-auto max-w-full print:hidden xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:block xl:max-h-[calc(100vh-3rem)] xl:w-auto xl:self-start xl:overflow-y-auto xl:overscroll-contain ${printMode ? "hidden xl:hidden" : ""}`}>
        <div className="presentation-settings-panel rounded-2xl border border-[#E3E7ED] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Settings aria-hidden="true" className="h-5 w-5 shrink-0 text-[#151A24]" />
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#151A24]">Presentation Settings</p>
              </div>
              <div className="flex min-w-0 items-start gap-2 text-right text-xs text-[#6B7380]">
                {isDirty || saveState === "error"
                  ? <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  : <CircleCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />}
                <div className="min-w-0">
                  {updatedAtLabel ? <p>Last saved: {updatedAtLabel}</p> : <p>Not saved yet</p>}
                  {saveMessage ? (
                    <p className={saveState === "error" ? "text-red-600" : "text-emerald-700"}>
                      {saveMessage}
                    </p>
                  ) : (
                    <p className={isDirty ? "text-amber-700" : ""}>{isDirty ? "You have unsaved presentation changes." : "Presentation settings are up to date."}</p>
                  )}
                </div>
              </div>
            </div>
            {persistenceDisabled || uploadsDisabled ? <p className="text-xs text-amber-700">Development preview only. Saving and uploads are disabled.</p> : null}
            <div className="min-w-0">
              <p className="text-lg font-semibold text-[#151A24]">{visibleCount} visible / {totalCount} total items</p>
              <p className="mt-1 text-sm text-[#6B7380]">Manage presentation-only item visibility, layout, pages, and cover/closing text.</p>
              <p className="mt-1 text-sm text-[#6B7380]">{visibleSlideCount} visible {visibleSlideCount === 1 ? "slide" : "slides"} generated.</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsMobileSettingsOpen(false)}
                className="col-span-2 inline-flex h-10 items-center justify-center rounded-[10px] px-4 text-sm font-semibold border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 xl:hidden"
              >
                Close
              </button>
              <button
                type="button"
                disabled={persistenceDisabled || isPending || !isDirty}
                onClick={saveSettings}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-emerald-900 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:bg-[#D3D7DE] disabled:text-[#9AA1AD]"
              >
                <Save aria-hidden="true" className="h-4 w-4" />
                {persistenceDisabled ? "Preview only" : isPending ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={resetPresentationSettings}
                className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-4 text-sm font-semibold border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
              >
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Reset presentation
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-2 gap-y-1 border-b border-[#E3E7ED] sm:grid-cols-4">
            {settingsSections.map((section) => (
              <SettingsSectionButton
                key={section.key}
                icon={settingsSectionIcons[section.key]}
                active={section.key === "areasSections"
                  ? activeSettingsSection === "areasSections" || activeSettingsSection === "mainLayouts" || activeSettingsSection === "sections"
                  : activeSettingsSection === section.key}
                label={section.label}
                onClick={() => setActiveSettingsSection(section.key)}
              />
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-[#E3E7ED] bg-[#F7F8FA] p-4">
            {activeSettingsSection === "flow" ? (
              <>
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex items-center gap-2">
                      <List aria-hidden="true" className="h-4 w-4 shrink-0 text-[#151A24]" />
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#151A24]">Presentation Flow</p>
                    </div>
                    <p className="mt-2 text-sm text-[#6B7380]">Review the real presentation hierarchy, control visibility, and adjust presentation-only order.</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button
                      type="button"
                      onClick={resetFlowOrder}
                      className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-3 text-sm font-semibold border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                    >
                      <ListRestart aria-hidden="true" className="h-4 w-4" />
                      Reset flow order
                    </button>
                    <button
                      type="button"
                      onClick={resetHiddenItems}
                      className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-3 text-sm font-semibold border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                    >
                      <Eye aria-hidden="true" className="h-4 w-4" />
                      Show all items
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid min-w-0 gap-4">
                  {flowGroups.map((group, groupIndex) => {
                    const groupSectionIds = [
                      ...(group.mainSection ? [group.mainSection.id] : []),
                      ...group.sections.map((section) => section.id),
                    ];
                    const groupedChildSections = group.mainSection
                      ? (sectionsByMainId.get(group.mainSection.id) ?? [])
                      : group.sections;
                    const mainSectionIndex = group.mainSection
                      ? mainSections.findIndex((section) => section.id === group.mainSection!.id)
                      : -1;
                    const groupItems = groupSectionIds.flatMap((sectionId) => allPresentableItemsBySection.get(sectionId) ?? []);
                    const groupVisibleCount = groupItems.filter((item) => !hiddenItemIds.has(item.id)).length;
                    const groupTotalCount = groupItems.length;
                    const groupAllVisible = groupTotalCount > 0 && groupVisibleCount === groupTotalCount;
                    const groupSomeVisible = groupVisibleCount > 0 && groupVisibleCount < groupTotalCount;
                    const groupExpanded = expandedFlowGroupIds
                      ? expandedFlowGroupIds.includes(group.id)
                      : groupIndex === 0;
                    const groupTitle = group.mainSection?.section_title ?? group.sections[0]?.section_title ?? "Area";
                    const groupTypeLabel = group.mainSection ? "Main Area" : "Area";

                    return (
                      <div key={group.id} className="rounded-2xl border border-zinc-200 bg-white">
                        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-3 py-3">
                          <SectionVisibilityCheckbox
                            checked={groupAllVisible}
                            indeterminate={groupSomeVisible}
                            onChange={(checked) => toggleMainAreaItems(groupSectionIds, checked)}
                          />
                          <button
                            type="button"
                            onClick={() => toggleFlowGroupExpanded(group.id)}
                            className="min-w-0 text-left"
                          >
                            <div className="flex min-w-0 items-start gap-2">
                              <span className="mt-0.5 shrink-0 text-zinc-400">{groupExpanded ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}</span>
                              <p className="min-w-0 break-words text-sm font-semibold text-zinc-900">{groupTitle}</p>
                            </div>
                            <p className="mt-1 pl-5 text-xs uppercase tracking-[0.16em] text-zinc-400">{groupTypeLabel}</p>
                            <p className="mt-1 pl-5 text-xs leading-5 text-zinc-500">
                              {group.sections.length} sections • {groupVisibleCount} visible / {groupTotalCount} total
                            </p>
                          </button>
                          {group.mainSection ? (
                            <div className="col-start-2">
                              <FlowMoveButtons
                                disableUp={mainSectionIndex <= 0}
                                disableDown={mainSectionIndex >= mainSections.length - 1}
                                onMoveUp={() => moveMainSection(group.mainSection!.id, "up")}
                                onMoveDown={() => moveMainSection(group.mainSection!.id, "down")}
                              />
                            </div>
                          ) : null}
                        </div>

                        {groupExpanded ? (
                          <div className="grid gap-2 border-t border-zinc-100 px-3 py-3">
                            {group.sections.map((section, sectionIndex) => {
                              const sectionItems = allPresentableItemsBySection.get(section.id) ?? [];
                              const visibleSectionItemCount = sectionItems.filter((item) => !hiddenItemIds.has(item.id)).length;
                              const totalSectionItemCount = sectionItems.length;
                              const sectionAllVisible = totalSectionItemCount > 0 && visibleSectionItemCount === totalSectionItemCount;
                              const sectionSomeVisible = visibleSectionItemCount > 0 && visibleSectionItemCount < totalSectionItemCount;
                              const sectionExpanded = expandedFlowSectionIds
                                ? expandedFlowSectionIds.includes(section.id)
                                : groupIndex === 0 && sectionIndex === 0;
                              const sectionOrderIndex = group.mainSection
                                ? groupedChildSections.findIndex((entry) => entry.id === section.id)
                                : -1;

                              return (
                                <div key={section.id} className="ml-3 rounded-2xl border border-zinc-200 bg-zinc-50/60">
                                  <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-3 py-3">
                                    <SectionVisibilityCheckbox
                                      checked={sectionAllVisible}
                                      indeterminate={sectionSomeVisible}
                                      onChange={(checked) => toggleSectionItems(sectionItems.map((item) => item.id), checked)}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => toggleFlowSectionExpanded(section.id)}
                                      className="min-w-0 text-left"
                                    >
                                      <div className="flex min-w-0 items-start gap-2">
                                        <span className="mt-0.5 shrink-0 text-zinc-400">{sectionExpanded ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}</span>
                                        <p className="min-w-0 break-words text-sm font-semibold text-zinc-900">{section.section_title}</p>
                                      </div>
                                      <p className="mt-1 pl-5 text-xs uppercase tracking-[0.16em] text-zinc-400">Section / Area</p>
                                      <p className="mt-1 pl-5 text-xs leading-5 text-zinc-500">{visibleSectionItemCount} visible / {totalSectionItemCount} total</p>
                                    </button>
                                    {group.mainSection && section.id !== group.mainSection.id ? (
                                      <div className="col-start-2">
                                        <FlowMoveButtons
                                          disableUp={sectionOrderIndex <= 0}
                                          disableDown={sectionOrderIndex >= groupedChildSections.length - 1}
                                          onMoveUp={() => moveSectionWithinMain(group.mainSection!.id, section.id, "up")}
                                          onMoveDown={() => moveSectionWithinMain(group.mainSection!.id, section.id, "down")}
                                        />
                                      </div>
                                    ) : null}
                                  </div>

                                  {sectionExpanded ? (
                                    <div className="grid gap-2 border-t border-zinc-100 px-3 py-3">
                                      {sectionItems.map((item, itemIndex) => {
                                        const included = !hiddenItemIds.has(item.id);
                                        const thumbnailUrl = effectivePresentationImageUrlByItemId[item.id] ?? null;
                                        const title = productTitle(item);
                                        const itemNumber = String(settingsItemNumberById.get(item.id) ?? 0).padStart(2, "0");
                                        const subline = detailValue([
                                          item.item_code_snapshot,
                                          item.model_snapshot,
                                          item.brand_name_snapshot,
                                        ]);

                                        return (
                                          <div
                                            key={item.id}
                                            className={`ml-3 rounded-2xl border px-3 py-2.5 transition ${
                                              included
                                                ? "border-zinc-200 bg-white"
                                                : "border-zinc-200 bg-zinc-50 text-zinc-500"
                                            }`}
                                          >
                                            <div className="grid min-w-0 grid-cols-[auto_48px_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
                                              <input
                                                checked={included}
                                                className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-400"
                                                onChange={(event) => toggleHiddenItem(item.id, event.target.checked)}
                                                type="checkbox"
                                              />
                                              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
                                                {thumbnailUrl ? (
                                                  // eslint-disable-next-line @next/next/no-img-element
                                                  <img src={thumbnailUrl} alt={title} className="h-full w-full object-contain" />
                                                ) : (
                                                  <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-400">No Image</span>
                                                )}
                                              </div>
                                              <div className="min-w-0 flex-1">
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Item {itemNumber}</p>
                                                <p className="mt-1 text-sm font-semibold text-zinc-900" style={clampStyle(2)}>{title}</p>
                                                {subline ? (
                                                  <p className="mt-1 text-xs leading-5 text-zinc-500" style={clampStyle(2)}>{subline}</p>
                                                ) : null}
                                              </div>
                                              <div className="col-start-3">
                                                <FlowMoveButtons
                                                  disableUp={itemIndex <= 0}
                                                  disableDown={itemIndex >= sectionItems.length - 1}
                                                  onMoveUp={() => moveItemWithinSection(section.id, item.id, "up")}
                                                  onMoveDown={() => moveItemWithinSection(section.id, item.id, "down")}
                                                />
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {activeSettingsSection === "items" ? (
              <>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Items</p>
                  <p className="mt-1 text-sm text-zinc-500">Select one product to adjust its presentation visibility and image.</p>
                </div>

                <label className="mt-4 block min-w-0">
                  <span className="text-xs font-semibold text-zinc-700">Adjust item</span>
                  <select
                    value={selectedPresentationItem?.id ?? ""}
                    onChange={(event) => setSelectedPresentationItemId(event.target.value)}
                    disabled={!selectedPresentationItem}
                    className="mt-2 h-11 w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 disabled:bg-zinc-100 disabled:text-zinc-400"
                  >
                    {orderedPresentationItemsForSettings.map((item) => {
                      const itemNumber = settingsItemNumberById.get(item.id) ?? 0;
                      return <option key={item.id} value={item.id}>{`Item ${itemNumber} — ${productTitle(item)}`}</option>;
                    })}
                  </select>
                </label>

                {selectedPresentationItem ? (() => {
                  const item = selectedPresentationItem;
                  const included = !hiddenItemIds.has(item.id);
                  const thumbnailUrl = effectivePresentationImageUrlByItemId[item.id] ?? null;
                  const title = productTitle(item);
                  const itemNumber = settingsItemNumberById.get(item.id) ?? 0;
                  const itemOverride = normalizedPresentationItemOverride(settings.itemOverrides[item.id]);
                  const hasCustomItemAdjustment = itemOverrideHasCustomValue(settings.itemOverrides[item.id]);
                  const hasOverrideImage = Boolean(itemOverride.imageUrl);
                  const itemStatus = itemOverrideStatusByItemId[item.id] ?? { status: "idle" as const, error: null };

                  return (
                    <div className="mt-4 min-w-0">
                      <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Current presentation item</p>
                        <div className="mt-3 flex min-w-0 items-start gap-3">
                          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
                            {thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumbnailUrl} alt={title} className="h-full w-full object-contain" />
                            ) : (
                              <span className="px-1 text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-400">No Image</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Item {itemNumber}</p>
                            <p className="mt-1 break-words text-sm font-semibold text-zinc-900">{title}</p>
                            {item.model_snapshot && item.model_snapshot !== title ? <p className="mt-1 break-words text-xs text-zinc-500">{item.model_snapshot}</p> : null}
                            {item.brand_name_snapshot ? <p className="mt-1 break-words text-xs text-zinc-500">{item.brand_name_snapshot}</p> : null}
                            {selectedPresentationSection ? <p className="mt-1 break-words text-xs text-zinc-500">{selectedPresentationSection.section_title}</p> : null}
                            <p className="mt-2 text-xs leading-5 text-zinc-500">
                              {hasOverrideImage ? "Using presentation replacement image" : "Using original quotation image"}
                            </p>
                            <p className={`mt-1 text-xs font-semibold ${included ? "text-emerald-700" : "text-zinc-500"}`}>
                              {included ? "Visible in presentation" : "Hidden from presentation"}
                            </p>
                            <p className={`mt-1 text-xs font-semibold ${hasCustomItemAdjustment ? "text-amber-700" : "text-zinc-500"}`}>
                              {hasCustomItemAdjustment ? "Custom item adjustment" : "Using presentation defaults"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <label className="mt-3 flex min-h-11 min-w-0 items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-800">
                        <input
                          checked={included}
                          className="h-4 w-4 shrink-0 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-400"
                          onChange={(event) => toggleHiddenItem(item.id, event.target.checked)}
                          type="checkbox"
                        />
                        <span className="min-w-0">Show this item in presentation</span>
                      </label>

                      <PresentationItemImageControl
                        fit={itemOverride.imageFit}
                        frameSize={itemOverride.imageFrameSize}
                        hasOverrideImage={hasOverrideImage}
                        imageRect={itemOverride.imageRect ?? null}
                        imageScale={itemOverride.imageScale}
                        positionX={itemOverride.imagePositionX}
                        positionY={itemOverride.imagePositionY}
                        itemId={item.id}
                        onClearImageRect={() => {
                          updateItemOverride(item.id, { imageRect: undefined });
                          setSelectedSlideImageItemId(null);
                        }}
                        onFileSelected={(file) => handlePresentationItemImageUpload(item.id, file)}
                        onFitChange={(fit) => updateItemOverride(item.id, { imageFit: fit })}
                        onFrameSizeChange={(frameSize) => updateItemOverride(item.id, { imageFrameSize: frameSize })}
                        onPositionXChange={(position) => updateItemOverride(item.id, { imagePositionX: position })}
                        onPositionYChange={(position) => updateItemOverride(item.id, { imagePositionY: position })}
                        onScaleChange={(scale) => updateItemOverride(item.id, { imageScale: scale })}
                        onResetImage={() => resetPresentationItemImage(item.id)}
                        onUseOriginalImage={() => restoreOriginalPresentationItemImage(item.id)}
                        previewUrl={thumbnailUrl}
                        status={itemStatus}
                        uploadDisabled={uploadsDisabled}
                      />
                    </div>
                  );
                })() : (
                  <p className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">No presentation items are available.</p>
                )}
              </>
            ) : null}

            {activeSettingsSection === "layout" ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Slide Layout</p>
                <p className="mt-1 text-sm text-zinc-500">Choose how visible items are arranged in the presentation.</p>

                <div className="mt-4 grid max-w-3xl gap-3">
                  {layoutModeOptions.map((option) => (
                    <LayoutOption
                      key={option.value}
                      checked={settings.layoutMode === option.value}
                      description={option.description}
                      label={option.label}
                      onChange={() => updateLayoutMode(option.value)}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {activeSettingsSection === "content" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                      {isCompactLayout ? "Compact Card Content" : "Slide Content"}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {isCompactLayout
                        ? "Two-item slides are compact and image-first."
                        : "These options apply to full product slides."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetSlideFields}
                    className="inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Reset slide fields
                  </button>
                </div>

                <div className="mt-4 grid max-w-4xl gap-3">
                  {visibleContentOptions.map((option) => (
                    <ControlToggle
                      key={option.key}
                      checked={settings.contentVisibility[option.key]}
                      description={option.description}
                      label={option.label}
                      onChange={(checked) => updateContentVisibility(option.key, checked)}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {activeSettingsSection === "pages" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Pages</p>
                    <p className="mt-1 text-sm text-zinc-500">Control which non-product pages appear in this presentation.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetPageVisibility}
                    className="inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Reset pages
                  </button>
                </div>

                <div className="mt-4 grid max-w-4xl gap-3">
                  {pageVisibilityOptions.map((option) => (
                    <ControlToggle
                      key={option.key}
                      checked={settings.pageVisibility[option.key]}
                      description={option.description}
                      label={option.label}
                      onChange={(checked) => updatePageVisibility(option.key, checked)}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {activeSettingsSection === "areasSections" || activeSettingsSection === "mainLayouts" || activeSettingsSection === "sections" ? (
              <div className="min-w-0">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Areas &amp; Sections</p>
                  <p className="mt-1 text-sm text-zinc-500">Configure presentation-only titles, notes, images, and layouts for quotation areas and sections.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => document.getElementById("presentation-main-areas-settings")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                    >
                      Main Areas
                    </button>
                    <button
                      type="button"
                      onClick={() => document.getElementById("presentation-sections-settings")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                    >
                      Sections
                    </button>
                  </div>
                </div>

                <div className="mt-5 flex min-w-0 flex-col">
                <section id="presentation-sections-settings" className="order-2 mt-7 min-w-0 scroll-mt-6 border-t border-zinc-200 pt-5">
                <div className="grid min-w-0 gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Sections</p>
                    <p className="mt-1 text-sm text-zinc-500">Configure presentation-only titles, notes, images, and layouts for quotation sections.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetSectionOverrides}
                    className="inline-flex h-10 w-full items-center justify-center whitespace-nowrap rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Reset section settings
                  </button>
                </div>

                <div className="mt-4 grid min-w-0 gap-4">
                  {controlSections.map(({ section, items: sectionItems }) => {
                    const sectionOverride = normalizedPresentationSectionOverride(settings.sectionOverrides[section.id]);
                    const isExpanded = expandedSectionSettingsKeys ? expandedSectionSettingsKeys.includes(section.id) : false;
                    const areaPreviewUrl = sectionOverridePreviewUrlBySectionAndField[`${section.id}:areaImageUrl`] ?? null;
                    const sectionLayoutPreviewUrl = sectionOverridePreviewUrlBySectionAndField[`${section.id}:sectionLayoutImageUrl`] ?? null;

                    return (
                      <div key={section.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                        <button
                          type="button"
                          onClick={() => toggleSectionSettingsExpanded(section.id)}
                          className="grid w-full min-w-0 gap-1 border-b border-zinc-100 pb-3 text-left"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-zinc-400">{isExpanded ? "▾" : "▸"}</span>
                              <p className="min-w-0 break-words text-sm font-semibold text-zinc-900">{section.section_title}</p>
                            </div>
                            <p className="mt-1 pl-5 text-xs uppercase tracking-[0.18em] text-zinc-400">
                              {section.section_kind === "main" ? "Main Area" : "Area"}
                            </p>
                          </div>
                          <p className="pl-5 text-xs text-zinc-500">{sectionItems.length} items</p>
                        </button>

                        {isExpanded ? (
                          <div className="mt-3 grid gap-3">
                            <label className="block">
                              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Presentation title</span>
                              <input
                                type="text"
                                value={sectionOverride.title}
                                onChange={(event) => updateSectionOverride(section.id, { title: event.target.value })}
                                placeholder={section.section_title}
                                className={textInputClassName()}
                              />
                            </label>

                            <label className="block">
                              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Section note</span>
                              <textarea
                                value={sectionOverride.note}
                                onChange={(event) => updateSectionOverride(section.id, { note: event.target.value })}
                                placeholder={section.section_notes ?? "Selected furniture proposal for this area."}
                                className={textareaClassName()}
                              />
                            </label>

                            <div className="grid gap-3">
                              <PresentationImageInput
                                description="Upload or paste a rendered view, mood image, or reference visual for this area."
                                fieldLabel="Area Image"
                                imageUrl={areaPreviewUrl}
                                inputId={`section-area-image-${section.id}`}
                                onFileSelected={(file) => handleSectionOverrideImageUpload(section.id, "areaImageUrl", file)}
                                onReset={() => resetSectionOverrideImage(section.id, "areaImageUrl")}
                                status={sectionOverrideStatusByKey[`${section.id}:areaImageUrl`] ?? { status: "idle", error: null }}
                                uploadDisabled={uploadsDisabled}
                              />
                              <PresentationImageInput
                                description="Upload or paste the cropped layout or floor-plan snapshot for this specific area."
                                fieldLabel="Section Layout Snapshot"
                                imageUrl={sectionLayoutPreviewUrl}
                                inputId={`section-layout-image-${section.id}`}
                                onFileSelected={(file) => handleSectionOverrideImageUpload(section.id, "sectionLayoutImageUrl", file)}
                                onReset={() => resetSectionOverrideImage(section.id, "sectionLayoutImageUrl")}
                                status={sectionOverrideStatusByKey[`${section.id}:sectionLayoutImageUrl`] ?? { status: "idle", error: null }}
                                uploadDisabled={uploadsDisabled}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                </section>

                <section id="presentation-main-areas-settings" className="order-1 min-w-0 scroll-mt-6">
                <div className="grid min-w-0 gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Main Areas</p>
                    <p className="mt-1 text-sm text-zinc-500">Configure titles, notes, and layout pages for quotation top-level areas.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetPresentationVisuals}
                    className="inline-flex h-10 w-full items-center justify-center whitespace-nowrap rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Reset main area layouts
                  </button>
                </div>

                <div className="mt-4 grid min-w-0 gap-4">
                  {mainSections.length ? mainSections.map((section, index) => {
                    const override = normalizedPresentationMainSectionOverride(settings.mainSectionOverrides[section.id]);
                    const isExpanded = expandedMainSectionLayoutIds ? expandedMainSectionLayoutIds.includes(section.id) : index === 0;
                    const previewUrl = mainLayoutPreviewUrlById[section.id] ?? null;
                    const status = mainLayoutStatusById[section.id] ?? { status: "idle", error: null };
                    const displayTitle = override.title || section.section_title;

                    return (
                      <div key={section.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                        <div className="flex min-w-0 flex-col items-start gap-1 border-b border-zinc-100 pb-3">
                          <button
                            type="button"
                            onClick={() => toggleMainSectionLayoutExpanded(section.id)}
                            className="flex min-w-0 items-center gap-3 text-left"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-400">{isExpanded ? "v" : ">"}</span>
                                <p className="min-w-0 break-words text-sm font-semibold text-zinc-900">{displayTitle}</p>
                              </div>
                              <p className="mt-1 pl-5 text-xs uppercase tracking-[0.18em] text-zinc-400">
                                Main Area {String(index + 1).padStart(2, "0")}
                              </p>
                            </div>
                          </button>
                          <p className="pl-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">From quotation</p>
                        </div>

                        {isExpanded ? (
                          <div className="mt-3 grid gap-3">
                            <TextField
                              label="Main Area Title"
                              description="Editable title shown as the main heading on the Main Area page."
                              value={override.title}
                              placeholder={section.section_title}
                              onChange={(value) => updateMainSectionOverride(section.id, { title: value })}
                            />
                            <TextAreaField
                              label="Main Area Note"
                              description="Optional supporting note shown on the Main Area page."
                              value={override.note}
                              placeholder="Overall floor layout for presentation review."
                              onChange={(value) => updateMainSectionOverride(section.id, { note: value })}
                            />
                            <div className="max-w-xl">
                              <PresentationImageInput
                                description="Upload or paste the full floor layout shown inside the main area slide."
                                fieldLabel="Full Floor Layout Image"
                                imageUrl={previewUrl}
                                inputId={`presentation-main-layout-image-${section.id}`}
                                onFileSelected={(file) => handleMainLayoutImageUpload(section.id, file)}
                                onReset={() => resetMainLayoutImage(section.id)}
                                status={status}
                                uploadDisabled={uploadsDisabled}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  }) : (
                    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-5 py-6 text-center">
                      <p className="text-sm font-semibold text-zinc-900">No main sections found.</p>
                      <p className="mt-2 text-sm text-zinc-500">Main Area Layouts appear automatically from the quotation&apos;s top-level section hierarchy.</p>
                    </div>
                  )}
                </div>
                </section>
                </div>
              </div>
            ) : null}

            {activeSettingsSection === "cover" ? (
              <>
                <div className="grid min-w-0 gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Cover Details</p>
                    <p className="mt-1 text-sm text-zinc-500">Customize the cover page text for this presentation only.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetCoverOverrides}
                    className="inline-flex h-10 w-full items-center justify-center whitespace-nowrap rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Reset cover details
                  </button>
                </div>

                <div className="mt-3 grid gap-2">
                  <TextField
                    compact
                    label="Presentation title"
                    description="Main title shown on the cover page."
                    value={settings.coverOverrides.title}
                    placeholder={defaultCoverText.title}
                    onChange={(value) => updateCoverOverride("title", value)}
                  />
                  <TextField
                    compact
                    label="Prepared by display name"
                    description="Shown on the cover page without changing company profile data."
                    value={settings.coverOverrides.preparedBy}
                    placeholder={defaultCoverText.preparedBy}
                    onChange={(value) => updateCoverOverride("preparedBy", value)}
                  />
                  <TextField
                    compact
                    label="Project display name"
                    description="Presentation-only project name shown on the cover."
                    value={settings.coverOverrides.projectDisplayName}
                    placeholder={project?.project_name ?? quotation.title}
                    onChange={(value) => updateCoverOverride("projectDisplayName", value)}
                  />
                  <TextField
                    compact
                    label="Client display name"
                    description="Presentation-only client name shown on the cover."
                    value={settings.coverOverrides.clientDisplayName}
                    placeholder={client?.company_name ?? "Client name"}
                    onChange={(value) => updateCoverOverride("clientDisplayName", value)}
                  />
                  <TextField
                    compact
                    label="Website"
                    description="Displayed on the dark cover panel."
                    value={settings.coverOverrides.website}
                    placeholder={defaultCoverText.website}
                    onChange={(value) => updateCoverOverride("website", value)}
                  />
                  <TextAreaField
                    compact
                    label="Cover subtitle"
                    description="Supporting introduction shown below the main title."
                    value={settings.coverOverrides.subtitle}
                    placeholder={defaultCoverText.subtitle}
                    onChange={(value) => updateCoverOverride("subtitle", value)}
                  />
                </div>
              </>
            ) : null}

            {activeSettingsSection === "closing" ? (
              <>
                <div className="grid min-w-0 gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Closing Details</p>
                    <p className="mt-1 text-sm text-zinc-500">Customize the thank-you page text and contact details for this presentation only.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetClosingOverrides}
                    className="inline-flex h-10 w-full items-center justify-center whitespace-nowrap rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Reset closing details
                  </button>
                </div>

                <div className="mt-3 grid gap-2">
                  <TextField
                    compact
                    label="Closing title"
                    description="Main title shown on the thank-you page."
                    value={settings.closingOverrides.title}
                    placeholder={defaultClosingText.title}
                    onChange={(value) => updateClosingOverride("title", value)}
                  />
                  <TextField
                    compact
                    label="Website"
                    description="Displayed once in the closing contact block."
                    value={settings.closingOverrides.website}
                    placeholder={defaultClosingText.website}
                    onChange={(value) => updateClosingOverride("website", value)}
                  />
                  <TextField
                    compact
                    label="Email"
                    description="Presentation-only closing contact email."
                    value={settings.closingOverrides.email}
                    placeholder={defaultClosingText.email}
                    onChange={(value) => updateClosingOverride("email", value)}
                  />
                  <TextField
                    compact
                    label="Phone"
                    description="Presentation-only closing contact phone."
                    value={settings.closingOverrides.phone}
                    placeholder={defaultClosingText.phone}
                    onChange={(value) => updateClosingOverride("phone", value)}
                  />
                  <TextField
                    compact
                    label="Office details"
                    description="Short office/location line for the closing page."
                    value={settings.closingOverrides.officeDetails}
                    placeholder={defaultClosingText.officeDetails}
                    onChange={(value) => updateClosingOverride("officeDetails", value)}
                  />
                  <TextAreaField
                    compact
                    label="Closing message"
                    description="Supporting message shown below the closing title."
                    value={settings.closingOverrides.message}
                    placeholder={defaultClosingText.message}
                    onChange={(value) => updateClosingOverride("message", value)}
                  />
                </div>
              </>
            ) : null}

            {activeSettingsSection === "presets" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Presentation Presets</p>
                    <p className="mt-1 text-sm text-zinc-500">Presets quickly update layout, slide content, and page visibility. They do not change hidden items, images, titles, flow order, or quotation data.</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {presentationPresets.map((preset) => (
                    <div key={preset.key} className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">{preset.name}</p>
                          <p className="mt-1 text-sm leading-6 text-zinc-500">{preset.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => applyPresentationPreset(preset.key)}
                          className="inline-flex h-9 shrink-0 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                        >
                          Apply
                        </button>
                      </div>
                      <div className="mt-4 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">What It Changes</p>
                        <p className="mt-2 text-sm leading-6 text-zinc-700">{preset.changes}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>

        {visibleCount === 0 ? (
          <div className="mt-4 rounded-[24px] border border-dashed border-zinc-300 bg-white px-5 py-6 text-center">
            <p className="text-sm font-semibold text-zinc-900">No presentation items selected.</p>
            <p className="mt-2 text-sm text-zinc-500">Use the item list above to include one or more quotation items before printing.</p>
          </div>
        ) : null}
      </section>

      <div className="min-w-0 print:block xl:col-start-1 xl:row-start-1">
      <section className={`mx-auto mb-4 w-[13.333in] max-w-full print:hidden ${printMode ? "hidden" : "block"}`}>
        <div className="rounded-2xl border border-[#E3E7ED] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Eye aria-hidden="true" className="h-5 w-5 text-[#151A24]" />
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#151A24]">Presentation Preview</p>
            </div>
            <div className="hidden text-xs text-[#6B7380] md:block">
              <p>In Chrome print settings, turn off Headers and footers for a clean PDF.</p>
              <p>Use Landscape orientation.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsSlideNavigatorOpen((current) => !current)}
                aria-expanded={isSlideNavigatorOpen}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
              >
                <List aria-hidden="true" className="h-4 w-4" />
                {isSlideNavigatorOpen ? "Hide Slide Navigator" : `Slide Navigator - ${visibleSlideCount} visible ${visibleSlideCount === 1 ? "slide" : "slides"}`}
                <ChevronRight aria-hidden="true" className={`h-4 w-4 transition ${isSlideNavigatorOpen ? "rotate-90" : ""}`} />
              </button>
              {isSlideNavigatorOpen ? (
                <button
                  type="button"
                  onClick={() => setIsSlideNavigatorOpen(false)}
                  className="inline-flex h-10 items-center rounded-[10px] px-4 text-sm font-semibold border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                >
                  Close
                </button>
              ) : null}
            </div>
          </div>

          {visibleCount === 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No presentation items selected.
            </div>
          ) : null}

          {sectionsWithoutVisibleItemsCount > 0 ? (
            <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              Some sections have no visible items.
            </div>
          ) : null}

          {isSlideNavigatorOpen ? (
            <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3">
              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <p className="text-sm font-semibold text-zinc-900">Jump to generated slides</p>
                <p className="text-xs text-zinc-500">List scrolls here, not on the full page.</p>
              </div>
              <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
                {presentationSlides.map((slide, index) => (
                  <button
                    key={slide.key}
                    type="button"
                    onClick={() => jumpToSlide(index)}
                    className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left transition hover:border-zinc-300 hover:bg-zinc-50 xl:grid-cols-[56px_120px_minmax(0,1fr)] xl:gap-3 xl:px-4"
                  >
                    <span className="text-sm font-semibold text-zinc-900">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{slideTypeLabel(slide.type)}</span>
                    <span className="col-span-2 truncate text-sm text-zinc-800 xl:col-span-1">
                      {slide.type === "product"
                        ? `Item ${String(visibleSlideItemNumberById.get(slide.itemIds[0] ?? "") ?? 0).padStart(2, "0")} - ${slide.title}`
                        : slide.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div className={printMode ? "" : "overflow-hidden rounded-2xl print:overflow-visible print:rounded-none"}>
      <div className={`items-center gap-2 bg-[#2B2D33] p-3 print:hidden ${printMode ? "hidden" : "flex"}`}>
        <button
          type="button"
          onClick={() => adjustPreviewZoom(-0.1)}
          disabled={previewScale <= 0.2}
          aria-label="Zoom out"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#363940] text-lg font-semibold text-zinc-100 transition hover:bg-[#42454D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-40"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setPreviewZoomMode("fit-width")}
          aria-label="Fit presentation preview to width"
          className={`inline-flex h-10 items-center justify-center rounded-lg px-3 text-xs font-semibold text-zinc-100 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 ${previewZoomMode === "fit-width" ? "bg-[#0F6B50]" : "bg-[#363940] hover:bg-[#42454D]"}`}
        >
          Fit width
        </button>
        <span className="inline-flex h-10 min-w-14 items-center justify-center rounded-lg bg-[#363940] px-2 text-xs font-semibold text-zinc-100">
          {Math.round(previewScale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => adjustPreviewZoom(0.1)}
          disabled={previewScale >= 1.5}
          aria-label="Zoom in"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#363940] text-lg font-semibold text-zinc-100 transition hover:bg-[#42454D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-40"
        >
          +
        </button>
      </div>

      <div className={printMode ? "" : "bg-[#5F6670] p-3 print:bg-transparent print:p-0"}>
      <div ref={previewViewportRef} className="min-w-0 overflow-x-auto overscroll-x-contain print:overflow-visible">
        <div
          className="presentation-preview-reservation mx-auto"
          style={scalePreview ? {
            height: previewStackSize.height * previewScale,
            width: previewStackSize.width * previewScale,
          } : undefined}
        >
        <div
          ref={previewStackRef}
          className="presentation-preview-content"
          style={scalePreview ? {
            transform: `scale(${previewScale})`,
            transformOrigin: "top left",
            width: PRESENTATION_PAGE_WIDTH,
          } : undefined}
        >
      <div className={`presentation-stack presentation-theme ${presentationSerif.variable} ${presentationSans.variable} mx-auto flex w-fit max-w-full flex-col gap-5`}>
        {presentationSlides.map((slide, slideIndex) => {
          const pageId = slideDomId(slideIndex);

          if (slide.type === "cover") {
            return (
              <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden" style={darkSlideStyle}>
                <ThemeBronzeGlow />
                <div aria-hidden="true" className="absolute" style={{ left: u(1790), top: u(96), width: u(2), height: u(888), background: presentationTheme.bronze }} />
                <div className="absolute flex flex-col justify-between" style={{ left: u(128), top: u(96), bottom: u(96), width: u(1560) }}>
                  <div className="flex items-center justify-between" style={{ gap: u(48) }}>
                    <PresentationBrandLogo
                      logoUrl={companyProfile.logoUrl}
                      fallbackText={coverPreparedBy ?? companyProfile.displayName}
                      className={themeLogoClassName}
                      fallbackClassName={themeLogoFallbackClassName}
                    />
                    {coverWebsite ? <p style={{ fontSize: u(24), lineHeight: 1.3, color: presentationTheme.muted }}>{coverWebsite}</p> : null}
                  </div>

                  <div>
                    <ThemeEyebrow>Client presentation</ThemeEyebrow>
                    <h1 className="presentation-serif" style={{ marginTop: u(32), maxWidth: u(1100), fontSize: u(120), fontWeight: 500, lineHeight: 1.02, color: presentationTheme.text }}>
                      {coverTitle}
                    </h1>
                    <div style={{ marginTop: u(36), width: u(120), height: u(3), background: presentationTheme.bronze }} />
                    {coverSubtitle ? (
                      <p style={{ ...clampStyle(3), marginTop: u(36), width: u(820), fontSize: u(28), lineHeight: 1.5, color: presentationTheme.muted }}>
                        {coverSubtitle}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-start justify-between" style={{ gap: u(48), borderTop: `1px solid ${presentationTheme.hairline}`, paddingTop: u(36) }}>
                    <ThemeInfoCell label="Project" value={coverProjectDisplayName} />
                    <ThemeInfoCell label="Quote no." value={quotation.quotation_no} />
                    <ThemeInfoCell label="Prepared for" value={coverClientDisplayName} />
                    <ThemeInfoCell label="Prepared by" value={coverPreparedBy} />
                    <ThemeInfoCell label="Date" value={formatPresentationDate(quotation.quotation_date)} />
                  </div>
                </div>
              </PresentationPage>
            );
          }

          if (slide.type === "design") {
            return (
              <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden" style={darkSlideStyle}>
                <div className="flex h-full flex-col" style={{ padding: `${u(96)} ${u(128)}` }}>
                  <div className="flex items-start justify-between" style={{ gap: u(64) }}>
                    <div className="min-w-0">
                      <ThemeEyebrow>Editorial overview</ThemeEyebrow>
                      <h2 className="presentation-serif" style={{ marginTop: u(16), fontSize: u(84), fontWeight: 500, lineHeight: 1.05, color: presentationTheme.text }}>
                        Design <span style={{ color: presentationTheme.bronze }}>considerations</span>
                      </h2>
                    </div>
                    <p className="shrink-0" style={{ ...clampStyle(4), width: u(620), fontSize: u(28), lineHeight: 1.5, color: presentationTheme.muted }}>
                      Core principles reviewed when aligning furniture choices with workflow, brand expression, and long-term performance.
                    </p>
                  </div>

                  <div className="mt-auto grid grid-cols-4" style={{ gap: u(24), gridAutoRows: "1fr" }}>
                    {designConsiderations.map((block, index) => (
                      <article
                        key={block.title}
                        className="min-w-0"
                        style={{ background: presentationTheme.card, borderTop: `${u(3)} solid ${presentationTheme.bronze}`, padding: u(32) }}
                      >
                        <p style={{ fontSize: u(24), fontWeight: 600, letterSpacing: u(2), lineHeight: 1.2, color: presentationTheme.bronze }}>
                          {String(index + 1).padStart(2, "0")}
                        </p>
                        <p style={{ marginTop: u(12), fontSize: u(28), fontWeight: 600, lineHeight: 1.25, color: presentationTheme.text }}>{block.title}</p>
                        <p style={{ ...clampStyle(4), marginTop: u(12), fontSize: u(24), lineHeight: 1.45, color: presentationTheme.muted }}>{block.body}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </PresentationPage>
            );
          }

          if (slide.type === "main-area") {
            const section = slide.mainSection;
            const mainSectionOverride = normalizedPresentationMainSectionOverride(settings.mainSectionOverrides[section.id]);
            const mainSectionTitle = resolvedOverrideValue(mainSectionOverride.title, section.section_title);
            const mainSectionNote = resolvedOverrideValue(mainSectionOverride.note, section.section_notes ?? null);
            const mainSectionPreviewUrl = mainSectionOverride.layoutImageUrl ? (mainLayoutPreviewUrlById[section.id] ?? null) : null;

            return (
              <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden" style={darkSlideStyle}>
                <div className="flex h-full items-stretch" style={{ padding: `${u(96)} ${u(128)}`, gap: u(72) }}>
                  <div className="flex shrink-0 flex-col justify-between" style={{ width: u(380), gap: u(32) }}>
                    <div className="flex min-h-0 flex-col" style={{ gap: u(24) }}>
                      <ThemeEyebrow>
                        Space overview {"·"} {String(mainSections.findIndex((entry) => entry.id === section.id) + 1).padStart(2, "0")}
                      </ThemeEyebrow>
                      <h2 className="presentation-serif [overflow-wrap:anywhere]" style={{ ...clampStyle(3), fontSize: u(72), fontWeight: 500, lineHeight: 1.05, letterSpacing: u(-1), color: presentationTheme.text }}>
                        {mainSectionTitle}
                      </h2>
                    </div>
                    <div className="flex flex-col" style={{ gap: u(20) }}>
                      <p style={{ fontSize: u(30), lineHeight: 1.3, color: presentationTheme.muted }}>
                        {mainSectionPreviewUrl ? "Floor layout overview" : "Main area overview"}
                      </p>
                      {mainSectionNote ? (
                        <p style={{ ...clampStyle(4), fontSize: u(24), lineHeight: 1.5, color: presentationTheme.muted }}>{mainSectionNote}</p>
                      ) : null}
                      <ThemeTagChip>{project?.project_name ?? quotation.title}</ThemeTagChip>
                    </div>
                  </div>

                  {mainSectionPreviewUrl ? (
                    <div className="flex shrink-0 flex-col bg-white" style={{ width: u(1212), height: u(888), padding: u(24), gap: u(12) }}>
                      <p className="uppercase" style={{ fontSize: u(20), fontWeight: 600, letterSpacing: u(3), lineHeight: 1.2, color: "#7A7A7A" }}>Full floor layout</p>
                      <div className="min-h-0 flex-1 overflow-hidden bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={mainSectionPreviewUrl} alt={`${mainSectionTitle} Full Floor Layout`} className="h-full w-full object-contain" />
                      </div>
                    </div>
                  ) : null}
                </div>
                <ThemeSlideFooter companyName={companyProfile.displayName} quotationNo={quotation.quotation_no} />
              </PresentationPage>
            );
          }

          if (slide.type === "section") {
            const section = slide.section;
            const mainSection = section.parent_section_id ? sectionsById.get(section.parent_section_id) ?? null : null;
            const sectionTitle = titledSectionsById.get(section.id) ?? section.section_title;
            const sectionNote = notedSectionsById.get(section.id) ?? null;
            const parentMainSectionTitle = mainSection
              ? (titledSectionsById.get(mainSection.id) ?? mainSection.section_title)
              : null;
            const sectionPageGroups = productPagesBySection.get(section.id) ?? [];
            const sectionVisuals = [
              { key: "area", label: "Area Image", imageUrl: sectionOverridePreviewUrlBySectionAndField[`${section.id}:areaImageUrl`] ?? null },
              { key: "section-layout", label: "Section Layout Snapshot", imageUrl: sectionOverridePreviewUrlBySectionAndField[`${section.id}:sectionLayoutImageUrl`] ?? null },
            ].filter((entry) => Boolean(entry.imageUrl));
            const singleVisual = sectionVisuals.length === 1;

            return (
              <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden" style={darkSlideStyle}>
                <div className="flex h-full items-stretch" style={{ padding: `${u(96)} ${u(128)}`, gap: u(72) }}>
                  <div className="flex shrink-0 flex-col justify-between" style={{ width: u(380), gap: u(32) }}>
                    <div className="flex min-h-0 flex-col" style={{ gap: u(24) }}>
                      <ThemeEyebrow>Area {"·"} {String(dividerSections.indexOf(section) + 1).padStart(2, "0")}</ThemeEyebrow>
                      <h2 className="presentation-serif [overflow-wrap:anywhere]" style={{ ...clampStyle(3), fontSize: u(72), fontWeight: 500, lineHeight: 1.05, letterSpacing: u(-1), color: presentationTheme.text }}>
                        {sectionTitle}
                      </h2>
                    </div>
                    <div className="flex flex-col" style={{ gap: u(20) }}>
                      {sectionNote ? (
                        <p style={{ ...clampStyle(4), fontSize: u(24), lineHeight: 1.5, color: presentationTheme.muted }}>{sectionNote}</p>
                      ) : null}
                      {mainSection && mainSection.id !== section.id ? (
                        <p style={{ fontSize: u(32), fontWeight: 500, lineHeight: 1.25, color: presentationTheme.text }}>Within {parentMainSectionTitle}</p>
                      ) : null}
                      <p style={{ fontSize: u(28), lineHeight: 1.3, color: presentationTheme.muted }}>
                        {sectionPageGroups.length ? `${sectionPageGroups.length} product ${sectionPageGroups.length === 1 ? "page" : "pages"} follow` : "Section overview"}
                      </p>
                      <ThemeTagChip>{project?.project_name ?? quotation.title}</ThemeTagChip>
                    </div>
                  </div>

                  {sectionVisuals.length ? (
                    <div className="flex shrink-0" style={{ width: u(1212), height: u(888), gap: u(24) }}>
                      {sectionVisuals.map((visual) => visual.key === "area" ? (
                        <div key={visual.key} className="relative h-full shrink-0 overflow-hidden" style={{ width: singleVisual ? u(1212) : u(520), background: presentationTheme.card }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={visual.imageUrl ?? undefined} alt={`${sectionTitle} ${visual.label}`} className="h-full w-full object-cover" />
                          <p
                            className="absolute uppercase"
                            style={{ left: u(20), bottom: u(20), padding: `${u(10)} ${u(16)}`, fontSize: u(20), fontWeight: 600, letterSpacing: u(3), lineHeight: 1.2, color: presentationTheme.text, background: "rgba(43,45,51,0.8)" }}
                          >
                            {visual.label}
                          </p>
                        </div>
                      ) : (
                        <div key={visual.key} className="flex h-full shrink-0 flex-col bg-white" style={{ width: singleVisual ? u(1212) : u(668), padding: u(24), gap: u(12) }}>
                          <p className="uppercase" style={{ fontSize: u(20), fontWeight: 600, letterSpacing: u(3), lineHeight: 1.2, color: "#7A7A7A" }}>{visual.label}</p>
                          <div className="min-h-0 flex-1 overflow-hidden bg-white">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={visual.imageUrl ?? undefined} alt={`${sectionTitle} ${visual.label}`} className="h-full w-full object-contain" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptySectionVisualState />
                  )}
                </div>
                <ThemeSlideFooter companyName={companyProfile.displayName} quotationNo={quotation.quotation_no} />
              </PresentationPage>
            );
          }

          if (slide.type === "product") {
            const section = slide.section;
            const sectionTitle = titledSectionsById.get(section.id) ?? section.section_title;
            const pageItems = slide.itemIds
              .map((itemId) => (presentableItemsBySection.get(section.id) ?? []).find((item) => item.id === itemId) ?? null)
              .filter((item): item is PresentationItem => Boolean(item));

            if (settings.layoutMode === "two_per_page") {
              const pageData = pageItems.map((item) => buildProductPageData({
                contentVisibility: settings.contentVisibility,
                finishImageUrlByItemAndFinishId,
                imageUrl: effectivePresentationImageUrlByItemId[item.id] ?? null,
                itemOverride: settings.itemOverrides[item.id],
                item,
                project,
              }));

              return (
                <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden bg-white">
                  {pageData.map((data, cardIndex) => (
                    <TwoPerPageCard
                      key={data.item.id}
                      data={data}
                      itemNumber={visibleSlideItemNumberById.get(data.item.id) ?? null}
                      left={cardIndex * 964}
                      preparedBy={companyProfile.displayName}
                      quotationNo={quotation.quotation_no}
                      sectionTitle={sectionTitle}
                      showDescription={settings.contentVisibility.specification}
                    />
                  ))}
                </PresentationPage>
              );
            }

            const item = pageItems[0];
            if (!item) return null;

            const data = buildProductPageData({
              contentVisibility: settings.contentVisibility,
              finishImageUrlByItemAndFinishId,
              imageUrl: effectivePresentationImageUrlByItemId[item.id] ?? null,
              itemOverride: settings.itemOverrides[item.id],
              item,
              project,
            });
            // All visible finishes up to PRODUCT_FINISH_LIMIT, regrouped by type in their original order.
            const allFinishes = compactFinishRows(data.finishGroups);
            const shownFinishes = allFinishes.slice(0, PRODUCT_FINISH_LIMIT);
            const hiddenFinishCount = Math.max(allFinishes.length - shownFinishes.length, 0);
            const shownFinishKeys = new Set(shownFinishes.map((finish) => `${finish.label}:${finish.id}`));
            const shownFinishGroups = data.finishGroups
              .map((group) => ({ label: group.label, items: group.items.filter((finish) => shownFinishKeys.has(`${group.label}:${finish.id}`)) }))
              .filter((group) => group.items.length);
            const descriptionLines = shownFinishGroups.length >= 3 || shownFinishes.length > 18 ? 4 : 6;
            const productBadgeStyle = { border: `1px solid ${presentationTheme.bronze}`, padding: `${u(2)} ${u(10)}`, fontSize: u(17), fontWeight: 600, letterSpacing: u(2), color: presentationTheme.bronze };

            return (
              <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden bg-white">
                <div aria-hidden="true" className="absolute" style={{ left: u(1240), top: 0, width: u(680), height: "100%", background: presentationTheme.bg }} />

                <ProductImageEditBox
                  editable={!printMode && Boolean(data.imageUrl)}
                  imageRect={data.imageRect}
                  measureKey={[data.imageUrl, data.imageSettings?.fit, data.imageFrameSize, data.imageScale, data.imagePositionX, data.imagePositionY].join("|")}
                  onRectChange={(rect) => updateItemOverride(item.id, { imageRect: rect })}
                  onSelectedChange={(isSelected) => setSelectedSlideImageItemId(isSelected ? item.id : null)}
                  selected={selectedSlideImageItemId === item.id}
                  style={{ left: u(60), top: u(40), width: u(1120), height: u(800) }}
                >
                  <PresentationImageStage
                    alt={data.heading}
                    boundsClassName={presentationImageBoundsClass(data.imageFrameSize, false)}
                    emptyContent={(
                      <div className="flex h-full w-full flex-col items-center justify-center bg-white text-center" style={{ gap: u(20), padding: `0 ${u(80)}` }}>
                        <div className="uppercase" style={{ border: `1px dashed ${productTheme.hairlineOnWhite}`, padding: `${u(6)} ${u(18)}`, fontSize: u(17), fontWeight: 600, letterSpacing: u(3), color: productTheme.mutedOnWhite }}>
                          Visual pending
                        </div>
                        <p style={{ ...clampStyle(3), maxWidth: u(640), fontSize: u(20), lineHeight: 1.5, color: productTheme.mutedOnWhite }}>
                          No quotation image is available for this item yet. The item remains included so the presentation sequence stays complete.
                        </p>
                      </div>
                    )}
                    fit={data.imageSettings?.fit === "cover" ? "cover" : "contain"}
                    imageRect={data.imageRect}
                    imageUrl={data.imageUrl}
                    positionX={data.imagePositionX}
                    positionY={data.imagePositionY}
                    scale={data.imageScale}
                  />
                </ProductImageEditBox>

                <div
                  className="absolute flex flex-wrap justify-between"
                  style={{ left: u(60), bottom: u(40), width: u(1120), borderTop: `1px solid ${productTheme.hairlineOnWhite}`, paddingTop: u(16), columnGap: u(40), rowGap: u(16) }}
                >
                  {data.meta.map((row) => (
                    <ProductDetailCell key={row.label} label={row.label} value={row.value} />
                  ))}
                  <ProductDetailCell label="Area" value={item.room_name_snapshot} />
                  <ProductDetailCell label="Quote no." value={quotation.quotation_no} />
                  <ProductDetailCell label="Prepared by" value={companyProfile.displayName} />
                </div>

                <div className="absolute flex flex-col justify-between" style={{ left: u(1292), top: u(56), width: u(580), height: u(984), gap: u(24) }}>
                  <div className="flex min-h-0 flex-col overflow-hidden" style={{ gap: u(20) }}>
                    <p className="uppercase" style={{ ...clampStyle(1), fontSize: u(20), fontWeight: 600, letterSpacing: u(5), lineHeight: 1.2, color: presentationTheme.bronze }}>
                      Item {visibleSlideItemNumberById.get(item.id) ?? 1}
                      {sectionTitle ? ` · ${sectionTitle}` : ""}
                    </p>
                    <div>
                      <h3 className="presentation-serif" style={{ ...clampStyle(2), fontSize: u(60), fontWeight: 500, lineHeight: 1, letterSpacing: u(-1), color: presentationTheme.text }}>
                        {data.heading}
                      </h3>
                      {data.item.is_optional || data.item.is_rate_only ? (
                        <div className="flex flex-wrap" style={{ marginTop: u(12), gap: u(8) }}>
                          {data.item.is_optional ? <span className="uppercase" style={productBadgeStyle}>Optional</span> : null}
                          {data.item.is_rate_only ? <span className="uppercase" style={productBadgeStyle}>Rate only</span> : null}
                        </div>
                      ) : null}
                    </div>
                    {data.summary ? (
                      <p className="uppercase" style={{ ...clampStyle(2), fontSize: u(19), fontWeight: 600, letterSpacing: u(3), lineHeight: 1.3, color: presentationTheme.bronze }}>{data.summary}</p>
                    ) : null}
                    {settings.contentVisibility.specification ? (
                      data.cleanedSpecification ? (
                        <p className="whitespace-pre-wrap" style={{ ...clampStyle(descriptionLines), fontSize: u(20), lineHeight: 1.5, color: presentationTheme.muted }}>
                          {data.cleanedSpecification}
                        </p>
                      ) : (
                        <p style={{ fontSize: u(20), lineHeight: 1.5, color: presentationTheme.muted, opacity: 0.7 }}>Specification details not added yet.</p>
                      )
                    ) : null}
                  </div>

                  {shownFinishGroups.length ? (
                    <div className="flex shrink-0 flex-col" style={{ borderTop: `1px solid ${presentationTheme.hairline}`, paddingTop: u(18), gap: u(16) }}>
                      <div className="flex items-baseline justify-between" style={{ gap: u(16) }}>
                        <p className="uppercase" style={{ fontSize: u(18), fontWeight: 600, letterSpacing: u(4), color: presentationTheme.text }}>Finishes</p>
                        {hiddenFinishCount ? <p className="uppercase" style={{ fontSize: u(17), letterSpacing: u(2), color: presentationTheme.bronze }}>+{hiddenFinishCount} more</p> : null}
                      </div>
                      {shownFinishGroups.map((group) => (
                        <div key={group.label} className="flex flex-col" style={{ gap: u(10) }}>
                          <p className="uppercase" style={{ fontSize: u(18), fontWeight: 600, letterSpacing: u(3), color: presentationTheme.bronze }}>{group.label}</p>
                          <div className="flex flex-wrap" style={{ width: u(580), rowGap: u(14), columnGap: u(10) }}>
                            {group.items.map((finish) => <ProductFinishChip key={finish.id} finish={finish} />)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </PresentationPage>
            );
          }

          return (
            <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden" style={darkSlideStyle}>
              <ThemeBronzeGlow />
              <div className="absolute flex flex-col justify-between" style={{ left: u(128), top: u(96), bottom: u(96), width: u(1000) }}>
                <div>
                  <PresentationBrandLogo
                    logoUrl={companyProfile.logoUrl}
                    fallbackText={companyProfile.displayName}
                    className={themeLogoClassName}
                    fallbackClassName={themeLogoFallbackClassName}
                  />
                </div>

                <div>
                  <h2 className="presentation-serif" style={{ fontSize: u(120), fontWeight: 500, lineHeight: 1.02, color: presentationTheme.text }}>
                    {closingTitle}
                  </h2>
                  <div style={{ marginTop: u(36), width: u(120), height: u(3), background: presentationTheme.bronze }} />
                  {closingMessage ? (
                    <p style={{ ...clampStyle(4), marginTop: u(36), width: u(700), fontSize: u(28), lineHeight: 1.5, color: presentationTheme.muted }}>
                      {closingMessage}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-start" style={{ gap: u(96), borderTop: `1px solid ${presentationTheme.hairline}`, paddingTop: u(36) }}>
                  <ThemeInfoCell label="Quote no." value={quotation.quotation_no} />
                  <ThemeInfoCell label="Date" value={quotation.quotation_date ? formatPresentationDate(quotation.quotation_date) : null} />
                </div>
              </div>

              <div
                className="absolute grid"
                style={{
                  right: u(128),
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: u(560),
                  gap: u(28),
                  padding: u(48),
                  background: presentationTheme.card,
                  borderTop: `${u(3)} solid ${presentationTheme.bronze}`,
                }}
              >
                <ThemeContactRow label="Website" value={closingWebsite} />
                <ThemeContactRow label="Email" value={closingEmail} />
                <ThemeContactRow label="Phone" value={closingPhone} />
                <ThemeContactRow label="Office" value={closingOfficeDetails} />
              </div>
            </PresentationPage>
          );
        })}
      </div>
        </div>
        </div>
      </div>
      </div>
      </div>
      </div>
      </div>
    </main>
  );
}
