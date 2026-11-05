import { quotationFolderNumberFromQuotationNumber } from "../projectworkflow-numbering";
import { clientApprovalDraftFromLayoutSettings } from "../quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "../quotations/project-file";
import { projectContractForQuotation, projectContractValue, type ProjectContractStates } from "./project-contract-total";

export type ProjectWiseQuotation = {
  id: string;
  quotation_no: string | null;
  approved_salesperson_id: string | null;
  layout_settings: unknown;
  grand_total?: number | null;
};
export type ProjectWiseRow = {
  quotationId: string;
  projectNo: string;
  folder: string;
  client: string;
  reference: string;
  salespersonId: string | null;
  quoted: number;
  originalContract: number;
  /** Current minus original; null when no variation is applied. */
  variations: number | null;
  currentContract: number;
  approvedDate: string;
  status: "Active" | "Completed" | "Cancelled";
};

/**
 * One row per approved Project folder (pass the folder-deduplicated approved quotations), newest approval first.
 * currentContract is projectContractValue, the same figure the "Client approved value" card sums, so the two always reconcile.
 */
export function projectWiseApprovedRows(
  approved: readonly ProjectWiseQuotation[],
  quotedTotalByFolder: ReadonlyMap<string, number>,
  folderKeyOf: (quotation: ProjectWiseQuotation) => string,
  states: ProjectContractStates,
): ProjectWiseRow[] {
  return approved.flatMap((quotation) => {
    const order = projectFileFromLayoutSettings(quotation.layout_settings) ?? clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder;
    const contract = projectContractForQuotation(quotation, states);
    if (!order || !contract) return [];
    const settings = (quotation.layout_settings ?? {}) as Record<string, unknown>;
    const folderKey = folderKeyOf(quotation);
    return [{
      quotationId: quotation.id,
      projectNo: order.orderNo,
      folder: quotationFolderNumberFromQuotationNumber(quotation.quotation_no) ?? folderKey,
      client: order.clientName,
      reference: order.reference,
      salespersonId: quotation.approved_salesperson_id,
      quoted: quotedTotalByFolder.get(folderKey) ?? quotation.grand_total ?? 0,
      originalContract: contract.originalTotal,
      variations: contract.appliedVariationNo ? contract.variationDelta : null,
      currentContract: projectContractValue(quotation, states),
      approvedDate: order.createdAt,
      status: typeof settings.projectCancelledAt === "string" ? "Cancelled" : typeof settings.projectCompletedAt === "string" ? "Completed" : "Active",
    } satisfies ProjectWiseRow];
  }).sort((a, b) => Date.parse(b.approvedDate) - Date.parse(a.approvedDate));
}
