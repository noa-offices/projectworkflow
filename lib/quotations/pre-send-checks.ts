/**
 * Pre-send checks for the local quotation builder. PURE and READ-ONLY: it only looks at plain facts the builder already has (the
 * displayed unit price, quantity, discount and the final total) and returns reminders. It never recomputes a price, never blocks an
 * action and never writes anything.
 */
export type PreSendSeverity = "error" | "warning";
export type PreSendTarget = { kind: "row" | "section" | "document"; id?: string };
export type PreSendCheck = { id: string; severity: PreSendSeverity; code: string; message: string; target?: PreSendTarget };

export type PreSendRow = {
  id: string;
  /** The number shown in the S. No. column. */
  rowNumber: number;
  name: string;
  /** product, custom, ... (note, blank, heading and subtotal rows are skipped). */
  itemType: string;
  /** False for optional rows that are not included in the total and for rate-only rows: they are skipped. */
  countsInTotals: boolean;
  qty: number;
  unitPrice: number;
  discountType: string;
  discountValue: number;
  hasImage: boolean;
  hasSpecification: boolean;
};
export type PreSendSection = { id: string; title: string; itemCount: number };
export type PreSendDocument = { clientName: string; contactEmail: string; paymentTerms: string; validity: string; deliveryTerms: string };
export type PreSendInput = {
  rows: readonly PreSendRow[];
  sections: readonly PreSendSection[];
  finalTotal: number;
  /** Omit when the document setup is not known: the document checks are then skipped. */
  document?: PreSendDocument | null;
};

const SKIPPED_TYPES = new Set(["note", "blank", "heading", "subtotal"]);
const blank = (value: string | null | undefined) => !value || !value.trim() || value.trim() === "-";

function rowLabel(row: Pick<PreSendRow, "rowNumber" | "name">) {
  const name = row.name.trim() || "unnamed item";
  return row.rowNumber > 0 ? `Row ${row.rowNumber} (${name})` : `Item (${name})`;
}

export function runPreSendChecks(input: PreSendInput): PreSendCheck[] {
  const errors: PreSendCheck[] = [];
  const warnings: PreSendCheck[] = [];
  const add = (severity: PreSendSeverity, code: string, message: string, target?: PreSendTarget, key = "") => {
    (severity === "error" ? errors : warnings).push({ id: `${code}:${key || target?.id || ""}`, severity, code, message, ...(target ? { target } : {}) });
  };

  for (const row of input.rows) {
    if (SKIPPED_TYPES.has(row.itemType) || !row.countsInTotals) continue;
    const target: PreSendTarget = { kind: "row", id: row.id };
    const label = rowLabel(row);
    if (!(Number(row.unitPrice) > 0)) add("error", "unit_price_missing", `${label}: unit price is 0.`, target);
    if (!(Number(row.qty) > 0)) add("error", "quantity_missing", `${label}: quantity is 0.`, target);
    const discountLimit = row.discountType === "percent" ? 100 : Number(row.unitPrice);
    if (Number(row.discountValue) > 0 && Number(row.unitPrice) > 0 && Number(row.discountValue) > discountLimit) {
      add("error", "discount_too_large", `${label}: the discount is larger than the price.`, target);
    }
    if (row.itemType === "product") {
      if (!row.hasImage) add("warning", "image_missing", `${label}: no proposed item image.`, target);
      if (!row.hasSpecification) add("warning", "specification_empty", `${label}: the specification is empty.`, target);
    }
  }

  if (!(Number(input.finalTotal) > 0)) add("error", "final_total_zero", "The final total is 0.", undefined, "total");

  const doc = input.document;
  if (doc) {
    if (blank(doc.clientName)) add("warning", "client_name_missing", "The client name is missing.", { kind: "document" }, "client-name");
    if (blank(doc.contactEmail)) add("warning", "client_email_missing", "The client email is missing.", { kind: "document" }, "client-email");
    if (blank(doc.paymentTerms)) add("warning", "payment_terms_empty", "Payment terms are empty.", { kind: "document" }, "payment");
    if (blank(doc.validity)) add("warning", "validity_empty", "Validity is empty.", { kind: "document" }, "validity");
    if (blank(doc.deliveryTerms)) add("warning", "delivery_terms_empty", "Delivery terms are empty.", { kind: "document" }, "delivery");
  }

  for (const section of input.sections) {
    if (section.itemCount <= 0) add("warning", "section_empty", `Section "${section.title.trim() || "Untitled"}" has no rows.`, { kind: "section", id: section.id });
  }

  return [...errors, ...warnings];
}
