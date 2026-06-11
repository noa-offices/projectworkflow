export const clientApprovalDraftKey = "clientApprovalDraft";

export type ClientApprovalStatus =
  | "Pending Client Approval"
  | "Sent for Approval"
  | "Client Reviewing"
  | "Approved by Client"
  | "Rejected by Client"
  | "Revision Requested"
  | "Cancelled"
  | "Withdrawn";

export type ClientApprovalDraft = {
  approvalNo: string;
  quotationId: string;
  quotationNo: string;
  folderNo: string;
  opportunityNo: string | null;
  clientId: string;
  clientName: string;
  reference: string;
  projectName: string | null;
  total: number;
  currency: string;
  quotationStatus: string;
  approvalStatus: ClientApprovalStatus;
  createdAt: string;
  createdBy: string;
  cancelledAt?: string | null;
  cancelledReason?: string | null;
  decidedAt?: string | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
  previousApprovalStatus?: ClientApprovalStatus | null;
  confirmedOrder?: ConfirmedOrderRecord | null;
  documentSetupReference?: string | null;
  source: "quotation_layout_settings";
};

export type ConfirmedOrderRecord = {
  orderNo: string;
  approvalNo: string;
  quotationId: string;
  quotationNo: string;
  folderNo: string;
  opportunityNo: string | null;
  clientId: string;
  clientName: string;
  reference: string;
  total: number;
  currency: string;
  status: "Confirmed";
  createdAt: string;
  createdBy: string;
  source: "quotation_layout_settings";
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function confirmedOrderRecordValue(value: unknown): ConfirmedOrderRecord | null {
  const record = recordValue(value);
  if (!record) return null;

  const orderNo = stringValue(record.orderNo);
  const approvalNo = stringValue(record.approvalNo);
  const quotationId = stringValue(record.quotationId);
  const quotationNo = stringValue(record.quotationNo);
  const folderNo = stringValue(record.folderNo);
  const clientId = stringValue(record.clientId);
  const clientName = stringValue(record.clientName);
  const reference = stringValue(record.reference);
  const total = numberValue(record.total);
  const currency = stringValue(record.currency);
  const createdAt = stringValue(record.createdAt);
  const createdBy = stringValue(record.createdBy);

  if (
    !orderNo ||
    !approvalNo ||
    !quotationId ||
    !quotationNo ||
    !folderNo ||
    !clientId ||
    !clientName ||
    !reference ||
    total === null ||
    !currency ||
    !createdAt ||
    !createdBy
  ) {
    return null;
  }

  return {
    orderNo,
    approvalNo,
    quotationId,
    quotationNo,
    folderNo,
    opportunityNo: stringValue(record.opportunityNo),
    clientId,
    clientName,
    reference,
    total,
    currency,
    status: "Confirmed",
    createdAt,
    createdBy,
    source: "quotation_layout_settings",
  };
}

function approvalStatusValue(value: unknown): ClientApprovalStatus {
  if (
    value === "Sent for Approval" ||
    value === "Client Reviewing" ||
    value === "Approved by Client" ||
    value === "Rejected by Client" ||
    value === "Revision Requested" ||
    value === "Cancelled" ||
    value === "Withdrawn"
  ) {
    return value;
  }

  return "Pending Client Approval";
}

export function clientApprovalDraftFromLayoutSettings(layoutSettings: unknown): ClientApprovalDraft | null {
  const settings = recordValue(layoutSettings);
  const draft = recordValue(settings?.[clientApprovalDraftKey]) ?? recordValue(settings?.clientApproval);
  if (!draft) return null;

  const approvalNo = stringValue(draft.approvalNo);
  const quotationId = stringValue(draft.quotationId);
  const quotationNo = stringValue(draft.quotationNo);
  const folderNo = stringValue(draft.folderNo);
  const clientId = stringValue(draft.clientId);
  const clientName = stringValue(draft.clientName);
  const createdAt = stringValue(draft.createdAt);
  const createdBy = stringValue(draft.createdBy);
  const total = numberValue(draft.total);
  const currency = stringValue(draft.currency);
  const quotationStatus = stringValue(draft.quotationStatus);

  if (
    !approvalNo ||
    !quotationId ||
    !quotationNo ||
    !folderNo ||
    !clientId ||
    !clientName ||
    !createdAt ||
    !createdBy ||
    total === null ||
    !currency ||
    !quotationStatus
  ) {
    return null;
  }

  return {
    approvalNo,
    quotationId,
    quotationNo,
    folderNo,
    opportunityNo: stringValue(draft.opportunityNo),
    clientId,
    clientName,
    reference: stringValue(draft.reference) ?? quotationNo,
    projectName: stringValue(draft.projectName),
    total,
    currency,
    quotationStatus,
    approvalStatus: approvalStatusValue(draft.approvalStatus),
    createdAt,
    createdBy,
    cancelledAt: stringValue(draft.cancelledAt),
    cancelledReason: stringValue(draft.cancelledReason),
    decidedAt: stringValue(draft.decidedAt),
    decidedBy: stringValue(draft.decidedBy),
    decisionNote: stringValue(draft.decisionNote),
    previousApprovalStatus: recordValue(draft)?.previousApprovalStatus
      ? approvalStatusValue(recordValue(draft)?.previousApprovalStatus)
      : null,
    confirmedOrder: confirmedOrderRecordValue(draft.confirmedOrder),
    documentSetupReference: stringValue(draft.documentSetupReference),
    source: "quotation_layout_settings",
  };
}

export function mergeClientApprovalDraftIntoLayoutSettings(
  layoutSettings: unknown,
  draft: ClientApprovalDraft,
) {
  return {
    ...(recordValue(layoutSettings) ?? {}),
    [clientApprovalDraftKey]: draft,
  };
}

export function isActiveClientApprovalStatus(status: ClientApprovalStatus) {
  return (
    status === "Pending Client Approval" ||
    status === "Sent for Approval" ||
    status === "Client Reviewing"
  );
}

export function isCancelledClientApprovalStatus(status: ClientApprovalStatus) {
  return status === "Cancelled" || status === "Withdrawn";
}

export function isRecordedClientApprovalDecision(status: ClientApprovalStatus) {
  return (
    status === "Approved by Client" ||
    status === "Rejected by Client" ||
    status === "Revision Requested" ||
    isCancelledClientApprovalStatus(status)
  );
}

export function clientApprovalStatusDisplayLabel(status: ClientApprovalStatus) {
  switch (status) {
    case "Pending Client Approval":
    case "Sent for Approval":
    case "Client Reviewing":
      return "Waiting Client Decision";
    case "Approved by Client":
    case "Rejected by Client":
    case "Revision Requested":
    case "Cancelled":
    case "Withdrawn":
      return status;
  }
}
