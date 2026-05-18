"use client";

import { useState, useTransition, type ReactNode } from "react";
import { PrintActions } from "@/components/quotations/print-actions";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import type { CompanyProfile } from "@/lib/company-profile";
import type { ImageDisplaySettings } from "@/lib/image-display-settings";
import {
  DEFAULT_PRESENTATION_CONTENT_VISIBILITY,
  normalizePresentationSettings,
  type PresentationContentVisibility,
  type PresentationLayoutMode,
  type QuotationPresentationSettings,
} from "@/lib/quotations/presentation-settings";
import {
  formatBrandOriginSupplier,
  specificationWithoutDuplicateCode,
} from "@/lib/quotations/format-quotation-row";

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
type SaveState = "idle" | "saving" | "saved" | "error";
type VisibilityField = keyof PresentationContentVisibility;
type ProductPageData = {
  item: PresentationItem;
  heading: string;
  imageUrl: string | null;
  imageSettings: Partial<ImageDisplaySettings> | undefined;
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

function buildDisplaySections(sections: PresentationSection[]) {
  const orderedSectionRows = orderedPresentationSections(sections);
  const sectionsById = new Map(orderedSectionRows.map((section) => [section.id, section]));
  const childrenByParent = new Map<string, PresentationSection[]>();

  for (const section of orderedSectionRows) {
    if (section.section_kind !== "sub" || !section.parent_section_id) continue;
    childrenByParent.set(section.parent_section_id, [...(childrenByParent.get(section.parent_section_id) ?? []), section]);
  }

  const rows: DisplaySection[] = [];

  for (const section of orderedSectionRows) {
    if (section.section_kind === "main") {
      rows.push({ ...section, renderAsMainOnly: true });
      for (const child of childrenByParent.get(section.id) ?? []) {
        rows.push(child);
      }
      continue;
    }

    if (section.parent_section_id && sectionsById.get(section.parent_section_id)?.section_kind === "main") {
      continue;
    }

    rows.push(section);
  }

  return { displaySections: rows, childrenByParent, sectionsById };
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
    contentVisibility: value.contentVisibility,
    layoutMode: value.layoutMode,
  });
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

function PresentationPage({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
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

function ProductDetail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div className="grid gap-1 border-b border-zinc-200/80 pb-2.5 last:border-b-0 last:pb-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-400">{label}</dt>
      <dd className="text-sm font-medium leading-5 text-zinc-900 [overflow-wrap:anywhere]" style={clampStyle(2)}>{value}</dd>
    </div>
  );
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

function buildProductPageData({
  contentVisibility,
  finishImageUrlByItemAndFinishId,
  imageUrlByItemId,
  item,
  project,
}: {
  contentVisibility: PresentationContentVisibility;
  finishImageUrlByItemAndFinishId: ImageUrlRecord;
  imageUrlByItemId: ImageUrlRecord;
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
    imageUrl: imageUrlByItemId[item.id] ?? null,
    imageSettings: imageSettingsValue(
      item.proposed_image_url_snapshot
        ? item.cell_layout?.images?.proposed_image_url_snapshot
        : item.cell_layout?.images?.specified_image_url_snapshot,
    ),
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
    <article className="flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-zinc-200 bg-white">
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-zinc-400">{sectionTitle}</p>
          <h3 className="mt-1.5 text-[21px] font-light tracking-tight text-zinc-950" style={clampStyle(2)}>{data.heading}</h3>
        </div>
        {itemNumber ? (
          <div className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Item {itemNumber}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-5">
        <div className="flex min-h-0 flex-[1_1_70%] items-center justify-center overflow-hidden bg-white">
          <QuotationImageFrame
            alt={data.heading}
            className="flex h-full w-full items-center justify-center bg-white"
            imageClassName="block h-auto w-auto max-h-[90%] max-w-[95%] bg-white object-contain"
            imageUrl={data.imageUrl}
            emptyContent={(
              <div className="flex h-full w-full items-center justify-center bg-white px-6 text-center text-xs text-zinc-400">
                Visual pending
              </div>
            )}
            settings={data.imageSettings}
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

export function QuotationPresentation({
  client,
  companyProfile,
  finishImageUrlByItemAndFinishId,
  imageUrlByItemId,
  initialSettings,
  project,
  quotation,
  sections,
  items,
}: {
  client: PresentationClient;
  companyProfile: CompanyProfile;
  finishImageUrlByItemAndFinishId: ImageUrlRecord;
  imageUrlByItemId: ImageUrlRecord;
  initialSettings: QuotationPresentationSettings;
  project: PresentationProject;
  quotation: PresentationQuotation;
  sections: PresentationSection[];
  items: PresentationItem[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [savedSignature, setSavedSignature] = useState(() => settingsSignature(initialSettings));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

  const { displaySections, childrenByParent, sectionsById } = buildDisplaySections(activeSections);
  const allPresentableItemsBySection = new Map(
    activeSections.map((section) => [
      section.id,
      orderedPresentationItems(activeItems, section.id).filter(isPresentationItem),
    ] as const),
  );
  const presentableItemsBySection = new Map(
    activeSections.map((section) => [
      section.id,
      (allPresentableItemsBySection.get(section.id) ?? []).filter((item) => !hiddenItemIds.has(item.id)),
    ] as const),
  );
  const visiblePresentableItems = presentableItems.filter((item) => !hiddenItemIds.has(item.id));
  const visibleCount = visiblePresentableItems.length;
  const totalCount = presentableItems.length;
  const officeLines = companyProfile.offices.filter((office) => office.location?.trim());
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

  const sectionHasContent = (section: DisplaySection) => {
    if ((presentableItemsBySection.get(section.id) ?? []).length) return true;
    if (section.section_kind !== "main") return false;
    return (childrenByParent.get(section.id) ?? []).some((child) => (presentableItemsBySection.get(child.id) ?? []).length > 0);
  };

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

  function resetPresentationSettings() {
    updateSettings(normalizePresentationSettings({}));
  }

  function saveSettings() {
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

  return (
    <main className="min-h-screen bg-[#edf0f3] px-4 py-6 print:bg-white print:px-0 print:py-0">
      <style>{`
        @page { size: A4 landscape; margin: 0; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          html, body { background: #ffffff; }
          .presentation-page { width: 297mm !important; height: 210mm !important; break-after: page; page-break-after: always; overflow: hidden !important; }
          .presentation-stack { gap: 0 !important; }
        }
      `}</style>

      <div className="mx-auto mb-5 flex w-[297mm] max-w-full items-center justify-between gap-4 print:hidden">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Quotation Presentation</p>
          <p className="mt-1 text-sm text-zinc-600">Landscape presentation preview. Use browser print to save as PDF.</p>
        </div>
        <PrintActions />
      </div>

      <section className="mx-auto mb-6 w-[297mm] max-w-full print:hidden">
        <div className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Presentation Settings</p>
              <p className="mt-2 text-lg font-semibold text-zinc-950">{visibleCount} visible / {totalCount} total items</p>
              <p className="mt-1 text-sm text-zinc-500">
                Hidden items and slide-field preferences affect this presentation only.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={resetHiddenItems}
                className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
              >
                Show all items
              </button>
              <button
                type="button"
                onClick={resetSlideFields}
                className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
              >
                Reset slide fields
              </button>
              <button
                type="button"
                onClick={resetPresentationSettings}
                className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
              >
                Reset presentation
              </button>
              <button
                type="button"
                disabled={isPending || !isDirty}
                onClick={saveSettings}
                className="inline-flex h-10 items-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
            {updatedAtLabel ? <p>Last saved: {updatedAtLabel}</p> : <p>Not saved yet</p>}
            {saveMessage ? (
              <p className={saveState === "error" ? "text-red-600" : "text-emerald-700"}>
                {saveMessage}
              </p>
            ) : (
              <p>{isDirty ? "You have unsaved presentation changes." : "Presentation settings are up to date."}</p>
            )}
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_0.85fr_0.9fr]">
            <div className="rounded-[24px] border border-zinc-200 bg-zinc-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Items</p>
                  <p className="mt-1 text-sm text-zinc-500">Include or hide individual product slides by section.</p>
                </div>
              </div>

              <div className="mt-4 grid max-h-[520px] gap-4 overflow-y-auto pr-1">
                {controlSections.map(({ section, items: sectionItems }) => (
                  <div key={section.id} className="rounded-2xl border border-zinc-200 bg-white p-3">
                    <div className="mb-3 flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">{section.section_title}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-400">
                          {section.section_kind === "main" ? "Main Area" : "Area"}
                        </p>
                      </div>
                      <p className="text-xs text-zinc-500">{sectionItems.filter((item) => !hiddenItemIds.has(item.id)).length} visible</p>
                    </div>

                    <div className="grid gap-2">
                      {sectionItems.map((item) => {
                        const included = !hiddenItemIds.has(item.id);
                        const thumbnailUrl = imageUrlByItemId[item.id] ?? null;
                        const title = productTitle(item);
                        const itemNumber = String(settingsItemNumberById.get(item.id) ?? 0).padStart(2, "0");
                        const subline = detailValue([
                          item.item_code_snapshot,
                          item.model_snapshot,
                          item.brand_name_snapshot,
                        ]);

                        return (
                          <label
                            key={item.id}
                            className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 transition ${
                              included
                                ? "border-zinc-200 bg-white"
                                : "border-zinc-200 bg-zinc-50 text-zinc-500"
                            }`}
                          >
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
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-zinc-200 bg-zinc-50/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Slide Layout</p>
              <p className="mt-1 text-sm text-zinc-500">Choose how visible items are arranged in the presentation.</p>

              <div className="mt-4 grid gap-3">
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
            </div>

            <div className="rounded-[24px] border border-zinc-200 bg-zinc-50/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                {isCompactLayout ? "Compact Card Content" : "Slide Content"}
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                {isCompactLayout
                  ? "Two-item slides are image-first and only support minimal details."
                  : "These options apply to one-item product slides."}
              </p>

              <div className="mt-4 grid gap-3">
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
            </div>
          </div>
        </div>

        {visibleCount === 0 ? (
          <div className="mt-4 rounded-[24px] border border-dashed border-zinc-300 bg-white px-5 py-6 text-center">
            <p className="text-sm font-semibold text-zinc-900">No presentation items selected.</p>
            <p className="mt-2 text-sm text-zinc-500">Use the item list above to include one or more quotation items before printing.</p>
          </div>
        ) : null}
      </section>

      <div className="presentation-stack mx-auto flex w-fit max-w-full flex-col gap-5">
        <PresentationPage className="relative overflow-hidden">
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
                  Furniture
                  <span className="block text-zinc-700">Presentation</span>
                </h1>
                <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-600" style={clampStyle(3)}>
                  Curated furniture selections presented by area for review, alignment, and client approval.
                </p>
              </div>

              <div className="grid grid-cols-[1.1fr_0.9fr] gap-10 border-t border-zinc-200 pt-8">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Project</p>
                  <p className="mt-2 text-2xl font-light leading-tight text-zinc-950">
                    {project?.project_name ?? quotation.title}
                  </p>
                  {client?.company_name ? (
                    <p className="mt-4 text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                      Prepared for {client.company_name}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-3 self-end">
                  <MetaCard label="Quotation No." value={quotation.quotation_no} />
                  <MetaCard label="Date" value={formatPresentationDate(quotation.quotation_date)} />
                </div>
              </div>
            </div>

            <div className="relative flex h-full flex-col justify-between px-9 py-10 text-white">
              <div>
                <div className="flex items-center justify-between gap-4">
                  {companyProfile.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={companyProfile.logoUrl}
                      alt={companyProfile.displayName}
                      className="max-h-14 max-w-[150px] object-contain brightness-0 invert"
                    />
                  ) : null}
                </div>
                {!companyProfile.logoUrl ? (
                  <p className="mt-8 text-2xl font-light leading-tight text-white">{companyProfile.displayName}</p>
                ) : null}
                <p className="mt-4 text-sm leading-6 text-white/70">www.noaoffices.com</p>
              </div>

              <div className="grid gap-4 border-t border-white/10 pt-7">
                <MetaLine label="Client" value={client?.company_name ?? null} />
                {!companyProfile.logoUrl ? <MetaLine label="Prepared By" value={companyProfile.displayName} /> : null}
              </div>
            </div>
          </div>
        </PresentationPage>

        <PresentationPage className="overflow-hidden bg-[linear-gradient(130deg,_#eef2f5_0%,_#f8fafc_44%,_#ffffff_44%,_#ffffff_100%)]">
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

        {dividerSections.map((section) => {
          const mainSection = section.section_kind === "main"
            ? section
            : (section.parent_section_id ? sectionsById.get(section.parent_section_id) ?? null : null);
          const sectionPageGroups = productPagesBySection.get(section.id) ?? [];

          return (
            <div key={section.id} className="contents">
              <PresentationPage className="relative overflow-hidden bg-[#f4f6f8]">
                <div className="absolute left-0 top-0 h-full w-24 bg-zinc-950" />
                <div className="absolute left-24 top-0 h-full w-[1px] bg-zinc-200/80" />
                <div className="relative flex h-full flex-col justify-between px-14 py-12 pl-36">
                  <div>
                    <div className="flex items-center gap-4">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-zinc-500">
                        {section.section_kind === "main" ? "Main Area" : "Area"}
                      </span>
                      <span className="h-px w-16 bg-zinc-300" />
                    </div>
                    <h2 className="mt-7 max-w-5xl text-6xl font-light leading-[1.02] tracking-[-0.045em] text-zinc-950">
                      {section.section_title}
                    </h2>
                    {section.section_notes ? (
                      <p className="mt-7 max-w-3xl text-lg leading-8 text-zinc-600" style={clampStyle(4)}>{section.section_notes}</p>
                    ) : null}
                  </div>

                  <div className="flex items-end justify-between gap-6 border-t border-zinc-200 pt-8">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
                        Section {String(dividerSections.indexOf(section) + 1).padStart(2, "0")}
                      </p>
                      {mainSection && mainSection.id !== section.id ? (
                        <p className="mt-2 text-sm font-medium text-zinc-500">Within {mainSection.section_title}</p>
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

              {sectionPageGroups.map((pageItems, pageIndex) => {
                if (settings.layoutMode === "two_per_page") {
                  const pageData = pageItems.map((item) => buildProductPageData({
                    contentVisibility: settings.contentVisibility,
                    finishImageUrlByItemAndFinishId,
                    imageUrlByItemId,
                    item,
                    project,
                  }));

                  return (
                    <PresentationPage key={`${section.id}-page-${pageIndex + 1}`} className="overflow-hidden bg-white">
                      <div className="flex h-full flex-col px-8 py-7">
                        <div className="border-b border-zinc-200 pb-4">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">{section.section_title}</p>
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
                              sectionTitle={section.section_title}
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
                  imageUrlByItemId,
                  item,
                  project,
                });

                return (
                  <PresentationPage key={item.id} className="overflow-hidden bg-white">
                    <div className="grid h-full grid-cols-[1.65fr_0.9fr]">
                      <div className="relative flex h-full flex-col bg-white px-9 py-8">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
                              {section.section_title}
                            </p>
                            <p className="mt-2 text-2xl font-light tracking-tight text-zinc-950" style={clampStyle(2)}>{data.heading}</p>
                          </div>
                          <div className="rounded-full border border-zinc-300 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                            Item {visibleSlideItemNumberById.get(item.id) ?? pageIndex + 1}
                          </div>
                        </div>

                        <div className="mt-5 flex flex-1 items-center justify-center overflow-hidden bg-white">
                          <QuotationImageFrame
                            alt={data.heading}
                            className="flex h-full w-full items-center justify-center bg-white"
                            imageClassName="block h-auto w-auto max-h-[76%] max-w-[86%] bg-white object-contain"
                            imageUrl={data.imageUrl}
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
                            settings={data.imageSettings}
                          />
                        </div>

                        <div className="mt-5 flex items-end justify-between gap-6 border-t border-zinc-200 pt-5">
                          <div className="min-w-0">
                            {data.summary ? (
                              <>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Product Summary</p>
                                <p className="mt-2 text-sm leading-6 text-zinc-600" style={clampStyle(2)}>
                                  {data.summary}
                                </p>
                              </>
                            ) : null}
                          </div>
                          {item.room_name_snapshot ? (
                            <div className="border border-zinc-200 bg-white px-4 py-3 text-right">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Area Tag</p>
                              <p className="mt-1 text-sm font-semibold text-zinc-900">{item.room_name_snapshot}</p>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex h-full flex-col bg-[#f3f4f6] px-8 py-9">
                        <div className="border-b border-zinc-900/10 pb-5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Technical Details</p>
                          <h3 className="mt-3 text-3xl font-light tracking-tight text-zinc-950" style={clampStyle(2)}>{data.heading}</h3>
                          {settings.contentVisibility.specification ? (
                            data.cleanedSpecification ? (
                              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-600" style={clampStyle(8)}>
                                {data.cleanedSpecification}
                              </p>
                            ) : (
                              <p className="mt-4 text-sm leading-7 text-zinc-400">Specification details not added yet.</p>
                            )
                          ) : null}
                        </div>

                        {data.meta.length ? (
                          <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
                            {data.meta.map((row) => (
                              <ProductDetail key={row.label} label={row.label} value={row.value ?? null} />
                            ))}
                          </dl>
                        ) : null}

                        {data.finishGroups.length ? (
                          <div className="mt-5 border-t border-zinc-900/10 pt-5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Finishes</p>
                            <div className="mt-4 grid gap-3">
                              {data.finishGroups.slice(0, 3).map((group) => (
                                <div key={group.label} className="border border-zinc-900/10 bg-white/45 p-3">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{group.label}</p>
                                  <div className="mt-2 grid gap-2">
                                    {group.items.slice(0, 2).map((finish) => (
                                      <div key={finish.id} className="grid grid-cols-[44px_1fr] gap-3">
                                        <div className="h-11 w-11 overflow-hidden bg-zinc-50">
                                          {finish.imageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={finish.imageUrl} alt={finish.name || finish.code || finish.label} className="h-full w-full object-cover" />
                                          ) : (
                                            <div className="h-full w-full bg-[linear-gradient(135deg,_#f4f4f5,_#e4e4e7)]" />
                                          )}
                                        </div>
                                        <div className="min-w-0">
                                          <p className="text-sm font-semibold text-zinc-900" style={clampStyle(2)}>
                                            {[finish.code, finish.name].filter(Boolean).join(" | ") || finish.description || "Selected finish"}
                                          </p>
                                          {finish.description && finish.description !== finish.name ? (
                                            <p className="mt-1 text-xs leading-5 text-zinc-500" style={clampStyle(2)}>{finish.description}</p>
                                          ) : null}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-auto border-t border-zinc-900/10 pt-6">
                          <div className="flex items-end justify-between gap-4">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Prepared By</p>
                              <p className="mt-1 text-sm font-semibold text-zinc-900">{companyProfile.displayName}</p>
                            </div>
                            <div className="text-right">
                              {quotation.quotation_no ? <p className="text-sm font-semibold text-zinc-900">{quotation.quotation_no}</p> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </PresentationPage>
                );
              })}
            </div>
          );
        })}

        <PresentationPage className="relative overflow-hidden">
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
                  Thank You
                </h2>
                <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-600" style={clampStyle(4)}>
                  Thank you for reviewing this furniture presentation. We look forward to supporting the next step of your project.
                </p>
              </div>

              <div className="grid grid-cols-[1.1fr_0.9fr] gap-10 border-t border-zinc-200 pt-8">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">Contact Us</p>
                  <div className="mt-3 grid gap-2 text-sm leading-6 text-zinc-700">
                    {companyProfile.website ? <p>{companyProfile.website}</p> : null}
                    {companyProfile.phone ? <p>{companyProfile.phone}</p> : null}
                    {companyProfile.email ? <p>{companyProfile.email}</p> : null}
                  </div>
                </div>
                <div className="grid gap-3 self-end">
                  {quotation.quotation_no ? <MetaCard label="Quotation No." value={quotation.quotation_no} /> : null}
                  {quotation.quotation_date ? <MetaCard label="Date" value={formatPresentationDate(quotation.quotation_date)} /> : null}
                </div>
              </div>
            </div>

            <div className="relative flex h-full flex-col justify-between px-9 py-10 text-white">
              <div>
                <div className="flex items-center justify-between gap-4">
                  {companyProfile.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={companyProfile.logoUrl}
                      alt={companyProfile.displayName}
                      className="max-h-14 max-w-[150px] object-contain brightness-0 invert"
                    />
                  ) : null}
                </div>
                {!companyProfile.logoUrl ? (
                  <p className="mt-8 text-2xl font-light leading-tight text-white">{companyProfile.displayName}</p>
                ) : null}
                <p className="mt-4 text-sm leading-6 text-white/70">www.noaoffices.com</p>
              </div>

              <div className="grid gap-4 border-t border-white/10 pt-7">
                {officeLines.slice(0, 3).map((office) => (
                  <ContactLine key={office.label} label={office.label} value={office.location} />
                ))}
                <ContactLine label="Email" value={companyProfile.email} />
                <ContactLine label="Phone" value={companyProfile.phone} />
              </div>
            </div>
          </div>
        </PresentationPage>
      </div>
    </main>
  );
}
