export type QuotationPdfOrientation = "landscape" | "portrait";
export type QuotationPdfDensity = "comfortable" | "compact" | "maxFit";
export type QuotationPdfImageSize = "small" | "medium" | "large";
export type QuotationPdfFooterMode = "fullContact";

export const DEFAULT_QUOTATION_NOTES = [
  "• Prices quoted are in AED and exclusive of VAT unless otherwise stated.",
  "• Quotation is valid for 60 days from the date of submission.",
  "• Any changes in quantity, design, dimensions, materials, finishes, or scope of work may result in revised pricing and delivery schedule.",
  "• Client shall ensure site readiness, clear access, and availability of necessary utilities prior to delivery and installation.",
  "• Delays caused by site conditions, third parties, or force majeure events shall not be the responsibility of the supplier.",
  "• Minor variations in color, texture, grain, or dimensions may occur due to manufacturing tolerances and material characteristics.",
  "• Ownership of goods remains with the supplier until full payment has been received.",
  "• Any additional works not included in this proposal shall be charged separately.",
  "• Acceptance of this proposal or issuance of a purchase order shall constitute acceptance of these terms and conditions.",
].join("\n");

export type QuotationPdfSettings = {
  orientation: QuotationPdfOrientation;
  density: QuotationPdfDensity;
  imageSize: QuotationPdfImageSize;
  repeatTableHeader: boolean;
  showFullHeaderOnlyFirstPage: boolean;
  manualPageBreaks: string[];
  keepSectionTogether: boolean;
  closingPreparedName: string;
  notesOverride: string | null;
  footerMode: QuotationPdfFooterMode;
  updatedAt: string | null;
};

export const DEFAULT_QUOTATION_PDF_SETTINGS: QuotationPdfSettings = {
  orientation: "landscape",
  density: "compact",
  imageSize: "medium",
  repeatTableHeader: true,
  showFullHeaderOnlyFirstPage: true,
  manualPageBreaks: [],
  keepSectionTogether: false,
  closingPreparedName: "NOA OFFICES",
  notesOverride: null,
  footerMode: "fullContact",
  updatedAt: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedBoolean(source: Record<string, unknown> | undefined, key: string, fallback: boolean) {
  return typeof source?.[key] === "boolean" ? source[key] : fallback;
}

function normalizedStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim()),
  ));
}

function normalizedString(source: Record<string, unknown> | undefined, key: string, fallback: string) {
  const value = source?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizedNullableMultilineString(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeQuotationPdfSettings(
  value: unknown,
  options?: { updatedAt?: string | null },
): QuotationPdfSettings {
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
    repeatTableHeader: normalizedBoolean(record, "repeatTableHeader", DEFAULT_QUOTATION_PDF_SETTINGS.repeatTableHeader),
    showFullHeaderOnlyFirstPage: normalizedBoolean(record, "showFullHeaderOnlyFirstPage", DEFAULT_QUOTATION_PDF_SETTINGS.showFullHeaderOnlyFirstPage),
    manualPageBreaks: normalizedStringArray(record.manualPageBreaks),
    keepSectionTogether: normalizedBoolean(record, "keepSectionTogether", DEFAULT_QUOTATION_PDF_SETTINGS.keepSectionTogether),
    closingPreparedName: normalizedString(record, "closingPreparedName", DEFAULT_QUOTATION_PDF_SETTINGS.closingPreparedName),
    notesOverride: normalizedNullableMultilineString(record, "notesOverride"),
    footerMode: "fullContact",
    updatedAt: options?.updatedAt ?? (typeof record.updatedAt === "string" ? record.updatedAt : null),
  };
}
