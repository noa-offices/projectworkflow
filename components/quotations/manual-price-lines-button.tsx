"use client";

import type { SupplierFamilyStatusPresentation } from "@/lib/products/supplier-family-status";
import { ManualPriceLinesAction } from "./manual-price-lines-popup";
import { useCoverageAccess } from "./supplier-coverage-popup";

/** "Update prices" next to the badge of a manual Brand's product. Approvers can type and save; everyone else sees the table read only. */
export function ManualPriceLinesButton({ templateId, templateName, onSupplierStatus }: { templateId: string; templateName: string; onSupplierStatus?: (templateId: string, presentation: SupplierFamilyStatusPresentation | null) => void }) {
  const allowed = useCoverageAccess();
  if (allowed === null) return null;
  return <ManualPriceLinesAction templateId={templateId} templateName={templateName} canEdit={allowed === true} onSupplierStatus={onSupplierStatus} />;
}
