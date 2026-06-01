import { normalizePurchaseOrderCurrency } from "@/lib/quotations/purchase-order-currency";
import {
  DEFAULT_LANDSCAPE_PRINT_SETTINGS,
  normalizeDocumentPrintSettings,
  type DocumentPrintSettings,
} from "@/lib/quotations/document-print-settings";

export type PurchaseOrderLogoDisplayMode = "logo_if_available" | "text_wordmark_fallback";

export type PurchaseOrderDocumentDetails = {
  title: string;
  poNumber: string;
  poDate: string;
  currency: string;
  quotationReference: string;
  projectDisplayName: string;
  clientDisplayName: string;
  preparedBy: string;
  companyDisplayName: string;
  phone: string;
  email: string;
  address: string;
  trn: string;
  showLogo: boolean;
  logoDisplayMode: PurchaseOrderLogoDisplayMode;
};

export type PurchaseOrderSupplierOverride = {
  displayName: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  trn: string;
  deliveryContact: string;
};

export type PurchaseOrderItemOverride = {
  hidden: boolean;
  description: string;
  size: string;
  finish: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  remark: string;
};

export type PurchaseOrderColumnVisibility = {
  image: boolean;
  code: boolean;
  supplierPriceListCode: boolean;
  model: boolean;
  brandOrigin: boolean;
  size: boolean;
  finish: boolean;
  unitPrice: boolean;
  lineTotal: boolean;
  remarks: boolean;
};

export type PurchaseOrderTerms = {
  deliveryLocation: string;
  deliveryDate: string;
  paymentTerms: string;
  warrantyNote: string;
  installationNote: string;
  generalNote: string;
  authorizedBy: string;
  authorizedDesignation: string;
};

export type QuotationPurchaseOrderSettings = {
  documentDetails: PurchaseOrderDocumentDetails;
  print: DocumentPrintSettings;
  selectedSupplierKey: string;
  supplierOverrides: Record<string, PurchaseOrderSupplierOverride>;
  itemOverrides: Record<string, PurchaseOrderItemOverride>;
  columnVisibility: PurchaseOrderColumnVisibility;
  terms: PurchaseOrderTerms;
  groupOrder: Record<string, string[]>;
  updatedAt: string | null;
};

export const DEFAULT_PURCHASE_ORDER_DOCUMENT_DETAILS: PurchaseOrderDocumentDetails = {
  title: "Purchase Order",
  poNumber: "",
  poDate: "",
  currency: "AED",
  quotationReference: "",
  projectDisplayName: "",
  clientDisplayName: "",
  preparedBy: "",
  companyDisplayName: "Noa Offices",
  phone: "",
  email: "",
  address: "",
  trn: "",
  showLogo: true,
  logoDisplayMode: "logo_if_available",
};

export const DEFAULT_PURCHASE_ORDER_SUPPLIER_OVERRIDE: PurchaseOrderSupplierOverride = {
  displayName: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  trn: "",
  deliveryContact: "",
};

export const DEFAULT_PURCHASE_ORDER_ITEM_OVERRIDE: PurchaseOrderItemOverride = {
  hidden: false,
  description: "",
  size: "",
  finish: "",
  quantity: null,
  unitPrice: null,
  lineTotal: null,
  remark: "",
};

export const DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY: PurchaseOrderColumnVisibility = {
  image: true,
  code: true,
  supplierPriceListCode: false,
  model: true,
  brandOrigin: true,
  size: true,
  finish: true,
  unitPrice: true,
  lineTotal: true,
  remarks: false,
};

export const DEFAULT_PURCHASE_ORDER_TERMS: PurchaseOrderTerms = {
  deliveryLocation: "",
  deliveryDate: "",
  paymentTerms: "",
  warrantyNote: "",
  installationNote: "",
  generalNote: [
    "Please confirm receipt of this purchase order.",
    "Please confirm delivery schedule before processing.",
    "Any changes must be approved in writing.",
  ].join("\n"),
  authorizedBy: "",
  authorizedDesignation: "",
};

export const DEFAULT_PURCHASE_ORDER_SETTINGS: QuotationPurchaseOrderSettings = {
  documentDetails: DEFAULT_PURCHASE_ORDER_DOCUMENT_DETAILS,
  print: DEFAULT_LANDSCAPE_PRINT_SETTINGS,
  selectedSupplierKey: "",
  supplierOverrides: {},
  itemOverrides: {},
  columnVisibility: DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY,
  terms: DEFAULT_PURCHASE_ORDER_TERMS,
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

export function normalizePurchaseOrderSettings(
  value: unknown,
  options?: { updatedAt?: string | null },
): QuotationPurchaseOrderSettings {
  const record = isRecord(value) ? value : {};
  const documentDetailsRecord = isRecord(record.documentDetails) ? record.documentDetails : undefined;
  const supplierOverridesRecord = isRecord(record.supplierOverrides) ? record.supplierOverrides : undefined;
  const itemOverridesRecord = isRecord(record.itemOverrides) ? record.itemOverrides : undefined;
  const columnVisibilityRecord = isRecord(record.columnVisibility) ? record.columnVisibility : undefined;
  const termsRecord = isRecord(record.terms) ? record.terms : undefined;
  const printRecord = isRecord(record.print) ? record.print : undefined;
  const groupOrderRecord = isRecord(record.groupOrder) ? record.groupOrder : undefined;

  const supplierOverrides = Object.fromEntries(
    Object.entries(supplierOverridesRecord ?? {})
      .map(([key, rawValue]) => {
        if (!isRecord(rawValue)) return null;

        const normalizedValue: PurchaseOrderSupplierOverride = {
          displayName: normalizedString(rawValue, "displayName"),
          contactPerson: normalizedString(rawValue, "contactPerson"),
          email: normalizedString(rawValue, "email"),
          phone: normalizedString(rawValue, "phone"),
          address: normalizedString(rawValue, "address"),
          trn: normalizedString(rawValue, "trn"),
          deliveryContact: normalizedString(rawValue, "deliveryContact"),
        };
        const hasValue = Object.values(normalizedValue).some((entry) => entry.length > 0);

        return hasValue ? [key, normalizedValue] : null;
      })
      .filter((entry): entry is [string, PurchaseOrderSupplierOverride] => Boolean(entry)),
  );

  const itemOverrides = Object.fromEntries(
    Object.entries(itemOverridesRecord ?? {})
      .map(([key, rawValue]) => {
        if (!isRecord(rawValue)) return null;

        const normalizedValue: PurchaseOrderItemOverride = {
          hidden: normalizedBoolean(rawValue, "hidden", false),
          description: normalizedString(rawValue, "description"),
          size: normalizedString(rawValue, "size"),
          finish: normalizedString(rawValue, "finish"),
          quantity: normalizedNumberOrNull(rawValue, "quantity"),
          unitPrice: normalizedNumberOrNull(rawValue, "unitPrice"),
          lineTotal: normalizedNumberOrNull(rawValue, "lineTotal"),
          remark: normalizedString(rawValue, "remark"),
        };
        const hasValue = normalizedValue.hidden
          || normalizedValue.description.length > 0
          || normalizedValue.size.length > 0
          || normalizedValue.finish.length > 0
          || normalizedValue.quantity !== null
          || normalizedValue.unitPrice !== null
          || normalizedValue.lineTotal !== null
          || normalizedValue.remark.length > 0;

        return hasValue ? [key, normalizedValue] : null;
      })
      .filter((entry): entry is [string, PurchaseOrderItemOverride] => Boolean(entry)),
  );

  const groupOrder = Object.fromEntries(
    Object.entries(groupOrderRecord ?? {})
      .map(([key, rawValue]) => [key, normalizedStringArray(rawValue)] as const)
      .filter(([, value]) => value.length > 0),
  );

  return {
    documentDetails: {
      title: normalizedString(documentDetailsRecord, "title", DEFAULT_PURCHASE_ORDER_DOCUMENT_DETAILS.title),
      poNumber: normalizedString(documentDetailsRecord, "poNumber"),
      poDate: normalizedString(documentDetailsRecord, "poDate"),
      currency: normalizePurchaseOrderCurrency(
        normalizedString(documentDetailsRecord, "currency", DEFAULT_PURCHASE_ORDER_DOCUMENT_DETAILS.currency),
      ),
      quotationReference: normalizedString(documentDetailsRecord, "quotationReference"),
      projectDisplayName: normalizedString(documentDetailsRecord, "projectDisplayName"),
      clientDisplayName: normalizedString(documentDetailsRecord, "clientDisplayName"),
      preparedBy: normalizedString(documentDetailsRecord, "preparedBy"),
      companyDisplayName: normalizedString(documentDetailsRecord, "companyDisplayName", DEFAULT_PURCHASE_ORDER_DOCUMENT_DETAILS.companyDisplayName),
      phone: normalizedString(documentDetailsRecord, "phone"),
      email: normalizedString(documentDetailsRecord, "email"),
      address: normalizedString(documentDetailsRecord, "address"),
      trn: normalizedString(documentDetailsRecord, "trn"),
      showLogo: normalizedBoolean(documentDetailsRecord, "showLogo", DEFAULT_PURCHASE_ORDER_DOCUMENT_DETAILS.showLogo),
      logoDisplayMode: documentDetailsRecord?.logoDisplayMode === "text_wordmark_fallback"
        ? "text_wordmark_fallback"
        : "logo_if_available",
    },
    print: normalizeDocumentPrintSettings(printRecord, DEFAULT_PURCHASE_ORDER_SETTINGS.print),
    selectedSupplierKey: normalizedString(record, "selectedSupplierKey"),
    supplierOverrides,
    itemOverrides,
    columnVisibility: {
      image: normalizedBoolean(columnVisibilityRecord, "image", DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY.image),
      code: normalizedBoolean(columnVisibilityRecord, "code", DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY.code),
      supplierPriceListCode: normalizedBoolean(columnVisibilityRecord, "supplierPriceListCode", DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY.supplierPriceListCode),
      model: normalizedBoolean(columnVisibilityRecord, "model", DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY.model),
      brandOrigin: normalizedBoolean(columnVisibilityRecord, "brandOrigin", DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY.brandOrigin),
      size: normalizedBoolean(columnVisibilityRecord, "size", DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY.size),
      finish: normalizedBoolean(columnVisibilityRecord, "finish", DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY.finish),
      unitPrice: normalizedBoolean(columnVisibilityRecord, "unitPrice", DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY.unitPrice),
      lineTotal: normalizedBoolean(columnVisibilityRecord, "lineTotal", DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY.lineTotal),
      remarks: normalizedBoolean(columnVisibilityRecord, "remarks", DEFAULT_PURCHASE_ORDER_COLUMN_VISIBILITY.remarks),
    },
    terms: {
      deliveryLocation: normalizedString(termsRecord, "deliveryLocation"),
      deliveryDate: normalizedString(termsRecord, "deliveryDate"),
      paymentTerms: normalizedString(termsRecord, "paymentTerms"),
      warrantyNote: normalizedString(termsRecord, "warrantyNote"),
      installationNote: normalizedString(termsRecord, "installationNote"),
      generalNote: normalizedString(termsRecord, "generalNote", DEFAULT_PURCHASE_ORDER_TERMS.generalNote),
      authorizedBy: normalizedString(termsRecord, "authorizedBy"),
      authorizedDesignation: normalizedString(termsRecord, "authorizedDesignation"),
    },
    groupOrder,
    updatedAt:
      (typeof record.updatedAt === "string" && record.updatedAt.trim()) ||
      (typeof options?.updatedAt === "string" && options.updatedAt.trim()) ||
      null,
  };
}
