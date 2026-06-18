import {
  DEFAULT_LANDSCAPE_PRINT_SETTINGS,
  normalizeDocumentPrintSettings,
  type DocumentPrintSettings,
} from "@/lib/quotations/document-print-settings";

export type ProcurementRfqLogoDisplayMode = "logo_if_available" | "text_wordmark_fallback";

export type ProcurementRfqDocumentDetails = {
  title: string;
  rfqNumber: string;
  rfqDate: string;
  quotationDate: string;
  projectDisplayName: string;
  clientDisplayName: string;
  preparedBy: string;
  projectContact: string;
  phone: string;
  email: string;
  poBox: string;
  showLogo: boolean;
  logoDisplayMode: ProcurementRfqLogoDisplayMode;
  companyDisplayName: string;
};

export type ProcurementRfqSupplierOverride = {
  displayName: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
};

export type ProcurementRfqItemOverride = {
  hidden: boolean;
  description: string;
  size: string;
  finish: string;
  priceListCode: string;
  productDetails: string;
  quantity: number | null;
  remark: string;
};

export type ProcurementRfqColumnVisibility = {
  image: boolean;
  code: boolean;
  supplierPriceListCode: boolean;
  model: boolean;
  brandOrigin: boolean;
  specification: boolean;
  size: boolean;
  finish: boolean;
  quantity: boolean;
  supplierResponseFields: boolean;
};

export type ProcurementRfqNotes = {
  generalNote: string;
  submissionDate: string;
  deliveryLocation: string;
  terms: string;
};

export type QuotationProcurementRfqSettings = {
  documentDetails: ProcurementRfqDocumentDetails;
  print: DocumentPrintSettings;
  selectedGroupKey: string;
  supplierOverrides: Record<string, ProcurementRfqSupplierOverride>;
  itemOverrides: Record<string, ProcurementRfqItemOverride>;
  columnVisibility: ProcurementRfqColumnVisibility;
  notes: ProcurementRfqNotes;
  groupOrder: Record<string, string[]>;
  updatedAt: string | null;
};

export const DEFAULT_PROCUREMENT_RFQ_DOCUMENT_DETAILS: ProcurementRfqDocumentDetails = {
  title: "Request for Quotation",
  rfqNumber: "",
  rfqDate: "",
  quotationDate: "",
  projectDisplayName: "",
  clientDisplayName: "",
  preparedBy: "",
  projectContact: "",
  phone: "",
  email: "",
  poBox: "",
  showLogo: true,
  logoDisplayMode: "logo_if_available",
  companyDisplayName: "Noa Offices",
};

export const DEFAULT_PROCUREMENT_RFQ_SUPPLIER_OVERRIDE: ProcurementRfqSupplierOverride = {
  displayName: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
};

export const DEFAULT_PROCUREMENT_RFQ_ITEM_OVERRIDE: ProcurementRfqItemOverride = {
  hidden: false,
  description: "",
  size: "",
  finish: "",
  priceListCode: "",
  productDetails: "",
  quantity: null,
  remark: "",
};

export const DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY: ProcurementRfqColumnVisibility = {
  image: true,
  code: true,
  supplierPriceListCode: false,
  model: true,
  brandOrigin: true,
  specification: true,
  size: true,
  finish: true,
  quantity: true,
  supplierResponseFields: false,
};

export const DEFAULT_PROCUREMENT_RFQ_NOTES: ProcurementRfqNotes = {
  generalNote: [
    "Please quote your best price.",
    "Please confirm availability.",
    "Please mention lead time.",
    "Please confirm finish availability.",
    "Please include delivery charges if applicable.",
    "Quotation validity: ___ days",
  ].join("\n"),
  submissionDate: "",
  deliveryLocation: "",
  terms: "",
};

export const DEFAULT_PROCUREMENT_RFQ_SETTINGS: QuotationProcurementRfqSettings = {
  documentDetails: DEFAULT_PROCUREMENT_RFQ_DOCUMENT_DETAILS,
  print: DEFAULT_LANDSCAPE_PRINT_SETTINGS,
  selectedGroupKey: "all",
  supplierOverrides: {},
  itemOverrides: {},
  columnVisibility: DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY,
  notes: DEFAULT_PROCUREMENT_RFQ_NOTES,
  groupOrder: {},
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

  if (value === null || value === "") {
    return null;
  }

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

export function normalizeProcurementRfqSettings(
  value: unknown,
  options?: { updatedAt?: string | null },
): QuotationProcurementRfqSettings {
  const record = isRecord(value) ? value : {};
  const documentDetailsRecord = isRecord(record.documentDetails) ? record.documentDetails : undefined;
  const supplierOverridesRecord = isRecord(record.supplierOverrides) ? record.supplierOverrides : undefined;
  const itemOverridesRecord = isRecord(record.itemOverrides) ? record.itemOverrides : undefined;
  const columnVisibilityRecord = isRecord(record.columnVisibility) ? record.columnVisibility : undefined;
  const notesRecord = isRecord(record.notes) ? record.notes : undefined;
  const printRecord = isRecord(record.print) ? record.print : undefined;
  const groupOrderRecord = isRecord(record.groupOrder) ? record.groupOrder : undefined;

  const supplierOverrides = Object.fromEntries(
    Object.entries(supplierOverridesRecord ?? {})
      .map(([key, rawValue]) => {
        if (!isRecord(rawValue)) return null;

        const normalizedValue: ProcurementRfqSupplierOverride = {
          displayName: normalizedString(rawValue, "displayName"),
          contactPerson: normalizedString(rawValue, "contactPerson"),
          email: normalizedString(rawValue, "email"),
          phone: normalizedString(rawValue, "phone"),
          address: normalizedString(rawValue, "address"),
        };
        const hasValue = Object.values(normalizedValue).some((entry) => entry.length > 0);

        return hasValue ? [key, normalizedValue] : null;
      })
      .filter((entry): entry is [string, ProcurementRfqSupplierOverride] => Boolean(entry)),
  );

  const itemOverrides = Object.fromEntries(
    Object.entries(itemOverridesRecord ?? {})
      .map(([key, rawValue]) => {
        if (!isRecord(rawValue)) return null;

        const normalizedValue: ProcurementRfqItemOverride = {
          hidden: normalizedBoolean(rawValue, "hidden", false),
          description: normalizedString(rawValue, "description"),
          size: normalizedString(rawValue, "size"),
          finish: normalizedString(rawValue, "finish"),
          priceListCode: normalizedString(rawValue, "priceListCode"),
          productDetails: normalizedString(rawValue, "productDetails"),
          quantity: normalizedNumberOrNull(rawValue, "quantity"),
          remark: normalizedString(rawValue, "remark"),
        };
        const hasValue = normalizedValue.hidden
          || normalizedValue.description.length > 0
          || normalizedValue.size.length > 0
          || normalizedValue.finish.length > 0
          || normalizedValue.priceListCode.length > 0
          || normalizedValue.productDetails.length > 0
          || normalizedValue.quantity !== null
          || normalizedValue.remark.length > 0;

        return hasValue ? [key, normalizedValue] : null;
      })
      .filter((entry): entry is [string, ProcurementRfqItemOverride] => Boolean(entry)),
  );

  const groupOrder = Object.fromEntries(
    Object.entries(groupOrderRecord ?? {})
      .map(([key, rawValue]) => [key, normalizedStringArray(rawValue)] as const)
      .filter(([, value]) => value.length > 0),
  );

  return {
    documentDetails: {
      title: normalizedString(documentDetailsRecord, "title", DEFAULT_PROCUREMENT_RFQ_DOCUMENT_DETAILS.title),
      rfqNumber: normalizedString(documentDetailsRecord, "rfqNumber"),
      rfqDate: normalizedString(documentDetailsRecord, "rfqDate"),
      quotationDate: normalizedString(documentDetailsRecord, "quotationDate"),
      projectDisplayName: normalizedString(documentDetailsRecord, "projectDisplayName"),
      clientDisplayName: normalizedString(documentDetailsRecord, "clientDisplayName"),
      preparedBy: normalizedString(documentDetailsRecord, "preparedBy"),
      projectContact: normalizedString(documentDetailsRecord, "projectContact"),
      phone: normalizedString(documentDetailsRecord, "phone"),
      email: normalizedString(documentDetailsRecord, "email"),
      poBox: normalizedString(documentDetailsRecord, "poBox"),
      showLogo: normalizedBoolean(documentDetailsRecord, "showLogo", DEFAULT_PROCUREMENT_RFQ_DOCUMENT_DETAILS.showLogo),
      logoDisplayMode: documentDetailsRecord?.logoDisplayMode === "text_wordmark_fallback"
        ? "text_wordmark_fallback"
        : "logo_if_available",
      companyDisplayName: normalizedString(documentDetailsRecord, "companyDisplayName", DEFAULT_PROCUREMENT_RFQ_DOCUMENT_DETAILS.companyDisplayName),
    },
    print: normalizeDocumentPrintSettings(printRecord, DEFAULT_PROCUREMENT_RFQ_SETTINGS.print),
    selectedGroupKey: normalizedString(record, "selectedGroupKey", DEFAULT_PROCUREMENT_RFQ_SETTINGS.selectedGroupKey),
    supplierOverrides,
    itemOverrides,
    columnVisibility: {
      image: normalizedBoolean(columnVisibilityRecord, "image", DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY.image),
      code: normalizedBoolean(columnVisibilityRecord, "code", DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY.code),
      supplierPriceListCode: normalizedBoolean(columnVisibilityRecord, "supplierPriceListCode", DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY.supplierPriceListCode),
      model: normalizedBoolean(columnVisibilityRecord, "model", DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY.model),
      brandOrigin: normalizedBoolean(columnVisibilityRecord, "brandOrigin", DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY.brandOrigin),
      specification: normalizedBoolean(columnVisibilityRecord, "specification", DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY.specification),
      size: normalizedBoolean(columnVisibilityRecord, "size", DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY.size),
      finish: normalizedBoolean(columnVisibilityRecord, "finish", DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY.finish),
      quantity: normalizedBoolean(columnVisibilityRecord, "quantity", DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY.quantity),
      supplierResponseFields: normalizedBoolean(columnVisibilityRecord, "supplierResponseFields", DEFAULT_PROCUREMENT_RFQ_COLUMN_VISIBILITY.supplierResponseFields),
    },
    notes: {
      generalNote: normalizedString(notesRecord, "generalNote", DEFAULT_PROCUREMENT_RFQ_NOTES.generalNote),
      submissionDate: normalizedString(notesRecord, "submissionDate"),
      deliveryLocation: normalizedString(notesRecord, "deliveryLocation"),
      terms: normalizedString(notesRecord, "terms"),
    },
    groupOrder,
    updatedAt:
      (typeof record.updatedAt === "string" && record.updatedAt.trim()) ||
      (typeof options?.updatedAt === "string" && options.updatedAt.trim()) ||
      null,
  };
}
