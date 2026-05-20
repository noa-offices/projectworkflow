function positiveInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 1;
}

export function quotationOptionCode(optionNo: number | null | undefined) {
  let value = positiveInteger(optionNo) - 1;

  if (value < 1) {
    return null;
  }

  let result = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }

  return result;
}

export function quotationRevisionBaseNo(quotationNo: string | null | undefined) {
  return quotationNo?.trim().replace(/-R\d+$/i, "") || null;
}

export function quotationRootBaseNo(quotationNo: string | null | undefined) {
  const revisionBase = quotationRevisionBaseNo(quotationNo);

  if (!revisionBase) return null;

  return revisionBase.replace(/-OPT-[A-Z]+$/i, "").trim() || null;
}

export function quotationOptionNoFromQuotationNo(quotationNo: string | null | undefined) {
  const revisionBase = quotationRevisionBaseNo(quotationNo);

  if (!revisionBase) return null;

  const match = revisionBase.match(/-OPT-([A-Z]+)$/i);

  if (!match) return 1;

  const code = match[1].toUpperCase();
  let value = 0;

  for (const character of code) {
    value = value * 26 + (character.charCodeAt(0) - 64);
  }

  return value + 1;
}

export function quotationOptionLabel(optionNo: number | null | undefined) {
  const code = quotationOptionCode(optionNo);
  return code ? `Option ${code}` : "Base";
}

export function formatQuotationDisplayNo({
  quotationNo,
}: {
  optionNo?: number | null | undefined;
  quotationNo: string | null | undefined;
  showOptionNumber?: boolean;
}) {
  return quotationNo?.trim() || null;
}

export function buildQuotationDocumentNumber({
  projectNumber,
  optionNo,
  revisionNo,
}: {
  projectNumber: string | null | undefined;
  optionNo?: number | null | undefined;
  revisionNo?: number | null | undefined;
}) {
  const base = projectNumber?.trim();

  if (!base) {
    return null;
  }

  const normalizedOptionNo = positiveInteger(optionNo ?? 1);
  const normalizedRevisionNo =
    typeof revisionNo === "number" && Number.isFinite(revisionNo) && revisionNo > 0
      ? Math.trunc(revisionNo)
      : 0;
  const optionCode = quotationOptionCode(normalizedOptionNo);
  const optionSuffix = optionCode ? `-OPT-${optionCode}` : "";
  const revisionSuffix = normalizedRevisionNo > 0
    ? `-R${String(normalizedRevisionNo).padStart(2, "0")}`
    : "";

  return `${base}${optionSuffix}${revisionSuffix}`;
}
