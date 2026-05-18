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

export type QuotationPresentationSettings = {
  hiddenItemIds: string[];
  contentVisibility: PresentationContentVisibility;
  layoutMode: PresentationLayoutMode;
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

export const DEFAULT_QUOTATION_PRESENTATION_SETTINGS: QuotationPresentationSettings = {
  hiddenItemIds: [],
  contentVisibility: DEFAULT_PRESENTATION_CONTENT_VISIBILITY,
  layoutMode: "single",
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

export function normalizePresentationSettings(
  value: unknown,
  options?: { updatedAt?: string | null },
): QuotationPresentationSettings {
  const record = isRecord(value) ? value : {};
  const hiddenItemIds = Array.isArray(record.hiddenItemIds)
    ? record.hiddenItemIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const contentVisibility = isRecord(record.contentVisibility)
    ? record.contentVisibility
    : undefined;

  const layoutMode = record.layoutMode === "two_per_page" ? "two_per_page" : "single";

  return {
    hiddenItemIds: Array.from(new Set(hiddenItemIds)),
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
    updatedAt:
      (typeof record.updatedAt === "string" && record.updatedAt.trim()) ||
      (typeof options?.updatedAt === "string" && options.updatedAt.trim()) ||
      null,
  };
}
