import { quotationFolderNumberFromQuotationNumber } from "../projectworkflow-numbering";
import { projectFileFromLayoutSettings } from "../quotations/project-file";
import { variationLinkFromLayoutSettings } from "../quotations/project-variation";
import { projectContractForQuotation, projectContractValue, type ProjectContractStates } from "./project-contract-total";

export type DealQuotation = {
  id: string;
  quotation_no?: string | null;
  project_id?: string | null;
  revision_no?: number | null;
  created_at?: string | null;
  grand_total?: number | null;
  layout_settings?: unknown;
};
export type FolderDeal<T extends DealQuotation> = { row: T; folderKey: string; value: number; hasProject: boolean };

/** The same folder identity the dashboard's "Counts each quotation folder once" uses. */
export function quotationFolderKey(row: Pick<DealQuotation, "id" | "quotation_no" | "project_id">) {
  return quotationFolderNumberFromQuotationNumber(row.quotation_no) ?? (row.project_id ? `project:${row.project_id}` : `legacy:${row.id}`);
}

const newest = (a: DealQuotation, b: DealQuotation) =>
  (b.revision_no ?? 0) - (a.revision_no ?? 0) || Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "") || 0;

/**
 * ONE deal per quotation folder. Variations never count. A folder with a Project File is one deal worth the Project's current
 * contract total (its own quotation: the one holding the Project File). A folder without one is its latest revision at its own grand total.
 * Pass client-confirmed rows only. Result order follows the first appearance of each folder.
 */
export function oneDealPerFolder<T extends DealQuotation>(rows: readonly T[], states: ProjectContractStates): Array<FolderDeal<T>> {
  const folders = new Map<string, T[]>();
  for (const row of rows) {
    if (variationLinkFromLayoutSettings(row.layout_settings)) continue;
    const key = quotationFolderKey(row);
    folders.set(key, [...(folders.get(key) ?? []), row]);
  }
  return [...folders].map(([folderKey, members]) => {
    const withProject = members.filter((row) => projectContractForQuotation(row, new Map()) !== null)
      .sort((a, b) => Number(Boolean(projectFileFromLayoutSettings(b.layout_settings))) - Number(Boolean(projectFileFromLayoutSettings(a.layout_settings))) || newest(a, b));
    const row = withProject[0] ?? [...members].sort(newest)[0];
    return { row, folderKey, value: projectContractValue(row, states), hasProject: withProject.length > 0 };
  });
}
