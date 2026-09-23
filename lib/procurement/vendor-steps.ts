// Server-safe mirror of the procurement vendor controls panel's step/document-slot constants
// (that component is a client component, so it can't be imported from server-only NOA code).
// Keep this in sync with that component by hand if the procurement workflow steps or document
// slots ever change - there is deliberately no shared import between them since one is
// client-only UI and the other must stay server-only and alias-light.

export type VendorStepInfo = { key: string; label: string };

export const VENDOR_STEP_LABELS: readonly VendorStepInfo[] = [
  { key: "rfq", label: "RFQ" },
  { key: "po_issued", label: "PO Issued" },
  { key: "deposit_paid", label: "Deposit Paid" },
  { key: "in_production", label: "In Production" },
  { key: "quality_check", label: "Quality Check" },
  { key: "ready_for_shipment", label: "Ready for Shipment" },
  { key: "in_transit", label: "In Transit" },
  { key: "delivered_installed", label: "Delivered & Installed" },
];

// Clamps out-of-range active_step values (the column has no CHECK constraint) instead of throwing
// or returning undefined, so a bad/legacy row still produces a safe label.
export function vendorStepLabel(activeStep: number): string {
  const clamped = Math.max(0, Math.min(activeStep, VENDOR_STEP_LABELS.length - 1));
  return VENDOR_STEP_LABELS[clamped].label;
}

const DOC_SLOT_LABELS: Readonly<Record<string, string>> = {
  bl: "Shipping / Packing List (BL)",
  oc: "Factory Confirmation (OC)",
  pi: "Proforma Invoice (PI)",
};

export function vendorDocSlotLabel(slotKey: string): string {
  return DOC_SLOT_LABELS[slotKey] ?? slotKey;
}
