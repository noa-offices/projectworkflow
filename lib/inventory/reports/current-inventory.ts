import ExcelJS from "exceljs";
import { inventoryLabel } from "../presentation";
import { LOCATION_LABELS } from "../types";
import type { CurrentInventoryFilters } from "./params";
import { escapeHtml, formatDubaiDateTime, safeCell } from "./format";
import { AMBER, AMBER_FILL, DATA_ROW_HEIGHT_PLAIN, DATA_ROW_HEIGHT_WITH_PHOTO, FIRST_DATA_ROW, GREEN, HEADER_ROW, applyFreeze, applyPrintSetup, columnLetter, placePhoto, styleDataRow, styleTotalsRow, writeHeader, writeSkippedNote, writeTitleBlock, type SheetColumn } from "./excel-style";
import { photoKey, type PhotoSet } from "./photos";

/** One line of the Current inventory report. Stock numbers only: never prices or costs. */
export interface CurrentInventoryRow {
  stock_ref: string | null; item_code: string | null; item_name: string; model_name: string | null;
  brand: string | null; category: string | null; subcategory: string | null;
  item_type: string; status: string; condition: string;
  warehouse: number; dubai_showroom: number; abudhabi_showroom: number; mockup: number; temporary_out: number;
  total_live: number; reserved: number; available: number; sold: number;
  photo_url?: string | null;
}
type NumberKey = "warehouse" | "dubai_showroom" | "abudhabi_showroom" | "mockup" | "temporary_out" | "total_live" | "reserved" | "available" | "sold";
type TextKey = "stock_ref" | "item_code" | "item_name" | "model_name" | "brand" | "category" | "subcategory" | "item_type" | "status" | "condition";
export const CURRENT_TEXT_COLUMNS: { key: TextKey; header: string; width: number }[] = [
  { key: "stock_ref", header: "Stock ref", width: 12 }, { key: "item_code", header: "Item code", width: 14 }, { key: "item_name", header: "Item name", width: 34 },
  { key: "model_name", header: "Model", width: 20 }, { key: "brand", header: "Brand", width: 16 }, { key: "category", header: "Category", width: 16 },
  { key: "subcategory", header: "Subcategory", width: 16 }, { key: "item_type", header: "Type", width: 12 }, { key: "status", header: "Status", width: 12 }, { key: "condition", header: "Condition", width: 12 },
];
export const CURRENT_NUMBER_COLUMNS: { key: NumberKey; header: string; width: number }[] = [
  { key: "warehouse", header: LOCATION_LABELS.warehouse, width: 11 }, { key: "dubai_showroom", header: LOCATION_LABELS.dubai_showroom, width: 15 },
  { key: "abudhabi_showroom", header: LOCATION_LABELS.abudhabi_showroom, width: 18 }, { key: "mockup", header: LOCATION_LABELS.mockup, width: 10 },
  { key: "temporary_out", header: LOCATION_LABELS.temporary_out, width: 14 }, { key: "total_live", header: "Total live", width: 11 },
  { key: "reserved", header: "Reserved", width: 10 }, { key: "available", header: "Available", width: 10 }, { key: "sold", header: "Sold (cumulative)", width: 12 },
];
export const CURRENT_HEADERS = [...CURRENT_TEXT_COLUMNS, ...CURRENT_NUMBER_COLUMNS].map(column => column.header);

export function currentTotals(rows: readonly CurrentInventoryRow[]): Record<NumberKey, number> {
  const totals = Object.fromEntries(CURRENT_NUMBER_COLUMNS.map(column => [column.key, 0])) as Record<NumberKey, number>;
  for (const row of rows) for (const column of CURRENT_NUMBER_COLUMNS) totals[column.key] += row[column.key];
  return totals;
}
const text = (row: CurrentInventoryRow, key: TextKey) => key === "item_type" || key === "status" || key === "condition" ? inventoryLabel(row[key]) : row[key] ?? "";
export type ReportMeta = { generatedAt: Date; filterLines: string[] };

/** Human-readable lines for the filters that were used (names, not ids). */
export function currentFilterLines(filters: CurrentInventoryFilters, names: { brand?: string | null; category?: string | null } = {}): string[] {
  const lines = [
    filters.brand ? `Brand: ${names.brand ?? "Selected brand"}` : null, filters.category ? `Category: ${names.category ?? "Selected category"}` : null,
    filters.itemType ? `Type: ${inventoryLabel(filters.itemType)}` : null, filters.location ? `Location: ${LOCATION_LABELS[filters.location]} (more than 0 units)` : null,
    filters.status ? `Status: ${inventoryLabel(filters.status)}` : null, filters.includeSoldOut ? "Includes sold-out items" : "Sold-out items left out",
  ];
  return lines.filter((line): line is string => !!line);
}

/** Excel columns, in order. Category and subcategory share one column. */
export const CURRENT_EXCEL_COLUMNS: SheetColumn[] = [
  { key: "photo", header: "Photo", width: 17, center: true }, { key: "stock_ref", header: "Stock ref", width: 11 }, { key: "item_name", header: "Item name", width: 30 },
  { key: "brand", header: "Brand", width: 16 }, { key: "category", header: "Category / Subcategory", width: 15 }, { key: "item_type", header: "Type", width: 12 },
  { key: "status", header: "Status", width: 12 }, { key: "item_code", header: "Item code", width: 11 }, { key: "model_name", header: "Model", width: 11 }, { key: "condition", header: "Condition", width: 11 },
  ...CURRENT_NUMBER_COLUMNS.map((column, index) => ({ key: column.key, header: column.header, width: [11, 11, 11, 9, 11, 10, 10, 10, 15][index], number: true })),
];
export const CURRENT_EXCEL_HEADERS = CURRENT_EXCEL_COLUMNS.map(column => column.header);
/** Medium divider lines: item details | locations | totals | sold. */
export const CURRENT_DIVIDERS = ["warehouse", "total_live", "sold"];
const categoryText = (row: CurrentInventoryRow) => [row.category, row.subcategory].filter(Boolean).join(" / ");

export async function buildCurrentInventoryWorkbook(rows: readonly CurrentInventoryRow[], meta: ReportMeta, photos?: PhotoSet | null): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProjectWorkflow"; workbook.created = meta.generatedAt;
  workbook.calcProperties = { fullCalcOnLoad: true }; // Excel recalculates the SUM formulas when the file opens
  const sheet = workbook.addWorksheet("Current inventory");
  const showPhotos = !!photos && photos.buffers.size > 0, height = showPhotos ? DATA_ROW_HEIGHT_WITH_PHOTO : DATA_ROW_HEIGHT_PLAIN;
  sheet.columns = CURRENT_EXCEL_COLUMNS.map(column => ({ key: column.key, width: column.width }));
  sheet.getColumn("photo").hidden = !showPhotos;
  writeTitleBlock(sheet, "Current inventory", meta);
  writeHeader(sheet, CURRENT_EXCEL_COLUMNS, CURRENT_DIVIDERS);
  const imageIds = new Map<string, number>(); // each distinct image is added to the workbook once
  const numberIndex = new Map(CURRENT_EXCEL_COLUMNS.map((column, index) => [column.key, index + 1]));
  rows.forEach((row, index) => {
    const rowNumber = FIRST_DATA_ROW + index, excel = sheet.getRow(rowNumber);
    const text: Record<string, string> = { stock_ref: safeCell(row.stock_ref), item_name: safeCell(row.item_name), brand: safeCell(row.brand), category: safeCell(categoryText(row)), item_type: inventoryLabel(row.item_type), status: inventoryLabel(row.status), item_code: safeCell(row.item_code), model_name: safeCell(row.model_name), condition: inventoryLabel(row.condition) };
    for (const [key, value] of Object.entries(text)) if (value !== "") excel.getCell(numberIndex.get(key)!).value = value; // empty stays an empty cell
    for (const column of CURRENT_NUMBER_COLUMNS) excel.getCell(numberIndex.get(column.key)!).value = row[column.key];
    styleDataRow(sheet, rowNumber, CURRENT_EXCEL_COLUMNS, CURRENT_DIVIDERS, height);
    excel.getCell(numberIndex.get("stock_ref")!).font = { name: "Calibri", size: 11, bold: true, color: { argb: GREEN } };
    excel.getCell(numberIndex.get("item_name")!).font = { name: "Calibri", size: 11, bold: true };
    excel.getCell(numberIndex.get("total_live")!).font = { name: "Calibri", size: 11, bold: true };
    if (row.reserved > 0) { const cell = excel.getCell(numberIndex.get("reserved")!); cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: AMBER } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER_FILL } }; }
    const key = photoKey(row.photo_url), buffer = key ? photos?.buffers.get(key) : undefined;
    if (key && buffer) {
      let id = imageIds.get(key);
      if (id === undefined) { id = workbook.addImage({ buffer: buffer as unknown as ExcelJS.Buffer, extension: "jpeg" }); imageIds.set(key, id); }
      placePhoto(workbook, sheet, id, 1, rowNumber, CURRENT_EXCEL_COLUMNS[0].width, height);
    }
  });
  const last = FIRST_DATA_ROW + rows.length - 1, totalRow = rows.length ? last + 1 : FIRST_DATA_ROW;
  sheet.getCell(totalRow, numberIndex.get("item_name")!).value = `Total (${rows.length} ${rows.length === 1 ? "item" : "items"})`;
  const totals = currentTotals(rows);
  for (const column of CURRENT_NUMBER_COLUMNS) {
    const index = numberIndex.get(column.key)!, letter = columnLetter(index);
    // Formulas of numbers only: never of user text.
    sheet.getCell(totalRow, index).value = rows.length ? { formula: `SUM(${letter}${FIRST_DATA_ROW}:${letter}${last})`, result: totals[column.key] } : 0;
  }
  styleTotalsRow(sheet, totalRow, CURRENT_EXCEL_COLUMNS, CURRENT_DIVIDERS);
  writeSkippedNote(sheet, totalRow + 2, photos?.skipped ?? 0);
  if (rows.length) sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: last, column: CURRENT_EXCEL_COLUMNS.length } };
  applyFreeze(sheet, 2);
  applyPrintSetup(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const PDF_CSS = "@page{size:A4 landscape;margin:12mm 8mm 14mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#18181b;font-size:7.5pt;margin:0}h1{font-size:15pt;margin:0 0 2mm}.meta{color:#52525b;font-size:8pt;margin:0 0 1mm}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border-bottom:.3pt solid #d4d4d8;padding:1mm .8mm;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e4f1ea;font-weight:700;font-size:6.8pt}thead{display:table-header-group}tr{break-inside:avoid}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}tfoot td{font-weight:700;border-top:.8pt solid #166534}img{width:9mm;height:9mm;object-fit:cover;border-radius:1mm;display:block}";
const PDF_WIDTHS: Record<string, number> = { stock_ref: 6, item_code: 6.5, item_name: 15, model_name: 8, brand: 6.5, category: 6.5, subcategory: 8, item_type: 6.5, status: 6.5, condition: 5.5, warehouse: 3.8, dubai_showroom: 3.8, abudhabi_showroom: 3.8, mockup: 3.8, temporary_out: 3.8, total_live: 3.8, reserved: 3.8, available: 3.8, sold: 3.8 };
/** Short headers keep the 9 number columns narrow on A4; the legend under the title spells them out. */
const PDF_SHORT_HEADERS: Record<string, string> = { warehouse: "WH", dubai_showroom: "DXB", abudhabi_showroom: "AUH", mockup: "Mock", temporary_out: "Out", total_live: "Live", reserved: "Res.", available: "Avail.", sold: "Sold" };
export const PDF_LEGEND = "WH Warehouse · DXB Dubai Showroom · AUH Abu Dhabi Showroom · Mock Mockup · Out Temporary Out · Live total live · Res. reserved · Avail. available · Sold cumulative";
/** Print page for the PDF: A4 landscape table. Photos are small thumbnails and optional. */
export function buildCurrentInventoryPdfHtml(rows: readonly CurrentInventoryRow[], meta: ReportMeta, options: { photos: boolean }): string {
  const isNumber = (key: string) => CURRENT_NUMBER_COLUMNS.some(column => column.key === key);
  const head = (options.photos ? '<th style="width:11mm">Photo</th>' : "") + [...CURRENT_TEXT_COLUMNS, ...CURRENT_NUMBER_COLUMNS].map(column => `<th class="${isNumber(column.key) ? "n" : ""}" style="width:${PDF_WIDTHS[column.key]}%">${escapeHtml(PDF_SHORT_HEADERS[column.key] ?? column.header)}</th>`).join("");
  const body = rows.map(row => `<tr>${options.photos ? `<td>${row.photo_url ? `<img src="${escapeHtml(row.photo_url)}" alt="">` : ""}</td>` : ""}${CURRENT_TEXT_COLUMNS.map(column => `<td>${escapeHtml(text(row, column.key))}</td>`).join("")}${CURRENT_NUMBER_COLUMNS.map(column => `<td class="n">${row[column.key]}</td>`).join("")}</tr>`).join("");
  const totals = currentTotals(rows), span = CURRENT_TEXT_COLUMNS.length + (options.photos ? 1 : 0);
  const foot = `<tr><td colspan="${span}">Total (${rows.length} ${rows.length === 1 ? "item" : "items"})</td>${CURRENT_NUMBER_COLUMNS.map(column => `<td class="n">${totals[column.key]}</td>`).join("")}</tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Current inventory</title><style>${PDF_CSS}</style></head><body><h1>Current inventory</h1><p class="meta">Created ${escapeHtml(formatDubaiDateTime(meta.generatedAt))} (Dubai time)</p><p class="meta">${meta.filterLines.map(escapeHtml).join(" · ") || "No filters"}</p><p class="meta">${escapeHtml(PDF_LEGEND)}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></body></html>`;
}
export const reportPdfOptions = (meta: ReportMeta) => ({
  format: "A4" as const, landscape: true, printBackground: true, displayHeaderFooter: true, margin: { top: "12mm", right: "8mm", bottom: "14mm", left: "8mm" },
  headerTemplate: "<div></div>",
  footerTemplate: `<div style="width:100%;font-size:7px;color:#52525b;padding:0 8mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif"><span>Current inventory · ${escapeHtml(formatDubaiDateTime(meta.generatedAt))} Dubai time</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
});
