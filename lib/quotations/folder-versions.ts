import { formatRuleMoney, readPricingRule } from "../quotation-pricing";
import { quotationStatusBadgeClassName, quotationStatusLabel } from "../quotation-status";
import { quotationApprovalDisplay } from "./approval-display";
import { projectFileFromLayoutSettings } from "./project-file";
import { variationAppliedFromLayoutSettings } from "./quotation-lock";
import { variationLabel, variationLinkFromLayoutSettings } from "./project-variation";

export type FolderVersionSource = {
  id: string;
  quotation_no: string | null;
  quotation_date: string;
  status: string;
  status_updated_at?: string | null;
  currency: string;
  grand_total: number;
  approved_salesperson_id: string | null;
  layout_settings: unknown;
};
export type FolderVersionRow = {
  id: string;
  quotationNo: string;
  /** e.g. "Variation R0 · V1"; null when not a variation. */
  variationTag: string | null;
  isProjectQuotation: boolean;
  isCurrent: boolean;
  statusLabel: string;
  statusClassName: string;
  total: string;
  updatedAt: string;
  /** e.g. "Applied to Project CO-0002-001". */
  appliedTo: string | null;
  archived: boolean;
};

/** Rows for the locked view's "Folder versions" list. `active` and `archived` come, already sorted, from the full quotation page's folder list. */
export function buildFolderVersionRows(active: readonly FolderVersionSource[], archived: readonly FolderVersionSource[], currentId: string, folderOrderNo: string | null): FolderVersionRow[] {
  const toRow = (entry: FolderVersionSource, isArchived: boolean): FolderVersionRow => {
    const link = variationLinkFromLayoutSettings(entry.layout_settings);
    const applied = variationAppliedFromLayoutSettings(entry.layout_settings);
    const display = quotationApprovalDisplay(entry, folderOrderNo);
    return {
      id: entry.id,
      quotationNo: entry.quotation_no ?? "Older quotation",
      variationTag: link ? `Variation ${variationLabel(link)}` : null,
      isProjectQuotation: projectFileFromLayoutSettings(entry.layout_settings) !== null,
      isCurrent: entry.id === currentId,
      statusLabel: display?.label ?? quotationStatusLabel(entry.status),
      statusClassName: display?.badgeClassName ?? quotationStatusBadgeClassName(entry.status),
      total: formatRuleMoney(readPricingRule(entry.layout_settings), entry.currency, entry.grand_total),
      updatedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(entry.status_updated_at ?? entry.quotation_date)),
      appliedTo: applied ? `Applied to Project ${applied.orderNo}` : null,
      archived: isArchived,
    };
  };
  return [...active.map((entry) => toRow(entry, false)), ...archived.map((entry) => toRow(entry, true))];
}
