import ExcelJS from "exceljs";
import { LOCATION_LABELS } from "../types";
import type { InventoryMovement } from "../types";
import { actionHistoryLabel, movementLinkLabel } from "../movement-form";
import type { MovementReportFilters } from "./params";
import { excelDubaiDate, safeCell } from "./format";

export const MOVEMENT_REPORT_LIMIT = 20000;
export const NARROW_RANGE_MESSAGE = "Too many movements for one file. Narrow the date range.";
export class ReportTooLargeError extends Error { constructor() { super(NARROW_RANGE_MESSAGE); this.name = "ReportTooLargeError"; } }

export const MOVEMENT_COLUMNS_SPEC = [
  { key: "when", header: "Date and time (Dubai time)", width: 20 }, { key: "stock_ref", header: "Stock ref", width: 12 }, { key: "item_name", header: "Item name", width: 34 },
  { key: "action", header: "Action", width: 11 }, { key: "from", header: "From", width: 18 }, { key: "to", header: "To", width: 18 },
  { key: "quantity", header: "Quantity", width: 10 }, { key: "before", header: "Total before", width: 12 }, { key: "after", header: "Total after", width: 12 },
  { key: "note", header: "Note", width: 40 }, { key: "by", header: "Done by", width: 22 }, { key: "linked", header: "Linked request or reservation", width: 26 },
] as const;
export const MOVEMENT_HEADERS: string[] = MOVEMENT_COLUMNS_SPEC.map(column => column.header);
const place = (location: InventoryMovement["from_location"]) => location ? LOCATION_LABELS[location] : "";

/** Plain-values view of one movement, with real numbers and a real date. */
export function movementReportRow(movement: InventoryMovement) {
  return {
    when: excelDubaiDate(movement.created_at), stock_ref: movement.product?.stock_ref ?? "", item_name: movement.product?.item_name ?? "Unknown product",
    action: actionHistoryLabel(movement.action_type), from: place(movement.from_location), to: place(movement.to_location),
    quantity: movement.quantity, before: movement.previous_quantity, after: movement.new_quantity, note: movement.note ?? "", by: movement.actor_display_name ?? "Unknown", linked: movementLinkLabel(movement.linked) ?? "",
  };
}
export function movementFilterLines(filters: MovementReportFilters, names: { product?: string | null } = {}): string[] {
  return [`Dates: ${filters.from} to ${filters.to}`, filters.product ? `Product: ${names.product ?? "Selected product"}` : null, filters.action ? `Action: ${actionHistoryLabel(filters.action)}` : null,
    filters.location ? `Location: ${LOCATION_LABELS[filters.location]}` : null, filters.person ? `Done by: ${filters.person}` : null].filter((line): line is string => !!line);
}
export async function buildMovementsWorkbook(movements: readonly InventoryMovement[], meta: { generatedAt: Date; filterLines: string[] }): Promise<Buffer> {
  if (movements.length > MOVEMENT_REPORT_LIMIT) throw new ReportTooLargeError();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProjectWorkflow"; workbook.created = meta.generatedAt;
  const sheet = workbook.addWorksheet("Movements", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = MOVEMENT_COLUMNS_SPEC.map(column => ({ header: column.header, key: column.key, width: column.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true }; header.alignment = { vertical: "middle", wrapText: true }; header.height = 32;
  header.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F1EA" } }; cell.border = { bottom: { style: "thin", color: { argb: "FF166534" } } }; });
  for (const movement of movements) {
    const row = movementReportRow(movement);
    sheet.addRow({ ...row, stock_ref: safeCell(row.stock_ref), item_name: safeCell(row.item_name), from: safeCell(row.from), to: safeCell(row.to), note: safeCell(row.note), by: safeCell(row.by), linked: safeCell(row.linked) });
  }
  sheet.getColumn("when").numFmt = "dd mmm yyyy hh:mm";
  for (const key of ["quantity", "before", "after"] as const) sheet.getColumn(key).numFmt = "#,##0";
  sheet.getColumn("note").alignment = { wrapText: true, vertical: "top" };
  sheet.getColumn("item_name").alignment = { wrapText: true, vertical: "top" };
  if (movements.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: movements.length + 1, column: MOVEMENT_COLUMNS_SPEC.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
