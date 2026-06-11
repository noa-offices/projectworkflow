import {
  opportunityNumberFromQuotationNumber,
  quotationFolderNumberFromQuotationNumber,
} from "@/lib/projectworkflow-numbering";

type RecordLike = Record<string, unknown>;

export type DocumentVisibilitySettings = {
  quotation: {
    showClientPhone: boolean;
    showClientEmail: boolean;
    showPoBox: boolean;
    showTelephone: boolean;
    showProjectReference: boolean;
    showLocationAddress: boolean;
    showItemImages: boolean;
    showDimensions: boolean;
    showSupplierOrigin: boolean;
    showUnitPrice: boolean;
    showDiscount: boolean;
    showNetTotal: boolean;
    showVat: boolean;
    showCommercialTerms: boolean;
    showNotes: boolean;
  };
  specification: {
    showClientReferenceHeader: boolean;
    showItemImages: boolean;
    showDimensions: boolean;
    showMaterialDetails: boolean;
    showPrices: boolean;
  };
  presentation: {
    showCoverReference: boolean;
    showProductImages: boolean;
    showItemDescriptions: boolean;
    showDimensions: boolean;
    showPricing: boolean;
    showClosingNotes: boolean;
  };
};

export type DocumentSetupInput = {
  client?: {
    client_number?: string | null;
    company_name?: string | null;
    phone?: string | null;
    po_box?: string | null;
    telephone?: string | null;
  } | null;
  project?: {
    attention_email?: string | null;
    attention_landline?: string | null;
    attention_mobile?: string | null;
    attention_to?: string | null;
    location?: string | null;
    po_box?: string | null;
    project_address?: string | null;
    project_name?: string | null;
  } | null;
  quotation: {
    currency?: string | null;
    delivery_terms?: string | null;
    layout_settings?: unknown;
    legacy_reference?: string | null;
    notes?: string | null;
    option_no?: number | null;
    overall_discount_type?: string | null;
    overall_discount_value?: number | null;
    payment_terms?: string | null;
    project_id?: string | null;
    quotation_date?: string | null;
    quotation_no?: string | null;
    revision_no?: number | null;
    title?: string | null;
    validity?: string | null;
    vat_percent?: number | null;
    warranty_terms?: string | null;
  };
};

export type ResolvedDocumentSetup = {
  commercial: {
    currency: string;
    deliveryTerms: string;
    overallDiscountType: string;
    overallDiscountValue: number;
    paymentTerms: string;
    validity: string;
    vatPercent: number;
    warrantyTerms: string;
  };
  header: {
    clientDisplayName: string;
    clientNo: string | null;
    contactEmail: string;
    contactName: string;
    contactPhone: string;
    folderNo: string | null;
    hasConfirmedProject: boolean;
    location: string;
    opportunityNo: string | null;
    poBox: string;
    projectAddress: string;
    telephone: string;
    quotationDate: string;
    quotationNo: string | null;
    reference: string;
  };
  notes: {
    clientClosingNote: string;
    clientIntroNote: string;
    deliveryInstallNote: string;
    exclusionNote: string;
    footerNote: string;
    internalNote: string;
    termsNote: string;
  };
  revisionOption: {
    clientFacingNote: string;
    internalNote: string;
    reason: string;
    sequenceLabel: string | null;
    supersedesText: string;
    type: "Original" | "Revision" | "Option";
  };
  visibility: DocumentVisibilitySettings;
};

export const defaultDocumentVisibility: DocumentVisibilitySettings = {
  quotation: {
    showClientPhone: true,
    showClientEmail: true,
    showPoBox: true,
    showTelephone: true,
    showProjectReference: true,
    showLocationAddress: true,
    showItemImages: true,
    showDimensions: true,
    showSupplierOrigin: true,
    showUnitPrice: true,
    showDiscount: true,
    showNetTotal: true,
    showVat: true,
    showCommercialTerms: true,
    showNotes: true,
  },
  specification: {
    showClientReferenceHeader: true,
    showItemImages: true,
    showDimensions: true,
    showMaterialDetails: true,
    showPrices: false,
  },
  presentation: {
    showCoverReference: true,
    showProductImages: true,
    showItemDescriptions: true,
    showDimensions: true,
    showPricing: false,
    showClosingNotes: true,
  },
};

export function documentSetupRecord(layoutSettings: unknown): RecordLike {
  if (!isRecord(layoutSettings)) return {};
  const setup = layoutSettings.documentSetup;
  return isRecord(setup) ? setup : {};
}

export function mergeDocumentSetupIntoLayoutSettings(layoutSettings: unknown, documentSetup: RecordLike) {
  return {
    ...(isRecord(layoutSettings) ? layoutSettings : {}),
    documentSetup,
  };
}

export function resolveDocumentSetup(input: DocumentSetupInput): ResolvedDocumentSetup {
  const setup = documentSetupRecord(input.quotation.layout_settings);
  const header = recordValue(setup.header);
  const commercial = recordValue(setup.commercial);
  const notes = recordValue(setup.notes);
  const revisionOption = recordValue(setup.revisionOption);
  const visibility = visibilityValue(recordValue(setup.visibility));
  const quotationNo = text(input.quotation.quotation_no);
  const optionMatch = quotationNo?.match(/-OPT(\d+)$/i);
  const revisionNo = numberValue(input.quotation.revision_no, 0);
  const optionNo = optionMatch ? Number(optionMatch[1]) : Math.max(numberValue(input.quotation.option_no, 1) - 1, 0);
  const type = revisionNo > 0 ? "Revision" : optionNo > 0 ? "Option" : "Original";
  const sequenceLabel = type === "Revision" ? `R${revisionNo}` : type === "Option" ? `OPT${optionNo}` : null;
  const reference = stringValue(header.reference) ||
    text(input.project?.project_name) ||
    text(input.quotation.legacy_reference) ||
    text(input.quotation.title) ||
    "Quotation reference";
  const contactPhone = stringValue(header.contactPhone) ||
    text(input.client?.phone) ||
    text(input.project?.attention_mobile) ||
    "";
  const telephone = stringValue(header.telephone) ||
    text(input.client?.telephone) ||
    text(input.project?.attention_landline) ||
    "";

  return {
    commercial: {
      currency: stringValue(commercial.currency) || text(input.quotation.currency) || "AED",
      deliveryTerms: stringValue(commercial.deliveryTerms) || text(input.quotation.delivery_terms) || "",
      overallDiscountType: stringValue(commercial.overallDiscountType) || text(input.quotation.overall_discount_type) || "amount",
      overallDiscountValue: numberValue(commercial.overallDiscountValue, numberValue(input.quotation.overall_discount_value, 0)),
      paymentTerms: stringValue(commercial.paymentTerms) || text(input.quotation.payment_terms) || "",
      validity: stringValue(commercial.validity) || text(input.quotation.validity) || "",
      vatPercent: numberValue(commercial.vatPercent, numberValue(input.quotation.vat_percent, 5)),
      warrantyTerms: stringValue(commercial.warrantyTerms) || text(input.quotation.warranty_terms) || "",
    },
    header: {
      clientDisplayName: stringValue(header.clientDisplayName) || text(input.client?.company_name) || "Client",
      clientNo: text(input.client?.client_number),
      contactEmail: stringValue(header.contactEmail) || text(input.project?.attention_email) || "",
      contactName: stringValue(header.contactName) || text(input.project?.attention_to) || "",
      contactPhone,
      folderNo: quotationFolderNumberFromQuotationNumber(quotationNo),
      hasConfirmedProject: Boolean(input.quotation.project_id),
      location: stringValue(header.location) || text(input.project?.location) || "",
      opportunityNo: opportunityNumberFromQuotationNumber(quotationNo),
      poBox: stringValue(header.poBox) || text(input.client?.po_box) || text(input.project?.po_box) || "",
      projectAddress: stringValue(header.projectAddress) || text(input.project?.project_address) || "",
      telephone,
      quotationDate: stringValue(header.quotationDate) || text(input.quotation.quotation_date) || new Date().toISOString().slice(0, 10),
      quotationNo,
      reference,
    },
    notes: {
      clientClosingNote: stringValue(notes.clientClosingNote),
      clientIntroNote: stringValue(notes.clientIntroNote) || text(input.quotation.notes) || "",
      deliveryInstallNote: stringValue(notes.deliveryInstallNote),
      exclusionNote: stringValue(notes.exclusionNote),
      footerNote: stringValue(notes.footerNote),
      internalNote: stringValue(notes.internalNote),
      termsNote: stringValue(notes.termsNote),
    },
    revisionOption: {
      clientFacingNote: stringValue(revisionOption.clientFacingNote),
      internalNote: stringValue(revisionOption.internalNote),
      reason: stringValue(revisionOption.reason),
      sequenceLabel,
      supersedesText: type === "Revision" && quotationNo
        ? `This revision supersedes previous quotation ${quotationNo.replace(/-R\d+$/i, "")}.`
        : type === "Option"
          ? "This option is an alternate scope/brand/material proposal."
          : "Original quotation",
      type,
    },
    visibility,
  };
}

function visibilityValue(value: RecordLike): DocumentVisibilitySettings {
  return {
    quotation: {
      ...defaultDocumentVisibility.quotation,
      ...booleanRecord(recordValue(value.quotation)),
    },
    specification: {
      ...defaultDocumentVisibility.specification,
      ...booleanRecord(recordValue(value.specification)),
    },
    presentation: {
      ...defaultDocumentVisibility.presentation,
      ...booleanRecord(recordValue(value.presentation)),
    },
  };
}

function booleanRecord(value: RecordLike) {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): RecordLike {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function text(value: string | null | undefined) {
  return value?.trim() || null;
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
