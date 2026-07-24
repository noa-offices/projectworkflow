export const projectFileKey = "projectFile";

export type ProjectFileRecord = {
  orderNo: string;
  approvalNo?: string | null;
  quotationId: string;
  quotationNo: string;
  folderNo: string | null;
  opportunityNo: string | null;
  clientId: string;
  clientName: string;
  reference: string;
  total: number;
  vatAmount?: number | null;
  currency: string;
  quotationFolderKey?: string | null;
  status: "Confirmed";
  createdAt: string;
  createdBy: string;
  source: "direct_quotation_status" | "quotation_layout_settings";
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

export function projectFileRecordValue(value: unknown): ProjectFileRecord | null {
  const record = recordValue(value);
  if (!record) return null;

  const orderNo = stringValue(record.orderNo);
  const quotationId = stringValue(record.quotationId);
  const quotationNo = stringValue(record.quotationNo);
  const clientId = stringValue(record.clientId);
  const clientName = stringValue(record.clientName);
  const reference = stringValue(record.reference);
  const total = numberValue(record.total);
  const currency = stringValue(record.currency);
  const createdAt = stringValue(record.createdAt);
  const createdBy = stringValue(record.createdBy);

  if (
    !orderNo ||
    !quotationId ||
    !quotationNo ||
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
    approvalNo: stringValue(record.approvalNo),
    quotationId,
    quotationNo,
    folderNo: stringValue(record.folderNo),
    opportunityNo: stringValue(record.opportunityNo),
    clientId,
    clientName,
    reference,
    total,
    vatAmount: numberValue(record.vatAmount),
    currency,
    quotationFolderKey: stringValue(record.quotationFolderKey),
    status: "Confirmed",
    createdAt,
    createdBy,
    source: record.source === "quotation_layout_settings" ? "quotation_layout_settings" : "direct_quotation_status",
  };
}

export function projectFileFromLayoutSettings(layoutSettings: unknown) {
  const settings = recordValue(layoutSettings);
  return projectFileRecordValue(settings?.[projectFileKey]);
}

export function mergeProjectFileIntoLayoutSettings(
  layoutSettings: unknown,
  projectFile: ProjectFileRecord,
) {
  return {
    ...(recordValue(layoutSettings) ?? {}),
    [projectFileKey]: projectFile,
  };
}
