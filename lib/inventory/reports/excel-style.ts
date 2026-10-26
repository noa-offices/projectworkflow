import type ExcelJS from "exceljs";
import { formatDubaiDateTime } from "./format";
import { inventoryIdentifier } from '../presentation';

/** Shared look for the Inventory Excel reports: dark green header, light grey grid, medium green dividers. */
export const GREEN = "FF064E3B", GREEN_LINE = "FF6EE7B7", GREY_TEXT = "FF6B7280", GRID = "FFD1D5DB", TINT = "FFF4F8F6", TOTAL_FILL = "FFD1FAE5", AMBER = "FFB45309", AMBER_FILL = "FFFEF3C7";
export const DASH_FORMAT = '0;-0;"–"';
export const HEADER_ROW = 5, FIRST_DATA_ROW = 6;
export const PHOTO_SIZE = { width: 88, height: 66 } as const; // px, 4:3
export const DATA_ROW_HEIGHT_WITH_PHOTO = 66, DATA_ROW_HEIGHT_PLAIN = 36, HEADER_HEIGHT = 38;
/** Leave room for both the name and identifying line, including long optional details. */
export function inventoryReportRowHeight(item: {item_name:string;stock_ref?:string|null;item_code?:string|null;model_name?:string|null}, minimum: number): number {
  const lines = Math.ceil(item.item_name.length / 28) + Math.ceil(inventoryIdentifier(item).length / 28);
  return Math.max(minimum,lines * 16);
}
const EMU_PER_PX = 9525, PX_PER_CHAR = 7, PX_PER_POINT = 96 / 72;

const side = (style: ExcelJS.BorderStyle, color: string): Partial<ExcelJS.Border> => ({ style, color: { argb: color } });
export const gridBorder = (): Partial<ExcelJS.Borders> => ({ top: side("thin", GRID), bottom: side("thin", GRID), left: side("thin", GRID), right: side("thin", GRID) });

export type SheetColumn = { key: string; header: string; width: number; number?: boolean; center?: boolean };

/** Rows 1 to 3: title, who made it, and when and with which filters. */
export function writeTitleBlock(sheet: ExcelJS.Worksheet, title: string, meta: { generatedAt: Date; filterLines: string[] }) {
  sheet.getCell("A1").value = title; sheet.getCell("A1").font = { name: "Calibri", size: 18, bold: true, color: { argb: GREEN } };
  sheet.getCell("A2").value = "NOA Offices · ProjectWorkflow Inventory"; sheet.getCell("A2").font = { name: "Calibri", size: 10, color: { argb: GREY_TEXT } };
  sheet.getCell("A3").value = `Made on ${formatDubaiDateTime(meta.generatedAt)} (Dubai time) · Filters: ${meta.filterLines.join(" · ") || "none"}`;
  sheet.getCell("A3").font = { name: "Calibri", size: 10, color: { argb: GREY_TEXT } };
  sheet.getRow(1).height = 28;
  for (const row of [1, 2, 3]) sheet.getCell(`A${row}`).alignment = { vertical: "middle", wrapText: false };
}
export function writeHeader(sheet: ExcelJS.Worksheet, columns: SheetColumn[], dividerKeys: string[]) {
  const row = sheet.getRow(HEADER_ROW);
  row.height = HEADER_HEIGHT;
  columns.forEach((column, index) => {
    const cell = row.getCell(index + 1);
    cell.value = column.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { horizontal: column.number || column.center ? "center" : "left", vertical: "middle", wrapText: true };
    cell.border = { top: side("thin", GREEN), bottom: side("thin", GREEN), left: dividerKeys.includes(column.key) ? side("medium", GREEN_LINE) : side("thin", GREEN_LINE), right: side("thin", GREEN_LINE) };
  });
}
/** Styles one data row: grid, alternate tint, centering and the medium divider lines. */
export function styleDataRow(sheet: ExcelJS.Worksheet, rowNumber: number, columns: SheetColumn[], dividerKeys: string[], height: number) {
  const row = sheet.getRow(rowNumber), tinted = (rowNumber - FIRST_DATA_ROW) % 2 === 1;
  row.height = height;
  columns.forEach((column, index) => {
    const cell = row.getCell(index + 1);
    cell.border = { ...gridBorder(), ...(dividerKeys.includes(column.key) ? { left: side("medium", GREEN) } : {}) };
    cell.alignment = { vertical: "middle", horizontal: column.number || column.center ? "center" : "left", wrapText: true };
    if (tinted) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } };
    if (column.number) cell.numFmt = DASH_FORMAT;
  });
}
export function styleTotalsRow(sheet: ExcelJS.Worksheet, rowNumber: number, columns: SheetColumn[], dividerKeys: string[]) {
  const row = sheet.getRow(rowNumber);
  row.height = 26;
  columns.forEach((column, index) => {
    const cell = row.getCell(index + 1);
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: GREEN } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    cell.alignment = { vertical: "middle", horizontal: column.number ? "center" : "left" };
    cell.border = { top: side("medium", GREEN), bottom: side("medium", GREEN), left: dividerKeys.includes(column.key) ? side("medium", GREEN) : side("thin", GRID), right: side("thin", GRID) };
    if (column.number) cell.numFmt = DASH_FORMAT;
  });
}
export const columnLetter = (index: number): string => { let n = index, text = ""; while (n > 0) { const rest = (n - 1) % 26; text = String.fromCharCode(65 + rest) + text; n = Math.floor((n - 1) / 26); } return text; };

/** Print on A4 landscape, one page wide, with the header row repeated on every page. */
export function applyPrintSetup(sheet: ExcelJS.Worksheet) {
  sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  sheet.headerFooter = { oddFooter: "&LNOA Offices · ProjectWorkflow Inventory&RPage &P of &N" };
}
export function applyFreeze(sheet: ExcelJS.Worksheet, frozenColumns: number) {
  sheet.views = [{ state: "frozen", xSplit: frozenColumns, ySplit: HEADER_ROW, topLeftCell: `${columnLetter(frozenColumns + 1)}${FIRST_DATA_ROW}`, showGridLines: false }];
}
/** Puts a photo in a cell, centred, about 88 x 66 px, without stretching the row. */
export function placePhoto(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, imageId: number, columnIndex: number, rowNumber: number, columnWidthChars: number, rowHeightPoints: number) {
  const cellWidth = columnWidthChars * PX_PER_CHAR + 5, cellHeight = rowHeightPoints * PX_PER_POINT;
  const offsetX = Math.max(2, Math.floor((cellWidth - PHOTO_SIZE.width) / 2)), offsetY = Math.max(2, Math.floor((cellHeight - PHOTO_SIZE.height) / 2));
  sheet.addImage(imageId, { tl: { nativeCol: columnIndex - 1, nativeColOff: offsetX * EMU_PER_PX, nativeRow: rowNumber - 1, nativeRowOff: offsetY * EMU_PER_PX } as unknown as ExcelJS.Anchor, ext: PHOTO_SIZE, editAs: "oneCell" });
  void workbook;
}
export function writeSkippedNote(sheet: ExcelJS.Worksheet, rowNumber: number, skipped: number) {
  if (skipped <= 0) return;
  const cell = sheet.getCell(`A${rowNumber}`);
  cell.value = `${skipped} ${skipped === 1 ? "photo" : "photos"} could not be loaded.`;
  cell.font = { name: "Calibri", size: 10, italic: true, color: { argb: GREY_TEXT } };
}
