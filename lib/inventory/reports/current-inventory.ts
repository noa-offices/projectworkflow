import ExcelJS from "exceljs";
import { inventoryLabel } from "../presentation";
import { LOCATION_LABELS } from "../types";
import type { CurrentInventoryFilters } from "./params";
import { escapeHtml, formatDubaiDateTime, safeCell } from "./format";

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

export async function buildCurrentInventoryWorkbook(rows: readonly CurrentInventoryRow[], meta: ReportMeta): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProjectWorkflow"; workbook.created = meta.generatedAt;
  const sheet = workbook.addWorksheet("Current inventory", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [...CURRENT_TEXT_COLUMNS, ...CURRENT_NUMBER_COLUMNS].map(column => ({ header: column.header, key: column.key, width: column.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true }; header.alignment = { vertical: "middle", wrapText: true }; header.height = 32;
  header.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F1EA" } }; cell.border = { bottom: { style: "thin", color: { argb: "FF166534" } } }; });
  for (const row of rows) {
    const values: Record<string, string | number> = {};
    for (const column of CURRENT_TEXT_COLUMNS) values[column.key] = safeCell(text(row, column.key));
    for (const column of CURRENT_NUMBER_COLUMNS) values[column.key] = row[column.key]; // real numbers
    sheet.addRow(values);
  }
  const totals = currentTotals(rows), totalRow = sheet.addRow({ item_name: `Total (${rows.length} ${rows.length === 1 ? "item" : "items"})`, ...totals });
  totalRow.font = { bold: true }; totalRow.eachCell(cell => { cell.border = { top: { style: "thin" } }; });
  const first = CURRENT_TEXT_COLUMNS.length + 1;
  for (let index = first; index < first + CURRENT_NUMBER_COLUMNS.length; index++) sheet.getColumn(index).numFmt = "#,##0";
  sheet.getColumn("item_name").alignment = { wrapText: true, vertical: "top" };
  if (rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: first + CURRENT_NUMBER_COLUMNS.length - 1 } };
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
