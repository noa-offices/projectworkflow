import { clientApprovalDraftFromLayoutSettings } from "./client-approval-draft";
import { projectFileFromLayoutSettings } from "./project-file";
import { newEnquiryCopyLayoutSettings } from "./quotation-layout-copy";
import { unlockedQuotationCopyLayoutSettings } from "./quotation-lock";
import { quotationRootBaseNo } from "../quotation-options";

// Step C1 of variations: after a Project File exists, a change to the job is a variation inside the same Project, not a new revision.
// A variation is a quotation row numbered <folder quotation number>-V<n>, linked through layout_settings.variationOf. Applying one to the Project is Step C2.

export type VariationLink = { orderNo: string; projectQuotationId: string; snapshotId: string; variationNo: number; baseRevisionNo: number };

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function formatVariationNumber(baseQuotationNo: string, variationNo: number) {
  return `${baseQuotationNo.trim()}-V${Math.max(1, Math.trunc(variationNo))}`;
}

/** The n of a variation number. Only as the last part of a QN number: "-V" elsewhere, such as in an older reference, is not a variation. */
export function variationNoFromQuotationNo(quotationNo: string | null | undefined) {
  const match = quotationNo?.trim().match(/^QN-\d{4}-\d{3}-V(\d+)$/i);
  const value = match ? Number(match[1]) : 0;
  return value > 0 ? value : null;
}

export function variationLinkFromLayoutSettings(layoutSettings: unknown): VariationLink | null {
  const link = record(record(layoutSettings)?.variationOf);
  if (!link) return null;
  const { orderNo, projectQuotationId, snapshotId, variationNo, baseRevisionNo } = link;
  if (typeof orderNo !== "string" || !orderNo.trim() || typeof projectQuotationId !== "string" || typeof snapshotId !== "string") return null;
  if (typeof variationNo !== "number" || variationNo < 1 || typeof baseRevisionNo !== "number" || baseRevisionNo < 0) return null;
  return { orderNo, projectQuotationId, snapshotId, variationNo, baseRevisionNo };
}

/** "R5 · V2": base revision R5, variation 2. */
export function variationLabel(link: Pick<VariationLink, "baseRevisionNo" | "variationNo">) {
  return `R${link.baseRevisionNo} · V${link.variationNo}`;
}
export function variationLine(link: VariationLink) {
  return `Variation V${link.variationNo} to Project ${link.orderNo} (based on R${link.baseRevisionNo})`;
}

export type FolderQuotationRow = { id: string; quotation_no: string | null; layout_settings?: unknown };

/** Folder root number -> the Project number of the folder, from every row that holds one. Build it once for a list, then look each row up. */
export function folderProjectOrderNos(rows: FolderQuotationRow[]) {
  const orders = new Map<string, string>();
  for (const row of rows) {
    const root = quotationRootBaseNo(row.quotation_no)?.toUpperCase();
    if (!root || orders.has(root)) continue;
    const order = projectFileFromLayoutSettings(row.layout_settings) ?? clientApprovalDraftFromLayoutSettings(row.layout_settings)?.confirmedOrder ?? null;
    if (order?.orderNo) orders.set(root, order.orderNo);
  }
  return orders;
}

export function folderProjectOrderNoFrom(orders: Map<string, string>, quotationNo: string | null | undefined) {
  const root = quotationRootBaseNo(quotationNo)?.toUpperCase();
  return root ? orders.get(root) ?? null : null;
}

/** The Project of a quotation's folder, whichever row of the folder holds it. */
export function folderProjectOrderNo(rows: FolderQuotationRow[], quotationNo: string | null | undefined) {
  return folderProjectOrderNoFrom(folderProjectOrderNos(rows), quotationNo);
}

/** Why this quotation cannot have a new revision, or null. R numbers are only for quotations before approval. */
export function revisionRefusal(quotation: { layout_settings: unknown }, folderOrderNo: string | null) {
  const orderNo = folderOrderNo ?? projectFileFromLayoutSettings(quotation.layout_settings)?.orderNo;
  return orderNo ? `This folder already has Project ${orderNo}. Use Create variation from the Project to change it.` : null;
}

export type ProjectFileCardState =
  | { kind: "before_project" }
  | { kind: "open_project"; orderNo: string }
  | { kind: "variation_open"; orderNo: string; message: string }
  | { kind: "variation_confirmed"; orderNo: string; message: string }
  | { kind: "folder_has_project"; orderNo: string; message: string };

/** The Project File card. "before_project" is the only state that can offer Create Project File. */
export function projectFileCardState(input: { id: string; status: string; layoutSettings: unknown; folderOrderNo: string | null }): ProjectFileCardState {
  const link = variationLinkFromLayoutSettings(input.layoutSettings);
  if (link) {
    return input.status === "client_confirmed"
      ? { kind: "variation_confirmed", orderNo: link.orderNo, message: `Variation V${link.variationNo} is confirmed. Updating the Project comes in the next step.` }
      : { kind: "variation_open", orderNo: link.orderNo, message: `${variationLine(link)}.` };
  }
  const own = projectFileFromLayoutSettings(input.layoutSettings) ?? clientApprovalDraftFromLayoutSettings(input.layoutSettings)?.confirmedOrder ?? null;
  // A revision made before Step A can carry its source's Project File, so the record must name this row.
  if (own?.orderNo && own.quotationId === input.id) return { kind: "open_project", orderNo: own.orderNo };
  const orderNo = input.folderOrderNo ?? own?.orderNo ?? null;
  return orderNo
    ? { kind: "folder_has_project", orderNo, message: `This folder already has Project ${orderNo}. Use Create variation from the Project to change it.` }
    : { kind: "before_project" };
}

export const noSnapshotMessage = "This Project has no frozen copy yet, so a variation cannot be created.";
export const oneOpenVariationMessage = (no: number) => `Variation V${no} is still open for this Project. Finish it before creating another.`;
export const applyInNextStepMessage = "Applying variations comes in the next step.";

export type ExistingVariation = { quotation_no: string | null; status: string; is_active: boolean };

/** Open: not yet Client Confirmed, not rejected or cancelled, not archived. */
export function isOpenVariation(variation: ExistingVariation) {
  return variation.is_active && !["client_confirmed", "cancelled", "archived"].includes(variation.status);
}

/** The next variation number, or why there cannot be one. */
export function variationCreationDecision(existing: ExistingVariation[]): { ok: true; variationNo: number } | { ok: false; message: string } {
  const numbered = existing.flatMap((variation) => {
    const no = variationNoFromQuotationNo(variation.quotation_no);
    return no ? [{ ...variation, no }] : [];
  });
  const open = numbered.find(isOpenVariation);
  if (open) return { ok: false, message: oneOpenVariationMessage(open.no) };
  // Until Step C2 a confirmed variation cannot reach the Project, so a later one would be built on a scope that is out of date.
  if (numbered.some((variation) => variation.is_active && variation.status === "client_confirmed")) return { ok: false, message: applyInNextStepMessage };
  return { ok: true, variationNo: Math.max(0, ...numbered.map((variation) => variation.no)) + 1 };
}

// The row's own identity and history, set fresh on the new row. Everything else in the full-row copy goes across.
const SECTION_FRESH = ["id", "quotation_id", "parent_section_id", "is_active", "created_by", "created_at", "updated_at"];
const ITEM_FRESH = ["id", "quotation_id", "section_id", "parent_item_id", "is_active", "created_by", "created_at", "updated_at"];
const without = (data: unknown, keys: string[]) => Object.fromEntries(Object.entries(record(data) ?? {}).filter(([key]) => !keys.includes(key)));

export type SnapshotSectionRow = { original_section_id: string; data: unknown };
export type SnapshotItemRow = { original_item_id: string; data: unknown };

/** New rows from the frozen copy, never from live data. Ids are made here so parents, sections and layout references can all be mapped at once. */
export function variationRowsFromSnapshot(input: { quotationId: string; userId: string; sections: SnapshotSectionRow[]; items: SnapshotItemRow[]; newId: () => string }) {
  const idMap = new Map<string, string>();
  for (const row of input.sections) idMap.set(row.original_section_id, input.newId());
  for (const row of input.items) idMap.set(row.original_item_id, input.newId());
  const mapped = (value: unknown) => typeof value === "string" ? idMap.get(value) ?? null : null;
  const fresh = { quotation_id: input.quotationId, is_active: true, created_by: input.userId };
  return {
    idMap,
    sections: input.sections.map((row) => ({ ...without(row.data, SECTION_FRESH), ...fresh, id: idMap.get(row.original_section_id)!, parent_section_id: mapped(record(row.data)?.parent_section_id) })),
    items: input.items.map((row) => ({ ...without(row.data, ITEM_FRESH), ...fresh, id: idMap.get(row.original_item_id)!, section_id: mapped(record(row.data)?.section_id), parent_item_id: mapped(record(row.data)?.parent_item_id) })),
  };
}

function remapIds(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => remapIds(entry, idMap));
  const object = record(value);
  return object ? Object.fromEntries(Object.entries(object).map(([key, entry]) => [idMap.get(key) ?? key, remapIds(entry, idMap)])) : value;
}

/** The Project's frozen settings without its Project File and approval data, so the variation is unlocked, with row references moved to the new rows. The pricing rule stays. */
export function variationLayoutSettings(snapshotLayoutSettings: unknown, link: VariationLink, idMap: Map<string, string>) {
  const clean = unlockedQuotationCopyLayoutSettings(newEnquiryCopyLayoutSettings(snapshotLayoutSettings));
  return { ...(remapIds(clean, idMap) as Record<string, unknown>), variationOf: link };
}

/** A copy of a variation to another folder or a new enquiry is an ordinary quotation. */
export function withoutVariationLink(layoutSettings: unknown) {
  const settings = record(layoutSettings);
  if (!settings || !("variationOf" in settings)) return layoutSettings;
  const { variationOf: _link, ...rest } = settings;
  void _link;
  return rest;
}
