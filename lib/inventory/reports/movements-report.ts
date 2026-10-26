import ExcelJS from "exceljs";
import { LOCATION_LABELS } from "../types";
import type { InventoryMovement } from "../types";
import { actionHistoryLabel, movementLinkLabel } from "../movement-form";
import type { MovementReportFilters } from "./params";
import { excelDubaiDate, safeCell } from "./format";
import { DATA_ROW_HEIGHT_PLAIN, DATA_ROW_HEIGHT_WITH_PHOTO, FIRST_DATA_ROW, GREEN, HEADER_ROW, applyFreeze, applyPrintSetup, placePhoto, styleDataRow, writeHeader, writeSkippedNote, writeTitleBlock, type SheetColumn } from "./excel-style";
import { photoKey, type PhotoSet } from "./photos";

export const MOVEMENT_REPORT_LIMIT = 20000;
export const NARROW_RANGE_MESSAGE = "Too many movements for one file. Narrow the date range.";
export class ReportTooLargeError extends Error { constructor() { super(NARROW_RANGE_MESSAGE); this.name = "ReportTooLargeError"; } }

export const MOVEMENT_EXCEL_COLUMNS: SheetColumn[] = [
  { key: "photo", header: "Photo", width: 14, center: true }, { key: "when", header: "Date and time (Dubai time)", width: 20 }, { key: "stock_ref", header: "Stock ref", width: 11 }, { key: "item_name", header: "Item name", width: 30 },
  { key: "brand", header: "Brand", width: 20 }, { key: "action", header: "Action", width: 11 }, { key: "from", header: "From", width: 17 }, { key: "to", header: "To", width: 17 },
  { key: "quantity", header: "Quantity", width: 10, number: true }, { key: "before", header: "Total before", width: 11, number: true }, { key: "after", header: "Total after", width: 11, number: true },
  { key: "note", header: "Note", width: 36 }, { key: "by", header: "Done by", width: 20 }, { key: "linked", header: "Linked request or reservation", width: 24 },
];
export const MOVEMENT_DIVIDERS = ["quantity", "note"];
export const MOVEMENT_HEADERS: string[] = MOVEMENT_EXCEL_COLUMNS.map(column => column.header);
const place = (location: InventoryMovement["from_location"]) => location ? LOCATION_LABELS[location] : "";

/** Plain-values view of one movement, with real numbers and a real date. */
export function movementReportRow(movement: InventoryMovement) {
  return {
    brand: movement.product?.brand_name ?? "", when: excelDubaiDate(movement.created_at), stock_ref: movement.product?.stock_ref ?? "", item_name: movement.product?.item_name ?? "Unknown product",
    action: actionHistoryLabel(movement.action_type), from: place(movement.from_location), to: place(movement.to_location),
    quantity: movement.quantity, before: movement.previous_quantity, after: movement.new_quantity, note: movement.note ?? "", by: movement.actor_display_name ?? "Unknown", linked: movementLinkLabel(movement.linked) ?? "",
  };
}
export function movementFilterLines(filters: MovementReportFilters, names: { product?: string | null } = {}): string[] {
  return [`Dates: ${filters.from} to ${filters.to}`, filters.product ? `Product: ${names.product ?? "Selected product"}` : null, filters.action ? `Action: ${actionHistoryLabel(filters.action)}` : null,
    filters.location ? `Location: ${LOCATION_LABELS[filters.location]}` : null, filters.person ? `Done by: ${filters.person}` : null].filter((line): line is string => !!line);
}
export async function buildMovementsWorkbook(movements: readonly InventoryMovement[], meta: { generatedAt: Date; filterLines: string[] }, photos?: PhotoSet | null): Promise<Buffer> {
  if (movements.length > MOVEMENT_REPORT_LIMIT) throw new ReportTooLargeError();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProjectWorkflow"; workbook.created = meta.generatedAt;
  const sheet = workbook.addWorksheet("Movements");
  const showPhotos = !!photos && photos.buffers.size > 0, height = showPhotos ? DATA_ROW_HEIGHT_WITH_PHOTO : DATA_ROW_HEIGHT_PLAIN;
  sheet.columns = MOVEMENT_EXCEL_COLUMNS.map(column => ({ key: column.key, width: column.width }));
  sheet.getColumn("photo").hidden = !showPhotos;
  writeTitleBlock(sheet, "Movements history", meta);
  writeHeader(sheet, MOVEMENT_EXCEL_COLUMNS, MOVEMENT_DIVIDERS);
  const imageIds = new Map<string, number>(), index = new Map(MOVEMENT_EXCEL_COLUMNS.map((column, position) => [column.key, position + 1]));
  movements.forEach((movement, position) => {
    const rowNumber = FIRST_DATA_ROW + position, excel = sheet.getRow(rowNumber), row = movementReportRow(movement);
    const text: Record<string, string> = { brand: safeCell(row.brand), stock_ref: safeCell(row.stock_ref), item_name: safeCell(row.item_name), action: row.action, from: safeCell(row.from), to: safeCell(row.to), note: safeCell(row.note), by: safeCell(row.by), linked: safeCell(row.linked) };
    for (const [key, value] of Object.entries(text)) if (value !== "") excel.getCell(index.get(key)!).value = value;
    if (row.when) excel.getCell(index.get("when")!).value = row.when; // a real date
    excel.getCell(index.get("quantity")!).value = row.quantity; excel.getCell(index.get("before")!).value = row.before; excel.getCell(index.get("after")!).value = row.after;
    styleDataRow(sheet, rowNumber, MOVEMENT_EXCEL_COLUMNS, MOVEMENT_DIVIDERS, height);
    excel.getCell(index.get("when")!).numFmt = "dd mmm yyyy hh:mm";
    excel.getCell(index.get("stock_ref")!).font = { name: "Calibri", size: 11, bold: true, color: { argb: GREEN } };
    excel.getCell(index.get("item_name")!).font = { name: "Calibri", size: 11, bold: true };
    const key = photoKey(movement.main_image_url), buffer = key ? photos?.buffers.get(key) : undefined;
    if (key && buffer) {
      let id = imageIds.get(key);
      if (id === undefined) { id = workbook.addImage({ buffer: buffer as unknown as ExcelJS.Buffer, extension: "jpeg" }); imageIds.set(key, id); }
      placePhoto(workbook, sheet, id, 1, rowNumber, MOVEMENT_EXCEL_COLUMNS[0].width, height);
    }
  });
  const last = FIRST_DATA_ROW + movements.length - 1;
  writeSkippedNote(sheet, Math.max(last, FIRST_DATA_ROW - 1) + 2, photos?.skipped ?? 0);
  if (movements.length) sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: last, column: MOVEMENT_EXCEL_COLUMNS.length } };
  applyFreeze(sheet, 3);
  applyPrintSetup(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
