export type OrderConfirmationLogoDisplayMode = "logo_if_available" | "text_wordmark_fallback";

export type OrderConfirmationDocumentDetails = {
  title: string;
  confirmationNumber: string;
  confirmationDate: string;
  quotationReference: string;
  projectDisplayName: string;
  clientDisplayName: string;
  location: string;
  attentionContact: string;
  preparedBy: string;
  companyDisplayName: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  companyAddress: string;
  showLogo: boolean;
  logoDisplayMode: OrderConfirmationLogoDisplayMode;
};

export type OrderConfirmationItemOverride = {
  hidden: boolean;
  title: string;
  description: string;
  dimensions: string;
  finish: string;
  quantity: number | null;
  note: string;
};

export type OrderConfirmationColumnVisibility = {
  image: boolean;
  code: boolean;
  model: boolean;
  brand: boolean;
  origin: boolean;
  dimensions: boolean;
  selectedFinishes: boolean;
  specification: boolean;
  quantity: boolean;
  areaSection: boolean;
};

export type OrderConfirmationTerms = {
  deliveryInstallationNote: string;
  paymentTerms: string;
  generalConfirmationNote: string;
  approvalStatement: string;
  clientName: string;
  authorizedPerson: string;
  signatureLabel: string;
  dateLabel: string;
  companyStampLabel: string;
};

export type QuotationOrderConfirmationSettings = {
  documentDetails: OrderConfirmationDocumentDetails;
  itemOverrides: Record<string, OrderConfirmationItemOverride>;
  columnVisibility: OrderConfirmationColumnVisibility;
  terms: OrderConfirmationTerms;
  itemOrder: string[];
  updatedAt: string | null;
};

export const DEFAULT_ORDER_CONFIRMATION_DOCUMENT_DETAILS: OrderConfirmationDocumentDetails = {
  title: "Order Confirmation",
  confirmationNumber: "",
  confirmationDate: "",
  quotationReference: "",
  projectDisplayName: "",
  clientDisplayName: "",
  location: "",
  attentionContact: "",
  preparedBy: "Noa Offices",
  companyDisplayName: "Noa Offices",
  companyPhone: "",
  companyEmail: "",
  companyWebsite: "www.noaoffices.com",
  companyAddress: "",
  showLogo: true,
  logoDisplayMode: "logo_if_available",
};

export const DEFAULT_ORDER_CONFIRMATION_ITEM_OVERRIDE: OrderConfirmationItemOverride = {
  hidden: false,
  title: "",
  description: "",
  dimensions: "",
  finish: "",
  quantity: null,
  note: "",
};

export const DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY: OrderConfirmationColumnVisibility = {
  image: true,
  code: true,
  model: true,
  brand: true,
  origin: true,
  dimensions: true,
  selectedFinishes: true,
  specification: true,
  quantity: true,
  areaSection: true,
};

export const DEFAULT_ORDER_CONFIRMATION_TERMS: OrderConfirmationTerms = {
  deliveryInstallationNote: "Please review and confirm the approved items listed below.",
  paymentTerms: "As per the referenced quotation and approved terms.",
  generalConfirmationNote: [
    "Please review and confirm the approved items listed below.",
    "This confirmation is based on the referenced quotation and selected specifications.",
    "Any changes after confirmation may affect pricing, availability, or delivery timeline.",
  ].join("\n"),
  approvalStatement: "Please sign below to confirm approval of the listed items and specifications.",
  clientName: "",
  authorizedPerson: "",
  signatureLabel: "Signature",
  dateLabel: "Date",
  companyStampLabel: "Company Stamp",
};

export const DEFAULT_ORDER_CONFIRMATION_SETTINGS: QuotationOrderConfirmationSettings = {
  documentDetails: DEFAULT_ORDER_CONFIRMATION_DOCUMENT_DETAILS,
  itemOverrides: {},
  columnVisibility: DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY,
  terms: DEFAULT_ORDER_CONFIRMATION_TERMS,
  itemOrder: [],
  updatedAt: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedString(source: Record<string, unknown> | undefined, key: string, fallback = "") {
  return typeof source?.[key] === "string" ? source[key].trim() : fallback;
}

function normalizedBoolean(source: Record<string, unknown> | undefined, key: string, fallback: boolean) {
  return typeof source?.[key] === "boolean" ? source[key] : fallback;
}

function normalizedNumberOrNull(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim()),
  ));
}

export function normalizeOrderConfirmationSettings(
  value: unknown,
  options?: { updatedAt?: string | null },
): QuotationOrderConfirmationSettings {
  const record = isRecord(value) ? value : {};
  const documentDetailsRecord = isRecord(record.documentDetails) ? record.documentDetails : undefined;
  const itemOverridesRecord = isRecord(record.itemOverrides) ? record.itemOverrides : undefined;
  const columnVisibilityRecord = isRecord(record.columnVisibility) ? record.columnVisibility : undefined;
  const termsRecord = isRecord(record.terms) ? record.terms : undefined;

  const itemOverrides = Object.fromEntries(
    Object.entries(itemOverridesRecord ?? {})
      .map(([key, rawValue]) => {
        if (!isRecord(rawValue)) return null;

        const normalizedValue: OrderConfirmationItemOverride = {
          hidden: normalizedBoolean(rawValue, "hidden", false),
          title: normalizedString(rawValue, "title"),
          description: normalizedString(rawValue, "description"),
          dimensions: normalizedString(rawValue, "dimensions"),
          finish: normalizedString(rawValue, "finish"),
          quantity: normalizedNumberOrNull(rawValue, "quantity"),
          note: normalizedString(rawValue, "note"),
        };
        const hasValue = normalizedValue.hidden
          || normalizedValue.title.length > 0
          || normalizedValue.description.length > 0
          || normalizedValue.dimensions.length > 0
          || normalizedValue.finish.length > 0
          || normalizedValue.quantity !== null
          || normalizedValue.note.length > 0;

        return hasValue ? [key, normalizedValue] : null;
      })
      .filter((entry): entry is [string, OrderConfirmationItemOverride] => Boolean(entry)),
  );

  return {
    documentDetails: {
      title: normalizedString(documentDetailsRecord, "title", DEFAULT_ORDER_CONFIRMATION_DOCUMENT_DETAILS.title),
      confirmationNumber: normalizedString(documentDetailsRecord, "confirmationNumber"),
      confirmationDate: normalizedString(documentDetailsRecord, "confirmationDate"),
      quotationReference: normalizedString(documentDetailsRecord, "quotationReference"),
      projectDisplayName: normalizedString(documentDetailsRecord, "projectDisplayName"),
      clientDisplayName: normalizedString(documentDetailsRecord, "clientDisplayName"),
      location: normalizedString(documentDetailsRecord, "location"),
      attentionContact: normalizedString(documentDetailsRecord, "attentionContact"),
      preparedBy: normalizedString(documentDetailsRecord, "preparedBy", DEFAULT_ORDER_CONFIRMATION_DOCUMENT_DETAILS.preparedBy),
      companyDisplayName: normalizedString(documentDetailsRecord, "companyDisplayName", DEFAULT_ORDER_CONFIRMATION_DOCUMENT_DETAILS.companyDisplayName),
      companyPhone: normalizedString(documentDetailsRecord, "companyPhone"),
      companyEmail: normalizedString(documentDetailsRecord, "companyEmail"),
      companyWebsite: normalizedString(documentDetailsRecord, "companyWebsite", DEFAULT_ORDER_CONFIRMATION_DOCUMENT_DETAILS.companyWebsite),
      companyAddress: normalizedString(documentDetailsRecord, "companyAddress"),
      showLogo: normalizedBoolean(documentDetailsRecord, "showLogo", DEFAULT_ORDER_CONFIRMATION_DOCUMENT_DETAILS.showLogo),
      logoDisplayMode: documentDetailsRecord?.logoDisplayMode === "text_wordmark_fallback"
        ? "text_wordmark_fallback"
        : "logo_if_available",
    },
    itemOverrides,
    columnVisibility: {
      image: normalizedBoolean(columnVisibilityRecord, "image", DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY.image),
      code: normalizedBoolean(columnVisibilityRecord, "code", DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY.code),
      model: normalizedBoolean(columnVisibilityRecord, "model", DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY.model),
      brand: normalizedBoolean(columnVisibilityRecord, "brand", DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY.brand),
      origin: normalizedBoolean(columnVisibilityRecord, "origin", DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY.origin),
      dimensions: normalizedBoolean(columnVisibilityRecord, "dimensions", DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY.dimensions),
      selectedFinishes: normalizedBoolean(columnVisibilityRecord, "selectedFinishes", DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY.selectedFinishes),
      specification: normalizedBoolean(columnVisibilityRecord, "specification", DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY.specification),
      quantity: normalizedBoolean(columnVisibilityRecord, "quantity", DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY.quantity),
      areaSection: normalizedBoolean(columnVisibilityRecord, "areaSection", DEFAULT_ORDER_CONFIRMATION_COLUMN_VISIBILITY.areaSection),
    },
    terms: {
      deliveryInstallationNote: normalizedString(termsRecord, "deliveryInstallationNote", DEFAULT_ORDER_CONFIRMATION_TERMS.deliveryInstallationNote),
      paymentTerms: normalizedString(termsRecord, "paymentTerms", DEFAULT_ORDER_CONFIRMATION_TERMS.paymentTerms),
      generalConfirmationNote: normalizedString(termsRecord, "generalConfirmationNote", DEFAULT_ORDER_CONFIRMATION_TERMS.generalConfirmationNote),
      approvalStatement: normalizedString(termsRecord, "approvalStatement", DEFAULT_ORDER_CONFIRMATION_TERMS.approvalStatement),
      clientName: normalizedString(termsRecord, "clientName"),
      authorizedPerson: normalizedString(termsRecord, "authorizedPerson"),
      signatureLabel: normalizedString(termsRecord, "signatureLabel", DEFAULT_ORDER_CONFIRMATION_TERMS.signatureLabel),
      dateLabel: normalizedString(termsRecord, "dateLabel", DEFAULT_ORDER_CONFIRMATION_TERMS.dateLabel),
      companyStampLabel: normalizedString(termsRecord, "companyStampLabel", DEFAULT_ORDER_CONFIRMATION_TERMS.companyStampLabel),
    },
    itemOrder: normalizedStringArray(record.itemOrder),
    updatedAt:
      (typeof record.updatedAt === "string" && record.updatedAt.trim()) ||
      (typeof options?.updatedAt === "string" && options.updatedAt.trim()) ||
      null,
  };
}
