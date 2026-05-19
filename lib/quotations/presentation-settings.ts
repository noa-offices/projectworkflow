export type PresentationContentVisibility = {
  specification: boolean;
  dimensions: boolean;
  finishes: boolean;
  brand: boolean;
  origin: boolean;
  model: boolean;
  code: boolean;
};

export type PresentationLayoutMode = "single" | "two_per_page";

export type PresentationPageVisibility = {
  cover: boolean;
  designConsiderations: boolean;
  mainLayoutPages: boolean;
  sectionDividers: boolean;
  thankYou: boolean;
};

export type PresentationSectionOverride = {
  title: string;
  note: string;
  areaImageUrl: string;
  sectionLayoutImageUrl: string;
};

export type PresentationMainSectionOverride = {
  title: string;
  note: string;
  layoutImageUrl: string;
};

export type PresentationMainLayout = {
  id: string;
  title: string;
  note: string;
  imageUrl: string;
};

export type PresentationVisuals = {
  mainLayouts: PresentationMainLayout[];
};

export type PresentationCoverOverrides = {
  title: string;
  subtitle: string;
  projectDisplayName: string;
  clientDisplayName: string;
  preparedBy: string;
  website: string;
};

export type PresentationClosingOverrides = {
  title: string;
  message: string;
  website: string;
  email: string;
  phone: string;
  officeDetails: string;
};

export type PresentationImageFit = "contain" | "cover";
export type PresentationImagePosition = "center";

export type PresentationFlowOrder = {
  mainSectionKeys: string[];
  sectionKeysByMain: Record<string, string[]>;
  itemIdsBySection: Record<string, string[]>;
};

export type PresentationItemOverride = {
  imageUrl: string;
  imageFit: PresentationImageFit;
  imagePosition: PresentationImagePosition;
  imageScale: number;
};

export type QuotationPresentationSettings = {
  hiddenItemIds: string[];
  flowOrder: PresentationFlowOrder;
  contentVisibility: PresentationContentVisibility;
  layoutMode: PresentationLayoutMode;
  pageVisibility: PresentationPageVisibility;
  mainSectionOverrides: Record<string, PresentationMainSectionOverride>;
  sectionOverrides: Record<string, PresentationSectionOverride>;
  presentationVisuals: PresentationVisuals;
  coverOverrides: PresentationCoverOverrides;
  closingOverrides: PresentationClosingOverrides;
  itemOverrides: Record<string, PresentationItemOverride>;
  updatedAt: string | null;
};

export const DEFAULT_PRESENTATION_CONTENT_VISIBILITY: PresentationContentVisibility = {
  specification: true,
  dimensions: true,
  finishes: true,
  brand: true,
  origin: true,
  model: true,
  code: true,
};

export const DEFAULT_PRESENTATION_PAGE_VISIBILITY: PresentationPageVisibility = {
  cover: true,
  designConsiderations: true,
  mainLayoutPages: true,
  sectionDividers: true,
  thankYou: true,
};

export const DEFAULT_PRESENTATION_COVER_OVERRIDES: PresentationCoverOverrides = {
  title: "",
  subtitle: "",
  projectDisplayName: "",
  clientDisplayName: "",
  preparedBy: "",
  website: "",
};

export const DEFAULT_PRESENTATION_CLOSING_OVERRIDES: PresentationClosingOverrides = {
  title: "",
  message: "",
  website: "",
  email: "",
  phone: "",
  officeDetails: "",
};

export const DEFAULT_PRESENTATION_ITEM_OVERRIDE: PresentationItemOverride = {
  imageUrl: "",
  imageFit: "contain",
  imagePosition: "center",
  imageScale: 1,
};

export const DEFAULT_PRESENTATION_FLOW_ORDER: PresentationFlowOrder = {
  mainSectionKeys: [],
  sectionKeysByMain: {},
  itemIdsBySection: {},
};

export const DEFAULT_PRESENTATION_SECTION_OVERRIDE: PresentationSectionOverride = {
  title: "",
  note: "",
  areaImageUrl: "",
  sectionLayoutImageUrl: "",
};

export const DEFAULT_PRESENTATION_MAIN_SECTION_OVERRIDE: PresentationMainSectionOverride = {
  title: "",
  note: "",
  layoutImageUrl: "",
};

export const DEFAULT_PRESENTATION_VISUALS: PresentationVisuals = {
  mainLayouts: [],
};

export const DEFAULT_QUOTATION_PRESENTATION_SETTINGS: QuotationPresentationSettings = {
  hiddenItemIds: [],
  flowOrder: DEFAULT_PRESENTATION_FLOW_ORDER,
  contentVisibility: DEFAULT_PRESENTATION_CONTENT_VISIBILITY,
  layoutMode: "single",
  pageVisibility: DEFAULT_PRESENTATION_PAGE_VISIBILITY,
  mainSectionOverrides: {},
  sectionOverrides: {},
  presentationVisuals: DEFAULT_PRESENTATION_VISUALS,
  coverOverrides: DEFAULT_PRESENTATION_COVER_OVERRIDES,
  closingOverrides: DEFAULT_PRESENTATION_CLOSING_OVERRIDES,
  itemOverrides: {},
  updatedAt: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedBoolean(
  source: Record<string, unknown> | undefined,
  key: keyof PresentationContentVisibility,
) {
  return typeof source?.[key] === "boolean"
    ? source[key] as boolean
    : DEFAULT_PRESENTATION_CONTENT_VISIBILITY[key];
}

function normalizedPageBoolean(
  source: Record<string, unknown> | undefined,
  key: keyof PresentationPageVisibility,
  aliases: string[] = [],
) {
  if (typeof source?.[key] === "boolean") {
    return source[key] as boolean;
  }

  for (const alias of aliases) {
    if (typeof source?.[alias] === "boolean") {
      return source[alias] as boolean;
    }
  }

  return DEFAULT_PRESENTATION_PAGE_VISIBILITY[key];
}

function normalizedString(
  source: Record<string, unknown> | undefined,
  key: string,
) {
  return typeof source?.[key] === "string" ? source[key].trim() : "";
}

function normalizedItemImageScale(source: Record<string, unknown> | undefined) {
  const rawValue = Number(source?.imageScale);
  if (!Number.isFinite(rawValue)) return 1;
  return Math.min(Math.max(rawValue, 0.6), 1.2);
}

function normalizedStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim()),
  ));
}

export function normalizeFlowOrder(value: unknown): PresentationFlowOrder {
  const record = isRecord(value) ? value : {};
  const sectionKeysByMainRecord = isRecord(record.sectionKeysByMain)
    ? record.sectionKeysByMain
    : undefined;
  const itemIdsBySectionRecord = isRecord(record.itemIdsBySection)
    ? record.itemIdsBySection
    : undefined;

  return {
    mainSectionKeys: normalizedStringArray(record.mainSectionKeys),
    sectionKeysByMain: Object.fromEntries(
      Object.entries(sectionKeysByMainRecord ?? {})
        .map(([key, entry]) => [key, normalizedStringArray(entry)] as const)
        .filter(([, entry]) => entry.length > 0),
    ),
    itemIdsBySection: Object.fromEntries(
      Object.entries(itemIdsBySectionRecord ?? {})
        .map(([key, entry]) => [key, normalizedStringArray(entry)] as const)
        .filter(([, entry]) => entry.length > 0),
    ),
  };
}

function normalizedMainLayout(
  value: unknown,
  fallbackId: string,
): PresentationMainLayout | null {
  if (!isRecord(value)) return null;

  const title = normalizedString(value, "title");
  const note = normalizedString(value, "note");
  const imageUrl = normalizedString(value, "imageUrl");
  const id = normalizedString(value, "id") || fallbackId;

  if (!title && !note && !imageUrl) return null;

  return { id, title, note, imageUrl };
}

function normalizedLegacyMainLayout(
  primarySource: Record<string, unknown> | undefined,
  fallbackSource: Record<string, unknown> | undefined,
) {
  return normalizedMainLayout({
    id: "main-layout-1",
    title:
      normalizedString(primarySource, "mainLayoutTitle") ||
      normalizedString(fallbackSource, "mainLayoutTitle"),
    note:
      normalizedString(primarySource, "mainLayoutNote") ||
      normalizedString(fallbackSource, "mainLayoutNote"),
    imageUrl:
      normalizedString(primarySource, "mainLayoutImageUrl") ||
      normalizedString(fallbackSource, "mainLayoutImageUrl"),
  }, "main-layout-1");
}

export function normalizePresentationSettings(
  value: unknown,
  options?: { updatedAt?: string | null },
): QuotationPresentationSettings {
  const record = isRecord(value) ? value : {};
  const hiddenItemIds = Array.isArray(record.hiddenItemIds)
    ? record.hiddenItemIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const flowOrder = normalizeFlowOrder(record.flowOrder);
  const contentVisibility = isRecord(record.contentVisibility)
    ? record.contentVisibility
    : undefined;
  const pageVisibility = isRecord(record.pageVisibility)
    ? record.pageVisibility
    : undefined;
  const mainSectionOverridesRecord = isRecord(record.mainSectionOverrides)
    ? record.mainSectionOverrides
    : undefined;
  const sectionOverridesRecord = isRecord(record.sectionOverrides)
    ? record.sectionOverrides
    : undefined;
  const presentationVisualsRecord = isRecord(record.presentationVisuals)
    ? record.presentationVisuals
    : undefined;
  const coverOverridesRecord = isRecord(record.coverOverrides)
    ? record.coverOverrides
    : undefined;
  const closingOverridesRecord = isRecord(record.closingOverrides)
    ? record.closingOverrides
    : undefined;
  const itemOverridesRecord = isRecord(record.itemOverrides)
    ? record.itemOverrides
    : undefined;

  const layoutMode = record.layoutMode === "two_per_page" ? "two_per_page" : "single";
  const rootMainLayouts = Array.isArray(record.mainLayouts) ? record.mainLayouts : undefined;
  const mainLayoutsSource = Array.isArray(presentationVisualsRecord?.mainLayouts)
    ? presentationVisualsRecord.mainLayouts
    : rootMainLayouts;
  const mainLayouts = Array.isArray(mainLayoutsSource)
    ? mainLayoutsSource
      .map((entry, index) => normalizedMainLayout(entry, `main-layout-${index + 1}`))
      .filter((entry): entry is PresentationMainLayout => Boolean(entry))
    : [];
  const legacyMainLayout = normalizedLegacyMainLayout(presentationVisualsRecord, record);
  const sectionOverrides = Object.fromEntries(
    Object.entries(sectionOverridesRecord ?? {})
      .map(([key, overrideValue]) => {
        if (!isRecord(overrideValue)) return null;
        const title = typeof overrideValue.title === "string" ? overrideValue.title.trim() : "";
        const note = normalizedString(overrideValue, "note");
        const areaImageUrl = normalizedString(overrideValue, "areaImageUrl");
        const sectionLayoutImageUrl =
          normalizedString(overrideValue, "sectionLayoutImageUrl") ||
          normalizedString(overrideValue, "floorPlanImageUrl");
        const hasValue = title || note || areaImageUrl || sectionLayoutImageUrl;
        return hasValue ? [key, { title, note, areaImageUrl, sectionLayoutImageUrl }] : null;
      })
      .filter((entry): entry is [string, PresentationSectionOverride] => Boolean(entry)),
  );
  const mainSectionOverrides = Object.fromEntries(
    Object.entries(mainSectionOverridesRecord ?? {})
      .map(([key, overrideValue]) => {
        if (!isRecord(overrideValue)) return null;
        const title = normalizedString(overrideValue, "title");
        const note = normalizedString(overrideValue, "note");
        const layoutImageUrl =
          normalizedString(overrideValue, "layoutImageUrl") ||
          normalizedString(overrideValue, "mainLayoutImageUrl") ||
          normalizedString(overrideValue, "imageUrl");
        const hasValue = title || note || layoutImageUrl;
        return hasValue ? [key, { title, note, layoutImageUrl }] : null;
      })
      .filter((entry): entry is [string, PresentationMainSectionOverride] => Boolean(entry)),
  );
  const itemOverrides = Object.fromEntries(
    Object.entries(itemOverridesRecord ?? {})
      .map(([key, overrideValue]) => {
        if (!isRecord(overrideValue)) return null;
        const imageUrl = normalizedString(overrideValue, "imageUrl");
        const imageFit = overrideValue.imageFit === "cover" ? "cover" : "contain";
        const imagePosition = "center" as const;
        const imageScale = normalizedItemImageScale(overrideValue);
        const hasValue = imageUrl || imageFit !== "contain" || imagePosition !== "center" || imageScale !== 1;
        return hasValue
          ? [key, { imageUrl, imageFit, imagePosition, imageScale }]
          : null;
      })
      .filter((entry): entry is [string, PresentationItemOverride] => Boolean(entry)),
  );

  return {
    hiddenItemIds: Array.from(new Set(hiddenItemIds)),
    flowOrder,
    contentVisibility: {
      specification: normalizedBoolean(contentVisibility, "specification"),
      dimensions: normalizedBoolean(contentVisibility, "dimensions"),
      finishes: normalizedBoolean(contentVisibility, "finishes"),
      brand: normalizedBoolean(contentVisibility, "brand"),
      origin: normalizedBoolean(contentVisibility, "origin"),
      model: normalizedBoolean(contentVisibility, "model"),
      code: normalizedBoolean(contentVisibility, "code"),
    },
    layoutMode,
    pageVisibility: {
      cover: normalizedPageBoolean(pageVisibility, "cover"),
      designConsiderations: normalizedPageBoolean(pageVisibility, "designConsiderations"),
      mainLayoutPages: normalizedPageBoolean(pageVisibility, "mainLayoutPages", ["mainAreaLayouts", "mainAreaLayoutPages"]),
      sectionDividers: normalizedPageBoolean(pageVisibility, "sectionDividers"),
      thankYou: normalizedPageBoolean(pageVisibility, "thankYou"),
    },
    mainSectionOverrides,
    sectionOverrides,
    presentationVisuals: {
      mainLayouts: mainLayouts.length ? mainLayouts : legacyMainLayout ? [legacyMainLayout] : [],
    },
    coverOverrides: {
      title: normalizedString(coverOverridesRecord, "title"),
      subtitle: normalizedString(coverOverridesRecord, "subtitle"),
      projectDisplayName: normalizedString(coverOverridesRecord, "projectDisplayName"),
      clientDisplayName: normalizedString(coverOverridesRecord, "clientDisplayName"),
      preparedBy: normalizedString(coverOverridesRecord, "preparedBy"),
      website: normalizedString(coverOverridesRecord, "website"),
    },
    closingOverrides: {
      title: normalizedString(closingOverridesRecord, "title"),
      message: normalizedString(closingOverridesRecord, "message"),
      website: normalizedString(closingOverridesRecord, "website"),
      email: normalizedString(closingOverridesRecord, "email"),
      phone: normalizedString(closingOverridesRecord, "phone"),
      officeDetails: normalizedString(closingOverridesRecord, "officeDetails"),
    },
    itemOverrides,
    updatedAt:
      (typeof record.updatedAt === "string" && record.updatedAt.trim()) ||
      (typeof options?.updatedAt === "string" && options.updatedAt.trim()) ||
      null,
  };
}
