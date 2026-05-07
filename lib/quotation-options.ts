function positiveInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 1;
}

export function quotationRevisionBaseNo(quotationNo: string | null | undefined) {
  return quotationNo?.trim().replace(/(?:-R\d+)+$/i, "") || null;
}

export function quotationRootBaseNo(quotationNo: string | null | undefined) {
  const revisionBase = quotationRevisionBaseNo(quotationNo);

  if (!revisionBase) return null;

  return revisionBase.replace(/\s+Option\s+\d+$/i, "").trim() || null;
}

export function quotationOptionNoFromQuotationNo(quotationNo: string | null | undefined) {
  const revisionBase = quotationRevisionBaseNo(quotationNo);

  if (!revisionBase) return null;

  const match = revisionBase.match(/\s+Option\s+(\d+)$/i);
  if (!match) return 1;

  const optionNo = Number.parseInt(match[1], 10);
  return Number.isFinite(optionNo) && optionNo > 0 ? optionNo : 1;
}

export function quotationOptionLabel(optionNo: number | null | undefined) {
  return `Option ${positiveInteger(optionNo)}`;
}

export function formatQuotationDisplayNo({
  optionNo,
  quotationNo,
  showOptionNumber = false,
}: {
  optionNo: number | null | undefined;
  quotationNo: string | null | undefined;
  showOptionNumber?: boolean;
}) {
  const revisionBase = quotationRevisionBaseNo(quotationNo);
  if (!revisionBase) return null;

  const baseNo = quotationRootBaseNo(revisionBase) ?? revisionBase;
  const normalizedOptionNo = positiveInteger(optionNo ?? quotationOptionNoFromQuotationNo(revisionBase) ?? 1);

  if (showOptionNumber || normalizedOptionNo > 1) {
    return `${baseNo} ${quotationOptionLabel(normalizedOptionNo)}`;
  }

  return baseNo;
}
