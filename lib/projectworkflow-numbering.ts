export type QuotationNumberVariant = {
  type?: "original" | "revision" | "option";
  sequence?: number;
};

export function padSequence(value: number, length = 4): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return String(safeValue).padStart(length, "0");
}

export function formatClientNumber(clientSequence: number): string {
  return `CL-${padSequence(clientSequence, 4)}`;
}

export function formatOpportunityNumber(clientSequence: number, opportunitySequence: number): string {
  return `OP-${padSequence(clientSequence, 4)}-${padSequence(opportunitySequence, 3)}`;
}

export function formatQuotationFolderNumber(clientSequence: number, opportunitySequence: number): string {
  return `QF-${padSequence(clientSequence, 4)}-${padSequence(opportunitySequence, 3)}`;
}

export function formatQuotationNumber(
  clientSequence: number,
  opportunitySequence: number,
  variant: QuotationNumberVariant = { type: "original" },
): string {
  const base = `QN-${padSequence(clientSequence, 4)}-${padSequence(opportunitySequence, 3)}`;
  const sequence = Number.isFinite(variant.sequence) ? Math.max(1, Math.trunc(variant.sequence ?? 1)) : 1;

  if (variant.type === "revision") {
    return `${base}-R${sequence}`;
  }

  if (variant.type === "option") {
    return `${base}-OPT${sequence}`;
  }

  return base;
}

export function formatSpecificationNumber(quotationNo: string): string {
  return `SP-${quotationNo.trim()}`;
}

export function formatPresentationNumber(quotationNo: string): string {
  return `PR-${quotationNo.trim()}`;
}

export function formatClientApprovalNumber(clientSequence: number, opportunitySequence: number): string {
  return `CP-${padSequence(clientSequence, 4)}-${padSequence(opportunitySequence, 3)}`;
}

export function formatConfirmedOrderNumber(clientSequence: number, opportunitySequence: number): string {
  return `CO-${padSequence(clientSequence, 4)}-${padSequence(opportunitySequence, 3)}`;
}

export function formatSupplierRfqNumber(confirmedOrderNo: string, supplierSequence: number): string {
  return `RFQ-${confirmedOrderNo.trim()}-S${padSequence(supplierSequence, 2)}`;
}

export function formatPurchaseOrderNumber(confirmedOrderNo: string, supplierSequence: number): string {
  return `PO-${confirmedOrderNo.trim()}-S${padSequence(supplierSequence, 2)}`;
}

export function formatOrderConfirmationNumber(confirmedOrderNo: string): string {
  return `OC-${confirmedOrderNo.trim()}`;
}

export function clientSequenceFromNumber(clientNo: string | null | undefined): number | null {
  const trimmed = clientNo?.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(?:CL-)?(\d+)$/i);
  if (!match) return null;

  const sequence = Number(match[1]);
  return Number.isFinite(sequence) && sequence > 0 ? Math.trunc(sequence) : null;
}

export function opportunitySequenceFromNumber(opportunityNo: string | null | undefined): number | null {
  const match = opportunityNo?.trim().match(/^OP-\d{4}-(\d{3})$/i);
  if (!match) return null;

  const sequence = Number(match[1]);
  return Number.isFinite(sequence) && sequence > 0 ? Math.trunc(sequence) : null;
}

export function opportunityNumberFromQuotationNumber(quotationNo: string | null | undefined): string | null {
  const match = quotationNo?.trim().match(/^QN-(\d{4})-(\d{3})(?:-(?:R\d+|OPT\d+))*$/i);
  if (!match) return null;

  return formatOpportunityNumber(Number(match[1]), Number(match[2]));
}

export function quotationFolderNumberFromQuotationNumber(quotationNo: string | null | undefined): string | null {
  const match = quotationNo?.trim().match(/^QN-(\d{4})-(\d{3})(?:-(?:R\d+|OPT\d+))*$/i);
  if (!match) return null;

  return `QF-${match[1]}-${match[2]}`;
}
