export type DocumentPrintOrientation = "landscape" | "portrait";
export type DocumentPrintDensity = "comfortable" | "compact" | "maxFit";
export type DocumentPrintImageSize = "small" | "medium" | "large";
export type DocumentPrintPageFlowMode = "auto" | "manual";
export type DocumentPrintClosingPlacement = "auto" | "samePage" | "newPage";

export type DocumentPrintSettings = {
  orientation: DocumentPrintOrientation;
  density: DocumentPrintDensity;
  imageSize: DocumentPrintImageSize;
  pageFlowMode: DocumentPrintPageFlowMode;
  repeatTableHeader: boolean;
  showFullHeaderOnlyFirstPage: boolean;
  manualPageBreaks: string[];
  pageAssignments: Record<string, number>;
  closingPlacement: DocumentPrintClosingPlacement;
  startEachSectionOnNewPage: boolean;
  keepSectionTogether: boolean;
};

export const DEFAULT_LANDSCAPE_PRINT_SETTINGS: DocumentPrintSettings = {
  orientation: "landscape",
  density: "compact",
  imageSize: "medium",
  pageFlowMode: "auto",
  repeatTableHeader: true,
  showFullHeaderOnlyFirstPage: true,
  manualPageBreaks: [],
  pageAssignments: {},
  closingPlacement: "auto",
  startEachSectionOnNewPage: false,
  keepSectionTogether: false,
};

export const DEFAULT_PORTRAIT_PRINT_SETTINGS: DocumentPrintSettings = {
  ...DEFAULT_LANDSCAPE_PRINT_SETTINGS,
  orientation: "portrait",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedBoolean(source: Record<string, unknown>, key: string, fallback: boolean) {
  return typeof source[key] === "boolean" ? source[key] : fallback;
}

function normalizedStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim()),
  ));
}

function normalizedPageAssignments(value: unknown) {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, rawValue]) => {
        const pageNumber = Number(rawValue);
        return typeof key === "string" && key.trim() && Number.isFinite(pageNumber) && pageNumber > 0
          ? [key.trim(), Math.trunc(pageNumber)]
          : null;
      })
      .filter((entry): entry is [string, number] => Boolean(entry)),
  );
}

export function normalizeDocumentPrintSettings(
  value: unknown,
  fallback: DocumentPrintSettings,
): DocumentPrintSettings {
  const record = isRecord(value) ? value : {};

  return {
    orientation: record.orientation === "portrait" ? "portrait" : "landscape",
    density: record.density === "comfortable"
      ? "comfortable"
      : record.density === "maxFit"
        ? "maxFit"
        : "compact",
    imageSize: record.imageSize === "small"
      ? "small"
      : record.imageSize === "large"
        ? "large"
        : "medium",
    pageFlowMode: record.pageFlowMode === "manual" ? "manual" : "auto",
    repeatTableHeader: normalizedBoolean(record, "repeatTableHeader", fallback.repeatTableHeader),
    showFullHeaderOnlyFirstPage: normalizedBoolean(record, "showFullHeaderOnlyFirstPage", fallback.showFullHeaderOnlyFirstPage),
    manualPageBreaks: normalizedStringArray(record.manualPageBreaks),
    pageAssignments: normalizedPageAssignments(record.pageAssignments),
    closingPlacement: record.closingPlacement === "newPage"
      ? "newPage"
      : record.closingPlacement === "samePage"
        ? "samePage"
        : "auto",
    startEachSectionOnNewPage: normalizedBoolean(record, "startEachSectionOnNewPage", fallback.startEachSectionOnNewPage),
    keepSectionTogether: normalizedBoolean(record, "keepSectionTogether", fallback.keepSectionTogether),
  };
}
