"use client";

import { useEffect, useRef, useState, useTransition, type ClipboardEvent, type ReactNode } from "react";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
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
  DEFAULT_PRESENTATION_PAGE_VISIBILITY,
  DEFAULT_PRESENTATION_VISUALS,
  normalizeFlowOrder,
  normalizePresentationSettings,
  type PresentationClosingOverrides,
  type PresentationContentVisibility,
  type PresentationCoverOverrides,
  type PresentationFlowOrder,
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
type SettingsSectionKey = "flow" | "items" | "layout" | "content" | "pages" | "mainLayouts" | "sections" | "cover" | "closing" | "presets";
type PresentationPresetKey = "detailed" | "image_first" | "compact" | "client_review";
type ProductPageData = {
  item: PresentationItem;
  heading: string;
  imageUrl: string | null;
  imageSettings: Partial<ImageDisplaySettings> | undefined;
  imageScale: number;
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
  { key: "mainLayouts", label: "Main Area Layout" },
  { key: "sections", label: "Section Settings" },
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
          imagePosition: override.imagePosition,
          imageScale: override.imageScale,
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
  return {
    imageUrl: value?.imageUrl?.trim() ?? "",
    imageFit: value?.imageFit === "cover" ? "cover" : "contain",
    imagePosition: "center" as const,
    imageScale: Math.min(Math.max(Number(value?.imageScale) || 1, 0.6), 1.2),
  };
}

function itemOverrideHasCustomValue(value: PresentationItemOverride | undefined) {
  const normalized = normalizedPresentationItemOverride(value);
  return Boolean(
    normalized.imageUrl ||
    normalized.imageFit !== DEFAULT_PRESENTATION_ITEM_OVERRIDE.imageFit ||
    normalized.imagePosition !== DEFAULT_PRESENTATION_ITEM_OVERRIDE.imagePosition ||
    normalized.imageScale !== DEFAULT_PRESENTATION_ITEM_OVERRIDE.imageScale
  );
}

function presentationImageSettings(value: PresentationItemOverride | undefined): Partial<ImageDisplaySettings> | null {
  if (!itemOverrideHasCustomValue(value)) return null;

  const normalized = normalizedPresentationItemOverride(value);

  return {
    fit: normalized.imageFit,
    zoom: 1,
    positionX: 50,
    positionY: 50,
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

function PresentationPage({
  children,
  className = "",
  id,
  slideIndex,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  slideIndex?: number;
}) {
  return (
    <section
      id={id}
      data-presentation-slide="true"
      data-slide-index={typeof slideIndex === "number" ? slideIndex : undefined}
      className={`presentation-page overflow-hidden break-after-page bg-white text-zinc-900 shadow-[0_24px_80px_rgba(15,23,42,0.12)] print:shadow-none ${className}`}
      style={{ width: "297mm", height: "210mm" }}
    >
      {children}
    </section>
  );
}

function MetaCard({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

function MetaLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;

  return (
    <div className="border-b border-white/10 pb-3 last:border-b-0 last:pb-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">{label}</p>
      <p className="mt-1 text-sm font-medium leading-6 text-white">{value}</p>
    </div>
  );
}

function ContactLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;

  return (
    <div className="border-b border-white/10 pb-3 last:border-b-0 last:pb-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">{label}</p>
      <p className="mt-1 text-sm font-medium leading-6 text-white/90">{value}</p>
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

function ProductDetail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div className="grid gap-1 border-b border-zinc-200/80 pb-2.5 last:border-b-0 last:pb-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-400">{label}</dt>
      <dd className="text-sm font-medium leading-5 text-zinc-900 [overflow-wrap:anywhere]" style={clampStyle(2)}>{value}</dd>
    </div>
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
  imageUrl,
  scale,
}: {
  alt: string;
  boundsClassName: string;
  emptyContent: ReactNode;
  fit: PresentationImageFit;
  imageUrl: string | null;
  scale: number;
}) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-white">
      <div className={`relative overflow-hidden ${boundsClassName}`}>
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
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
              positionX: 50,
              positionY: 50,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SettingsSectionButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border-zinc-950 bg-zinc-950 text-white"
          : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:text-zinc-950"
      }`}
    >
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
  const buttonClassName = "inline-flex h-7 items-center rounded-full border border-zinc-300 px-2.5 text-[11px] font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onMoveUp}
        disabled={disableUp}
        className={buttonClassName}
      >
        Up
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={disableDown}
        className={buttonClassName}
      >
        Down
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
    imageScale: normalizedPresentationItemOverride(itemOverride).imageScale,
    summary: productSummary(item, project, contentVisibility),
    meta: detailRows(item, contentVisibility),
    finishGroups: groupedFinishes(finishes),
    cleanedSpecification,
  };
}

function TwoPerPageCard({
  data,
  itemNumber,
  sectionTitle,
}: {
  data: ProductPageData;
  itemNumber: number | null;
  sectionTitle: string;
}) {
  const minimalMeta = data.meta.filter((row) => ["Code", "Brand", "Origin"].includes(row.label));

  return (
    <article className="flex min-h-0 flex-col overflow-hidden border border-zinc-200 bg-white">
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-zinc-400">{sectionTitle}</p>
          <h3 className="mt-1.5 text-[21px] font-light tracking-tight text-zinc-950" style={clampStyle(2)}>
            {data.heading}
            {data.item.is_optional ? <span className="ml-2 border border-red-300 bg-red-50 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase text-red-700">OPTIONAL</span> : null}
            {data.item.is_rate_only ? <span className="ml-2 border border-sky-300 bg-sky-50 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase text-sky-700">RATE ONLY</span> : null}
          </h3>
        </div>
        {itemNumber ? (
          <div className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Item {itemNumber}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-5">
        <div className="flex min-h-0 flex-[1_1_70%] items-center justify-center overflow-hidden bg-white">
          <PresentationImageStage
            alt={data.heading}
            boundsClassName="h-[90%] w-[95%]"
            emptyContent={(
              <div className="flex h-full w-full items-center justify-center bg-white px-6 text-center text-xs text-zinc-400">
                Visual pending
              </div>
            )}
            fit={data.imageSettings?.fit === "cover" ? "cover" : "contain"}
            imageUrl={data.imageUrl}
            scale={data.imageScale}
          />
        </div>

        {minimalMeta.length ? (
          <div className="mt-3 border-t border-zinc-200 bg-[#fcfcfd] px-1 pt-3">
            <dl className={`grid gap-3 ${minimalMeta.length === 1 ? "grid-cols-1" : minimalMeta.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
              {minimalMeta.map((row) => (
                <div key={row.label} className="min-w-0">
                  <dt className="text-[9px] font-semibold uppercase tracking-[0.22em] text-zinc-400">{row.label}</dt>
                  <dd className="mt-1 text-[11px] font-semibold leading-5 text-zinc-900 [overflow-wrap:anywhere]" style={clampStyle(2)}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
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
  description,
  label,
  onChange,
  placeholder,
  value,
}: {
  description: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block rounded-2xl border border-zinc-200 bg-white px-4 py-3">
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
  description,
  label,
  onChange,
  placeholder,
  value,
}: {
  description: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block rounded-2xl border border-zinc-200 bg-white px-4 py-3">
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
  hasOverrideImage,
  imageScale,
  itemId,
  onFileSelected,
  onFitChange,
  onScaleChange,
  onResetImage,
  previewUrl,
  status,
  uploadDisabled = false,
}: {
  fit: PresentationImageFit;
  hasOverrideImage: boolean;
  imageScale: number;
  itemId: string;
  onFileSelected: (file: File) => Promise<void>;
  onFitChange: (fit: PresentationImageFit) => void;
  onScaleChange: (scale: number) => void;
  onResetImage: () => void;
  previewUrl: string | null;
  status: { status: "idle" | "uploading" | "failed"; error: string | null };
  uploadDisabled?: boolean;
}) {
  const [inputKey, setInputKey] = useState(0);
  const inputId = `presentation-image-upload-${itemId}-${inputKey}`;

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
              settings={{ fit, zoom: imageScale, positionX: 50, positionY: 50 }}
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

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label
          htmlFor={uploadDisabled ? undefined : inputId}
          className={`cursor-pointer text-[10px] font-semibold uppercase tracking-[0.18em] ${
            uploadDisabled
              ? "cursor-not-allowed text-zinc-400"
              : status.status === "uploading"
                ? "text-zinc-400"
                : "text-zinc-700 hover:text-zinc-950"
          }`}
        >
          {uploadDisabled ? "Upload disabled" : status.status === "uploading" ? "Uploading..." : "Change image"}
        </label>
        {hasOverrideImage ? (
          <button
            type="button"
            onClick={onResetImage}
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 transition hover:text-red-700"
          >
            Reset image
          </button>
        ) : null}
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
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Image Size</span>
          <span className="text-[10px] font-semibold text-zinc-500">{Math.round(imageScale * 100)}%</span>
        </div>
        <input
          type="range"
          min={0.6}
          max={1.2}
          step={0.05}
          value={imageScale}
          onChange={(event) => onScaleChange(Number(event.target.value))}
          className="mt-2 w-full accent-zinc-900"
        />
      </div>

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
  const [expandedSectionKeys, setExpandedSectionKeys] = useState<string[] | null>(null);
  const [activeItemImageSettingsId, setActiveItemImageSettingsId] = useState<string | null>(null);
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
  const defaultExpandedSectionId = controlSections[0]?.section.id ?? null;
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

  function toggleSectionExpanded(sectionId: string) {
    setExpandedSectionKeys((current) => {
      const base = current ?? (defaultExpandedSectionId ? [defaultExpandedSectionId] : []);
      return base.includes(sectionId)
        ? base.filter((entry) => entry !== sectionId)
        : [...base, sectionId];
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
    updateItemOverride(itemId, DEFAULT_PRESENTATION_ITEM_OVERRIDE);
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
    <main className="min-h-screen bg-[#edf0f3] px-4 py-6 print:bg-white print:px-0 print:py-0">
      <style>{`
        @page { size: A4 landscape; margin: 0; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          html, body { background: #ffffff; }
          .presentation-page { width: 297mm !important; height: 210mm !important; break-after: page; page-break-after: always; overflow: hidden !important; }
          .presentation-page:last-child { break-after: auto !important; page-break-after: auto !important; }
          .presentation-stack { gap: 0 !important; }
        }
      `}</style>

      <div className={`mx-auto mb-5 w-[297mm] max-w-full items-center justify-between gap-4 print:hidden ${printMode ? "hidden" : "flex"}`}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Quotation Presentation</p>
          <p className="mt-1 text-sm text-zinc-600">{visibleSlideCount} visible {visibleSlideCount === 1 ? "slide" : "slides"}.</p>
          <p className="mt-1 text-sm text-zinc-600">Landscape presentation preview. Use browser print to save as PDF.</p>
          <p className={`mt-2 text-xs ${isDirty ? "text-amber-700" : "text-zinc-500"}`}>
            {isDirty ? "Preview includes unsaved changes. Save to keep them." : "Preview matches the latest saved presentation settings."}
          </p>
        </div>
        <PrintActions>
          <PresentationPptxExportButton />
        </PrintActions>
      </div>

      <section className={`mx-auto mb-6 w-[297mm] max-w-full print:hidden ${printMode ? "hidden" : "block"}`}>
        <div className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Presentation Settings</p>
              <p className="mt-2 text-lg font-semibold text-zinc-950">{visibleCount} visible / {totalCount} total items</p>
              <p className="mt-1 text-sm text-zinc-500">Manage presentation-only item visibility, layout, pages, and cover/closing text.</p>
              <p className="mt-1 text-sm text-zinc-500">{visibleSlideCount} visible {visibleSlideCount === 1 ? "slide" : "slides"} generated.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={persistenceDisabled || isPending || !isDirty}
                onClick={saveSettings}
                className="inline-flex h-10 items-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {persistenceDisabled ? "Preview only" : isPending ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={resetPresentationSettings}
                className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
              >
                Reset presentation
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
            {updatedAtLabel ? <p>Last saved: {updatedAtLabel}</p> : <p>Not saved yet</p>}
            {persistenceDisabled || uploadsDisabled ? <p className="text-amber-700">Development preview only. Saving and uploads are disabled.</p> : null}
            {saveMessage ? (
              <p className={saveState === "error" ? "text-red-600" : "text-emerald-700"}>
                {saveMessage}
              </p>
            ) : (
              <p>{isDirty ? "You have unsaved presentation changes." : "Presentation settings are up to date."}</p>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {settingsSections.map((section) => (
              <SettingsSectionButton
                key={section.key}
                active={activeSettingsSection === section.key}
                label={section.label}
                onClick={() => setActiveSettingsSection(section.key)}
              />
            ))}
          </div>

          <div className="mt-5 rounded-[24px] border border-zinc-200 bg-zinc-50/70 p-4">
            {activeSettingsSection === "flow" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Presentation Flow</p>
                    <p className="mt-1 text-sm text-zinc-500">Review the real presentation hierarchy, control visibility, and adjust presentation-only order.</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={resetFlowOrder}
                      className="inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                    >
                      Reset flow order
                    </button>
                    <button
                      type="button"
                      onClick={resetHiddenItems}
                      className="inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                    >
                      Show all items
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid max-h-[520px] gap-4 overflow-y-auto pr-1">
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
                        <div className="flex items-center gap-3 px-3 py-3">
                          <SectionVisibilityCheckbox
                            checked={groupAllVisible}
                            indeterminate={groupSomeVisible}
                            onChange={(checked) => toggleMainAreaItems(groupSectionIds, checked)}
                          />
                          {group.mainSection ? (
                            <FlowMoveButtons
                              disableUp={mainSectionIndex <= 0}
                              disableDown={mainSectionIndex >= mainSections.length - 1}
                              onMoveUp={() => moveMainSection(group.mainSection!.id, "up")}
                              onMoveDown={() => moveMainSection(group.mainSection!.id, "down")}
                            />
                          ) : null}
                          <button
                            type="button"
                            onClick={() => toggleFlowGroupExpanded(group.id)}
                            className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-400">{groupExpanded ? "v" : ">"}</span>
                                <p className="truncate text-sm font-semibold text-zinc-900">{groupTitle}</p>
                              </div>
                              <p className="mt-1 pl-5 text-xs uppercase tracking-[0.18em] text-zinc-400">{groupTypeLabel}</p>
                            </div>
                            <p className="shrink-0 text-xs text-zinc-500">
                              {group.sections.length} sections • {groupVisibleCount} visible / {groupTotalCount} total
                            </p>
                          </button>
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
                                <div key={section.id} className="rounded-2xl border border-zinc-200 bg-zinc-50/60">
                                  <div className="flex items-center gap-3 px-3 py-3">
                                    <SectionVisibilityCheckbox
                                      checked={sectionAllVisible}
                                      indeterminate={sectionSomeVisible}
                                      onChange={(checked) => toggleSectionItems(sectionItems.map((item) => item.id), checked)}
                                    />
                                    {group.mainSection && section.id !== group.mainSection.id ? (
                                      <FlowMoveButtons
                                        disableUp={sectionOrderIndex <= 0}
                                        disableDown={sectionOrderIndex >= groupedChildSections.length - 1}
                                        onMoveUp={() => moveSectionWithinMain(group.mainSection!.id, section.id, "up")}
                                        onMoveDown={() => moveSectionWithinMain(group.mainSection!.id, section.id, "down")}
                                      />
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => toggleFlowSectionExpanded(section.id)}
                                      className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                                    >
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-zinc-400">{sectionExpanded ? "v" : ">"}</span>
                                          <p className="truncate text-sm font-semibold text-zinc-900">{section.section_title}</p>
                                        </div>
                                        <p className="mt-1 pl-5 text-xs uppercase tracking-[0.18em] text-zinc-400">Section / Area</p>
                                      </div>
                                      <p className="shrink-0 text-xs text-zinc-500">{visibleSectionItemCount} visible / {totalSectionItemCount} total</p>
                                    </button>
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
                                            className={`rounded-2xl border px-3 py-2.5 transition ${
                                              included
                                                ? "border-zinc-200 bg-white"
                                                : "border-zinc-200 bg-zinc-50 text-zinc-500"
                                            }`}
                                          >
                                            <div className="flex items-center gap-3">
                                              <input
                                                checked={included}
                                                className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-400"
                                                onChange={(event) => toggleHiddenItem(item.id, event.target.checked)}
                                                type="checkbox"
                                              />
                                              <FlowMoveButtons
                                                disableUp={itemIndex <= 0}
                                                disableDown={itemIndex >= sectionItems.length - 1}
                                                onMoveUp={() => moveItemWithinSection(section.id, item.id, "up")}
                                                onMoveDown={() => moveItemWithinSection(section.id, item.id, "down")}
                                              />
                                              <div className="ml-5 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
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
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Items</p>
                    <p className="mt-1 text-sm text-zinc-500">Include or hide individual product slides grouped by quotation section.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetHiddenItems}
                    className="inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Show all items
                  </button>
                </div>

                <div className="mt-4 grid max-h-[520px] gap-4 overflow-y-auto pr-1">
                  {controlSections.map(({ section, items: sectionItems }, sectionIndex) => {
                    const visibleSectionItemCount = sectionItems.filter((item) => !hiddenItemIds.has(item.id)).length;
                    const totalSectionItemCount = sectionItems.length;
                    const allVisible = visibleSectionItemCount === totalSectionItemCount;
                    const someVisible = visibleSectionItemCount > 0 && visibleSectionItemCount < totalSectionItemCount;
                    const isExpanded = expandedSectionKeys
                      ? expandedSectionKeys.includes(section.id)
                      : sectionIndex === 0;

                    return (
                      <div key={section.id} className="rounded-2xl border border-zinc-200 bg-white">
                        <div className="flex items-center gap-3 px-3 py-3">
                          <SectionVisibilityCheckbox
                            checked={allVisible}
                            indeterminate={someVisible}
                            onChange={(checked) => toggleSectionItems(sectionItems.map((item) => item.id), checked)}
                          />
                          <button
                            type="button"
                            onClick={() => toggleSectionExpanded(section.id)}
                            className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-400">{isExpanded ? "▾" : "▸"}</span>
                                <p className="truncate text-sm font-semibold text-zinc-900">{section.section_title}</p>
                              </div>
                              <p className="mt-1 pl-5 text-xs uppercase tracking-[0.18em] text-zinc-400">
                                {section.section_kind === "main" ? "Main Area" : "Area"}
                              </p>
                            </div>
                            <p className="shrink-0 text-xs text-zinc-500">{visibleSectionItemCount} visible / {totalSectionItemCount} total</p>
                          </button>
                        </div>

                        {isExpanded ? (
                          <div className="grid gap-2 border-t border-zinc-100 px-3 py-3">
                            {sectionItems.map((item) => {
                              const included = !hiddenItemIds.has(item.id);
                              const thumbnailUrl = effectivePresentationImageUrlByItemId[item.id] ?? null;
                              const title = productTitle(item);
                              const itemNumber = String(settingsItemNumberById.get(item.id) ?? 0).padStart(2, "0");
                              const subline = detailValue([
                                item.item_code_snapshot,
                                item.model_snapshot,
                                item.brand_name_snapshot,
                              ]);
                              const itemOverride = normalizedPresentationItemOverride(settings.itemOverrides[item.id]);
                              const hasOverrideImage = Boolean(itemOverride.imageUrl);
                              const itemStatus = itemOverrideStatusByItemId[item.id] ?? { status: "idle" as const, error: null };
                              const isImageSettingsOpen = activeItemImageSettingsId === item.id;

                              return (
                                <div
                                  key={item.id}
                                  className={`rounded-2xl border px-3 py-2.5 transition ${
                                    included
                                      ? "border-zinc-200 bg-white"
                                      : "border-zinc-200 bg-zinc-50 text-zinc-500"
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <input
                                      checked={included}
                                      className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-400"
                                      onChange={(event) => toggleHiddenItem(item.id, event.target.checked)}
                                      type="checkbox"
                                    />
                                    <div className="ml-5 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
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
                                    <button
                                      type="button"
                                      onClick={() => setActiveItemImageSettingsId(isImageSettingsOpen ? null : item.id)}
                                      className="shrink-0 rounded-full border border-zinc-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-950"
                                    >
                                      {isImageSettingsOpen ? "Hide Image" : "Image Settings"}
                                    </button>
                                  </div>

                                  {isImageSettingsOpen ? (
                                    <PresentationItemImageControl
                                      fit={itemOverride.imageFit}
                                      hasOverrideImage={hasOverrideImage}
                                      imageScale={itemOverride.imageScale}
                                      itemId={item.id}
                                      onFileSelected={(file) => handlePresentationItemImageUpload(item.id, file)}
                                      onFitChange={(fit) => updateItemOverride(item.id, { imageFit: fit })}
                                      onScaleChange={(scale) => updateItemOverride(item.id, { imageScale: scale })}
                                      onResetImage={() => resetPresentationItemImage(item.id)}
                                      previewUrl={effectivePresentationImageUrlByItemId[item.id] ?? null}
                                      status={itemStatus}
                                      uploadDisabled={uploadsDisabled}
                                    />
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

                <div className="mt-4 grid max-w-4xl gap-3 md:grid-cols-2">
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

            {activeSettingsSection === "sections" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Section Settings</p>
                    <p className="mt-1 text-sm text-zinc-500">Set presentation-only titles, notes, and visuals for each quotation section.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetSectionOverrides}
                    className="inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Reset section settings
                  </button>
                </div>

                <div className="mt-4 grid max-h-[520px] gap-4 overflow-y-auto pr-1">
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
                          className="flex w-full items-center justify-between gap-3 border-b border-zinc-100 pb-3 text-left"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-zinc-400">{isExpanded ? "▾" : "▸"}</span>
                              <p className="text-sm font-semibold text-zinc-900">{section.section_title}</p>
                            </div>
                            <p className="mt-1 pl-5 text-xs uppercase tracking-[0.18em] text-zinc-400">
                              {section.section_kind === "main" ? "Main Area" : "Area"}
                            </p>
                          </div>
                          <p className="text-xs text-zinc-500">{sectionItems.length} items</p>
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

                            <div className="grid gap-3 lg:grid-cols-2">
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
              </>
            ) : null}

            {activeSettingsSection === "mainLayouts" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Main Area Layouts</p>
                    <p className="mt-1 text-sm text-zinc-500">Configure layout pages for the quotation&apos;s real top-level sections only.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetPresentationVisuals}
                    className="inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Reset main area layouts
                  </button>
                </div>

                <div className="mt-4 grid max-h-[520px] gap-4 overflow-y-auto pr-1">
                  {mainSections.length ? mainSections.map((section, index) => {
                    const override = normalizedPresentationMainSectionOverride(settings.mainSectionOverrides[section.id]);
                    const isExpanded = expandedMainSectionLayoutIds ? expandedMainSectionLayoutIds.includes(section.id) : index === 0;
                    const previewUrl = mainLayoutPreviewUrlById[section.id] ?? null;
                    const status = mainLayoutStatusById[section.id] ?? { status: "idle", error: null };
                    const displayTitle = override.title || section.section_title;

                    return (
                      <div key={section.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                          <button
                            type="button"
                            onClick={() => toggleMainSectionLayoutExpanded(section.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-400">{isExpanded ? "v" : ">"}</span>
                                <p className="text-sm font-semibold text-zinc-900">{displayTitle}</p>
                              </div>
                              <p className="mt-1 pl-5 text-xs uppercase tracking-[0.18em] text-zinc-400">
                                Main Area {String(index + 1).padStart(2, "0")}
                              </p>
                            </div>
                          </button>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">From quotation</p>
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
              </>
            ) : null}

            {activeSettingsSection === "cover" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Cover Details</p>
                    <p className="mt-1 text-sm text-zinc-500">Customize the cover page text for this presentation only.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetCoverOverrides}
                    className="inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Reset cover details
                  </button>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <TextField
                    label="Presentation title"
                    description="Main title shown on the cover page."
                    value={settings.coverOverrides.title}
                    placeholder={defaultCoverText.title}
                    onChange={(value) => updateCoverOverride("title", value)}
                  />
                  <TextField
                    label="Prepared by display name"
                    description="Shown on the cover page without changing company profile data."
                    value={settings.coverOverrides.preparedBy}
                    placeholder={defaultCoverText.preparedBy}
                    onChange={(value) => updateCoverOverride("preparedBy", value)}
                  />
                  <TextField
                    label="Project display name"
                    description="Presentation-only project name shown on the cover."
                    value={settings.coverOverrides.projectDisplayName}
                    placeholder={project?.project_name ?? quotation.title}
                    onChange={(value) => updateCoverOverride("projectDisplayName", value)}
                  />
                  <TextField
                    label="Client display name"
                    description="Presentation-only client name shown on the cover."
                    value={settings.coverOverrides.clientDisplayName}
                    placeholder={client?.company_name ?? "Client name"}
                    onChange={(value) => updateCoverOverride("clientDisplayName", value)}
                  />
                  <TextField
                    label="Website"
                    description="Displayed on the dark cover panel."
                    value={settings.coverOverrides.website}
                    placeholder={defaultCoverText.website}
                    onChange={(value) => updateCoverOverride("website", value)}
                  />
                  <TextAreaField
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
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Closing Details</p>
                    <p className="mt-1 text-sm text-zinc-500">Customize the thank-you page text and contact details for this presentation only.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetClosingOverrides}
                    className="inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
                  >
                    Reset closing details
                  </button>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <TextField
                    label="Closing title"
                    description="Main title shown on the thank-you page."
                    value={settings.closingOverrides.title}
                    placeholder={defaultClosingText.title}
                    onChange={(value) => updateClosingOverride("title", value)}
                  />
                  <TextField
                    label="Website"
                    description="Displayed once in the closing contact block."
                    value={settings.closingOverrides.website}
                    placeholder={defaultClosingText.website}
                    onChange={(value) => updateClosingOverride("website", value)}
                  />
                  <TextField
                    label="Email"
                    description="Presentation-only closing contact email."
                    value={settings.closingOverrides.email}
                    placeholder={defaultClosingText.email}
                    onChange={(value) => updateClosingOverride("email", value)}
                  />
                  <TextField
                    label="Phone"
                    description="Presentation-only closing contact phone."
                    value={settings.closingOverrides.phone}
                    placeholder={defaultClosingText.phone}
                    onChange={(value) => updateClosingOverride("phone", value)}
                  />
                  <TextField
                    label="Office details"
                    description="Short office/location line for the closing page."
                    value={settings.closingOverrides.officeDetails}
                    placeholder={defaultClosingText.officeDetails}
                    onChange={(value) => updateClosingOverride("officeDetails", value)}
                  />
                  <TextAreaField
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

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
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

      <section className={`mx-auto mb-6 w-[297mm] max-w-full print:hidden ${printMode ? "hidden" : "block"}`}>
        <div className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Slide Navigator</p>
              <p className="mt-2 text-lg font-semibold text-zinc-950">{visibleSlideCount} visible {visibleSlideCount === 1 ? "slide" : "slides"}</p>
              <p className="mt-1 text-sm text-zinc-500">Jump to generated slides without opening a long page list.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsSlideNavigatorOpen((current) => !current)}
                className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 transition hover:border-zinc-400 hover:text-zinc-950"
              >
                {isSlideNavigatorOpen ? "Hide Slide Navigator" : `Slide Navigator - ${visibleSlideCount} visible ${visibleSlideCount === 1 ? "slide" : "slides"}`}
              </button>
              {isSlideNavigatorOpen ? (
                <button
                  type="button"
                  onClick={() => setIsSlideNavigatorOpen(false)}
                  className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
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
                    className="grid grid-cols-[56px_120px_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left transition hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    <span className="text-sm font-semibold text-zinc-900">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{slideTypeLabel(slide.type)}</span>
                    <span className="truncate text-sm text-zinc-800">
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

      <div className="presentation-stack mx-auto flex w-fit max-w-full flex-col gap-5">
        {presentationSlides.map((slide, slideIndex) => {
          const pageId = slideDomId(slideIndex);

          if (slide.type === "cover") {
            return (
              <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden">
                <div className="absolute inset-0 bg-[linear-gradient(130deg,_#eef2f5_0%,_#f8fafc_44%,_#ffffff_44%,_#ffffff_100%)]" />
                <div className="absolute inset-y-0 right-0 w-[30%] bg-zinc-950" />
                <div className="absolute left-0 top-0 h-full w-[44%] bg-[radial-gradient(circle_at_top_left,_rgba(39,39,42,0.08),_transparent_55%)]" />
                <div className="relative grid h-full grid-cols-[1.5fr_0.7fr]">
                  <div className="flex h-full flex-col justify-between px-12 py-12">
                    <div>
                      <div className="flex items-center gap-3">
                        <div className="h-px w-14 bg-zinc-400" />
                        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-zinc-500">Client Presentation</p>
                      </div>
                      <h1 className="mt-10 max-w-4xl text-[56px] font-light leading-[1.02] tracking-[-0.04em] text-zinc-950">
                        {coverTitle}
                      </h1>
                      {coverSubtitle ? (
                        <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-600" style={clampStyle(3)}>
                          {coverSubtitle}
                        </p>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-[1.1fr_0.9fr] gap-10 border-t border-zinc-200 pt-8">
                      <div>
                        {coverProjectDisplayName ? <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Project</p> : null}
                        {coverProjectDisplayName ? (
                          <p className="mt-2 text-2xl font-light leading-tight text-zinc-950">{coverProjectDisplayName}</p>
                        ) : null}
                        {coverClientDisplayName ? (
                          <p className="mt-4 text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                            Prepared for {coverClientDisplayName}
                          </p>
                        ) : null}
                      </div>
                      <div className="grid gap-3 self-end">
                        <MetaCard label="Project / Quote No." value={quotation.quotation_no} />
                        <MetaCard label="Date" value={formatPresentationDate(quotation.quotation_date)} />
                      </div>
                    </div>
                  </div>

                  <div className="relative flex h-full flex-col justify-between px-9 py-10 text-white">
                    <div>
                      <div className="flex items-center justify-between gap-4">
                        <PresentationBrandLogo
                          logoUrl={companyProfile.logoUrl}
                          fallbackText={coverPreparedBy ?? companyProfile.displayName}
                        />
                      </div>
                      {coverWebsite ? <p className="mt-4 text-sm leading-6 text-white/70">{coverWebsite}</p> : null}
                    </div>

                    <div className="grid gap-4 border-t border-white/10 pt-7">
                      <MetaLine label="Prepared By" value={coverPreparedBy} />
                    </div>
                  </div>
                </div>
              </PresentationPage>
            );
          }

          if (slide.type === "design") {
            return (
              <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="overflow-hidden bg-[linear-gradient(130deg,_#eef2f5_0%,_#f8fafc_44%,_#ffffff_44%,_#ffffff_100%)]">
                <div className="grid h-full grid-cols-[0.9fr_1.1fr] gap-12 px-12 py-11">
                  <div className="flex h-full flex-col justify-between border-r border-zinc-200 pr-10">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-zinc-500">Design Considerations</p>
                      <h2 className="mt-5 text-5xl font-light tracking-[-0.04em] text-zinc-950">Design
                        <span className="block text-zinc-600">Considerations</span>
                      </h2>
                      <div className="mt-8 h-px w-20 bg-zinc-300" />
                    </div>

                    <div>
                      <p className="max-w-sm text-base leading-7 text-zinc-600" style={clampStyle(5)}>
                        Core principles reviewed when aligning furniture choices with workflow, brand expression, and long-term performance.
                      </p>
                      <p className="mt-8 text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
                        Editorial Overview
                      </p>
                    </div>
                  </div>

                  <div className="grid content-center grid-cols-2 gap-x-8 gap-y-5">
                    {designConsiderations.map((block, index) => (
                      <article key={block.title} className="border-t border-zinc-200 pt-4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
                          {String(index + 1).padStart(2, "0")}
                        </p>
                        <p className="mt-2 text-base font-semibold uppercase tracking-[0.12em] text-zinc-900">{block.title}</p>
                        <p className="mt-3 text-sm leading-6 text-zinc-600" style={clampStyle(4)}>{block.body}</p>
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
              <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden bg-[#f4f6f8]">
                <div className="absolute left-0 top-0 h-full w-24 bg-zinc-950" />
                <div className="absolute left-24 top-0 h-full w-[1px] bg-zinc-200/80" />
                <div className="relative flex h-full flex-col justify-between px-14 py-12 pl-36">
                  <div>
                    <div className="flex items-center gap-4">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-zinc-500">MAIN AREA</span>
                      <span className="h-px w-16 bg-zinc-300" />
                    </div>
                    <h2 className="mt-7 max-w-5xl text-6xl font-light leading-[1.02] tracking-[-0.045em] text-zinc-950">
                      {mainSectionTitle}
                    </h2>
                    {mainSectionNote ? (
                      <p className="mt-7 max-w-3xl text-lg leading-8 text-zinc-600" style={clampStyle(4)}>{mainSectionNote}</p>
                    ) : null}
                  </div>

                  {mainSectionPreviewUrl ? (
                    <div className="mt-8 grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4">
                      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 border border-zinc-200 bg-white/80 p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Full Floor Layout</p>
                        <div className="min-h-0 overflow-hidden bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={mainSectionPreviewUrl} alt={`${mainSectionTitle} Full Floor Layout`} className="h-full w-full object-contain" />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex items-end justify-between gap-6 border-t border-zinc-200 pt-8">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
                        Main Area {String(mainSections.findIndex((entry) => entry.id === section.id) + 1).padStart(2, "0")}
                      </p>
                      <p className="mt-2 text-sm text-zinc-500">
                        {mainSectionPreviewUrl ? "Floor layout overview" : "Main area overview"}
                      </p>
                    </div>
                    <div className="border border-zinc-300 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                      {project?.project_name ?? quotation.title}
                    </div>
                  </div>
                </div>
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

            return (
              <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden bg-[#f4f6f8]">
                <div className="absolute left-0 top-0 h-full w-24 bg-zinc-950" />
                <div className="absolute left-24 top-0 h-full w-[1px] bg-zinc-200/80" />
                <div className="relative flex h-full flex-col justify-between px-14 py-12 pl-36">
                  <div>
                    <div className="flex items-center gap-4">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-zinc-500">Area</span>
                      <span className="h-px w-16 bg-zinc-300" />
                    </div>
                    <h2 className="mt-7 max-w-5xl text-6xl font-light leading-[1.02] tracking-[-0.045em] text-zinc-950">
                      {sectionTitle}
                    </h2>
                    {sectionNote ? (
                      <p className="mt-7 max-w-3xl text-lg leading-8 text-zinc-600" style={clampStyle(4)}>{sectionNote}</p>
                    ) : null}
                  </div>

                  {sectionVisuals.length ? (
                    <div className={`mt-8 grid min-h-0 flex-1 gap-4 ${sectionVisuals.length === 1 ? "grid-cols-1" : sectionVisuals.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                      {sectionVisuals.map((visual) => (
                        <div key={visual.key} className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 border border-zinc-200 bg-white/80 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{visual.label}</p>
                          <div className="min-h-0 overflow-hidden bg-white">
                            {visual.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={visual.imageUrl} alt={`${sectionTitle} ${visual.label}`} className="h-full w-full object-contain" />
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptySectionVisualState />
                  )}

                  <div className="flex items-end justify-between gap-6 border-t border-zinc-200 pt-8">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
                        Section {String(dividerSections.indexOf(section) + 1).padStart(2, "0")}
                      </p>
                      {mainSection && mainSection.id !== section.id ? (
                        <p className="mt-2 text-sm font-medium text-zinc-500">Within {parentMainSectionTitle}</p>
                      ) : null}
                      <p className="mt-2 text-sm text-zinc-500">
                        {sectionPageGroups.length ? `${sectionPageGroups.length} product ${sectionPageGroups.length === 1 ? "page" : "pages"} follow` : "Section overview"}
                      </p>
                    </div>
                    <div className="border border-zinc-300 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                      {project?.project_name ?? quotation.title}
                    </div>
                  </div>
                </div>
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
                <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="overflow-hidden bg-white">
                  <div className="flex h-full flex-col px-8 py-7">
                    <div className="border-b border-zinc-200 pb-4">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">{sectionTitle}</p>
                        <p className="mt-2 text-2xl font-light tracking-tight text-zinc-950">
                          {pageItems.length === 2 ? "Selected Products" : "Selected Product"}
                        </p>
                      </div>
                    </div>

                    <div className={`mt-5 grid min-h-0 flex-1 gap-5 ${pageData.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                      {pageData.map((data) => (
                        <TwoPerPageCard
                          key={data.item.id}
                          data={data}
                          itemNumber={visibleSlideItemNumberById.get(data.item.id) ?? null}
                          sectionTitle={sectionTitle}
                        />
                      ))}
                    </div>

                    <div className="mt-5 flex items-end justify-between gap-4 border-t border-zinc-200 pt-4">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Prepared By</p>
                        <p className="mt-1 text-sm font-semibold text-zinc-900">{companyProfile.displayName}</p>
                      </div>
                      {quotation.quotation_no ? <p className="text-sm font-semibold text-zinc-900">{quotation.quotation_no}</p> : null}
                    </div>
                  </div>
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
            const compactFinishes = compactFinishRows(data.finishGroups);
            const visibleCompactFinishes = compactFinishes.slice(0, 4);
            const hiddenFinishCount = Math.max(compactFinishes.length - visibleCompactFinishes.length, 0);

            return (
              <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="overflow-hidden bg-white">
                <div className="grid h-full grid-cols-[1.65fr_0.9fr]">
                  <div className="relative grid h-full grid-rows-[auto_minmax(0,1fr)_96px] bg-white px-9 py-8">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">{sectionTitle}</p>
                        <p className="mt-2 text-2xl font-light tracking-tight text-zinc-950" style={clampStyle(2)}>
                          {data.heading}
                          {data.item.is_optional ? <span className="ml-2 border border-red-300 bg-red-50 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase text-red-700">OPTIONAL</span> : null}
                          {data.item.is_rate_only ? <span className="ml-2 border border-sky-300 bg-sky-50 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase text-sky-700">RATE ONLY</span> : null}
                        </p>
                      </div>
                      <div className="rounded-full border border-zinc-300 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                        Item {visibleSlideItemNumberById.get(item.id) ?? 1}
                      </div>
                    </div>

                    <div className="mt-5 flex min-h-0 items-center justify-center overflow-hidden bg-white">
                      <PresentationImageStage
                        alt={data.heading}
                        boundsClassName="h-[72%] w-[82%]"
                        emptyContent={(
                          <div className="flex h-full min-h-[120mm] w-full flex-col items-center justify-center gap-5 bg-white px-10 text-center">
                            <div className="border border-dashed border-zinc-300 px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
                              Visual pending
                            </div>
                            <p className="max-w-md text-sm leading-6 text-zinc-500" style={clampStyle(3)}>
                              No quotation image is available for this item yet. The item remains included so the presentation sequence stays complete.
                            </p>
                          </div>
                        )}
                        fit={data.imageSettings?.fit === "cover" ? "cover" : "contain"}
                        imageUrl={data.imageUrl}
                        scale={data.imageScale}
                      />
                    </div>

                    <div className="mt-5 grid h-[96px] grid-cols-[minmax(0,1fr)_auto] items-end gap-6">
                      <div className="min-w-0 self-end border-t border-zinc-200 pt-3">
                        {data.summary ? (
                          <>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Product Summary</p>
                            <p className="mt-1 text-sm font-medium leading-6 text-zinc-700" style={clampStyle(2)}>{data.summary}</p>
                          </>
                        ) : (
                          <div className="h-[40px]" />
                        )}
                      </div>
                      <div className="self-end">
                        {item.room_name_snapshot ? (
                          <div className="border border-zinc-200 bg-white px-4 py-3 text-right">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Area Tag</p>
                            <p className="mt-1 text-sm font-semibold text-zinc-900">{item.room_name_snapshot}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="grid h-full grid-rows-[220px_auto_1fr_96px] bg-[#f3f4f6] px-8 py-9">
                    <div className="min-h-0 border-b border-zinc-900/10 pb-5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Technical Details</p>
                      <h3 className="mt-3 text-3xl font-light tracking-tight text-zinc-950" style={clampStyle(2)}>
                        {data.heading}
                        {data.item.is_optional ? <span className="ml-2 border border-red-300 bg-red-50 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-red-700">OPTIONAL</span> : null}
                        {data.item.is_rate_only ? <span className="ml-2 border border-sky-300 bg-sky-50 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-sky-700">RATE ONLY</span> : null}
                      </h3>
                      {settings.contentVisibility.specification ? (
                        data.cleanedSpecification ? (
                          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-600" style={clampStyle(5)}>
                            {data.cleanedSpecification}
                          </p>
                        ) : (
                          <p className="mt-4 text-sm leading-7 text-zinc-400">Specification details not added yet.</p>
                        )
                      ) : null}
                    </div>

                    {data.meta.length ? (
                      <dl className="mt-5 grid min-h-0 grid-cols-2 content-start gap-x-5 gap-y-3 overflow-hidden">
                        {data.meta.map((row) => (
                          <ProductDetail key={row.label} label={row.label} value={row.value ?? null} />
                        ))}
                      </dl>
                    ) : <div className="mt-5" />}

                    {compactFinishes.length ? (
                      <div className="mt-5 min-h-0 overflow-hidden border-t border-zinc-900/10 pt-5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Finishes</p>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          {visibleCompactFinishes.map((finish) => (
                            <div key={finish.id} className="grid grid-cols-[28px_1fr] gap-2 rounded-lg border border-zinc-900/10 bg-white/55 p-2">
                              <div className="h-7 w-7 overflow-hidden bg-zinc-50">
                                {finish.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={finish.imageUrl} alt={finish.name || finish.code || finish.label} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="h-full w-full bg-[linear-gradient(135deg,_#f4f4f5,_#e4e4e7)]" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500" style={clampStyle(1)}>{finish.label}</p>
                                <p className="mt-0.5 text-[11px] font-semibold leading-4 text-zinc-900" style={clampStyle(2)}>
                                  {[finish.code, finish.name].filter(Boolean).join(" | ") || finish.description || "Selected finish"}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                        {hiddenFinishCount ? (
                          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">+{hiddenFinishCount} more</p>
                        ) : null}
                      </div>
                    ) : <div className="mt-5 border-t border-zinc-900/10 pt-5" />}

                    <div className="mt-5 self-end border-t border-zinc-900/10 pt-3">
                      <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] items-start gap-x-6 gap-y-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Prepared By</p>
                        {quotation.quotation_no ? (
                          <p className="text-right text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Project / Quote No.</p>
                        ) : (
                          <div />
                        )}
                        <p className="text-sm font-semibold text-zinc-900">{companyProfile.displayName}</p>
                        {quotation.quotation_no ? (
                          <p className="text-right text-sm font-semibold text-zinc-900">{quotation.quotation_no}</p>
                        ) : (
                          <div />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </PresentationPage>
            );
          }

          return (
            <PresentationPage key={slide.key} id={pageId} slideIndex={slideIndex} className="relative overflow-hidden">
              <div className="absolute inset-0 bg-[linear-gradient(130deg,_#eef2f5_0%,_#f8fafc_44%,_#ffffff_44%,_#ffffff_100%)]" />
              <div className="absolute inset-y-0 right-0 w-[30%] bg-zinc-950" />
              <div className="absolute left-0 top-0 h-full w-[44%] bg-[radial-gradient(circle_at_top_left,_rgba(39,39,42,0.08),_transparent_55%)]" />
              <div className="relative grid h-full grid-cols-[1.5fr_0.7fr]">
                <div className="flex h-full flex-col justify-between px-12 py-12">
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="h-px w-14 bg-zinc-400" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-zinc-500">Closing Slide</p>
                    </div>
                    <h2 className="mt-10 max-w-4xl text-[56px] font-light leading-[1.02] tracking-[-0.04em] text-zinc-950">
                      {closingTitle}
                    </h2>
                    {closingMessage ? (
                      <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-600" style={clampStyle(4)}>
                        {closingMessage}
                      </p>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-[1.1fr_0.9fr] gap-10 border-t border-zinc-200 pt-8">
                    <div />
                    <div className="grid gap-3 self-end">
                      {quotation.quotation_no ? <MetaCard label="Project / Quote No." value={quotation.quotation_no} /> : null}
                      {quotation.quotation_date ? <MetaCard label="Date" value={formatPresentationDate(quotation.quotation_date)} /> : null}
                    </div>
                  </div>
                </div>

                <div className="relative flex h-full flex-col justify-between px-9 py-10 text-white">
                  <div>
                    <div className="flex items-center justify-between gap-4">
                      <PresentationBrandLogo
                        logoUrl={companyProfile.logoUrl}
                        fallbackText={companyProfile.displayName}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 border-t border-white/10 pt-7">
                    <ContactLine label="Website" value={closingWebsite} />
                    <ContactLine label="Email" value={closingEmail} />
                    <ContactLine label="Phone" value={closingPhone} />
                    <ContactLine label="Office" value={closingOfficeDetails} />
                  </div>
                </div>
              </div>
            </PresentationPage>
          );
        })}
      </div>
    </main>
  );
}
