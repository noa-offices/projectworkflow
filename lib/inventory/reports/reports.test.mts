import assert from "node:assert/strict";
import test, { mock } from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import sharp from "sharp";
import { CURRENT_DIVIDERS, CURRENT_EXCEL_COLUMNS, CURRENT_EXCEL_HEADERS, buildCurrentInventoryPdfHtml, buildCurrentInventoryWorkbook, currentFilterLines, currentTotals, reportPdfOptions, type CurrentInventoryRow } from "./current-inventory";
import { dubaiDateKey, dubaiDayBounds, escapeHtml, excelDubaiDate, formatDubaiDateTime, isValidDateKey, reportFileName, safeCell, shiftDateKey } from "./format";
import { MOVEMENT_DIVIDERS, MOVEMENT_HEADERS, MOVEMENT_REPORT_LIMIT, NARROW_RANGE_MESSAGE, ReportTooLargeError, buildMovementsWorkbook, movementReportRow } from "./movements-report";
import { defaultMovementRange, parseCurrentInventoryParams, parseMovementReportParams } from "./params";
import { photoKey, type PhotoSet } from "./photos";
import { currentReportUrl, downloadName, movementsReportUrl, photoNote } from "./urls";
import type { InventoryMovement } from "../types";

const row = (patch: Partial<CurrentInventoryRow> = {}): CurrentInventoryRow => ({
  stock_ref: "02-0001", item_code: "CHR-042", item_name: "Arlo chair", model_name: "Mid back", brand: "Nora Office", category: "Chairs", subcategory: "Task chairs",
  item_type: "product", status: "available", condition: "new", warehouse: 10, dubai_showroom: 3, abudhabi_showroom: 2, mockup: 0, temporary_out: 1,
  total_live: 16, reserved: 4, available: 12, sold: 8, ...patch,
});
const movement = (patch: Partial<InventoryMovement> = {}): InventoryMovement => ({
  id: "m1", product_id: "p1", movement_type: "transfer", action_type: "internal_transfer", from_location: "warehouse", to_location: "dubai_showroom", quantity: 3,
  previous_quantity: 17, new_quantity: 17, note: "Showroom display", reference_type: "manual", reference_id: null, created_by: "u1", created_at: "2026-10-24T22:30:00Z",
  product: { id: "p1", brand_id: "b1", stock_ref: "02-0001", item_code: "CHR-042", item_name: "Arlo chair", model_name: null }, actor_display_name: "Alex Morgan", linked: { kind: "request", id: "r1" }, ...patch,
});
const meta = { generatedAt: new Date("2026-10-25T10:05:00Z"), filterLines: ["Sold-out items left out"] };
const read = async (buffer: Buffer) => { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ArrayBuffer); return workbook; };
const jpeg = (color: string) => sharp({ create: { width: 240, height: 180, channels: 3, background: color } }).jpeg().toBuffer();
const url = (name: string) => `https://files.example.test/inventory-images/products/${name}.jpg?token=${Math.random()}`;
const argb = (cell: ExcelJS.Cell) => (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;

test('report item names carry the Stock ref identifier beneath them without empty separators',async()=>{
  const item=row({stock_ref:'GEN-0001',item_code:null,model_name:null});
  const sheet=(await read(await buildCurrentInventoryWorkbook([item],meta))).worksheets[0];
  assert.equal(sheet.getRow(6).getCell(3).value,'Arlo chair\nGEN-0001');
  assert.match(buildCurrentInventoryPdfHtml([item],meta,{photos:false}),/Arlo chair<br><span[^>]*>GEN-0001<\/span>/);
  const m=movement({product:{...movement().product!,stock_ref:'IK1-0001',item_code:null,model_name:null}});
  const ms=(await read(await buildMovementsWorkbook([m],meta))).worksheets[0];
  assert.equal(ms.getRow(6).getCell(4).value,'Arlo chair\nIK1-0001');
  const long=row({item_name:'Long item name '.repeat(14),model_name:'Long model '.repeat(18)});
  const ls=(await read(await buildCurrentInventoryWorkbook([long],meta))).worksheets[0];
  assert.ok((ls.getRow(6).height ?? 0)>100,'long names must not hide the identifying Stock ref below them');
});

test("times are shown and filtered in Dubai time", () => {
  assert.equal(formatDubaiDateTime("2026-10-24T22:30:00Z"), "25 Oct 2026, 02:30");
  assert.equal(dubaiDateKey(new Date("2026-10-24T21:00:00Z")), "2026-10-25");
  assert.equal(dubaiDateKey(new Date("2026-10-24T19:59:00Z")), "2026-10-24");
  assert.deepEqual(dubaiDayBounds("2026-10-01", "2026-10-31"), { from: "2026-09-30T20:00:00.000Z", to: "2026-10-31T19:59:59.999Z" });
  assert.equal(excelDubaiDate("2026-10-24T22:30:00Z")!.toISOString(), "2026-10-25T02:30:00.000Z");
  assert.equal(excelDubaiDate("nonsense"), null);
  assert.equal(shiftDateKey("2026-10-25", -29), "2026-09-26");
  assert.deepEqual(defaultMovementRange(new Date("2026-10-25T10:00:00Z")), { from: "2026-09-26", to: "2026-10-25" });
  assert.equal(reportFileName("inventory-current", "xlsx", new Date("2026-10-25T10:00:00Z")), "inventory-current-2026-10-25.xlsx");
  assert.equal(reportFileName("inventory-movements", "xlsx", new Date("2026-10-24T21:30:00Z")), "inventory-movements-2026-10-25.xlsx");
});
test("movement report dates: default last 30 days, required, real and in order", () => {
  const now = new Date("2026-10-25T10:00:00Z");
  const fallback = parseMovementReportParams(new URLSearchParams(), now);
  assert.ok(fallback.ok); assert.deepEqual([fallback.value.from, fallback.value.to], ["2026-09-26", "2026-10-25"]);
  for (const params of ["from=2026-02-31", "from=abc&to=2026-10-01", "from=2026-10-10&to=2026-10-01", "from=2024-01-01&to=2026-10-01", "to=2026-13-01"]) assert.equal(parseMovementReportParams(new URLSearchParams(params), now).ok, false, params);
  assert.equal(isValidDateKey("2026-02-28"), true); assert.equal(isValidDateKey("2026-02-30"), false);
});
test("every query parameter is checked against an allow-list, and photos default to on for Excel", () => {
  assert.equal(parseCurrentInventoryParams(new URLSearchParams("format=pdf&itemType=accessory&location=sold&status=hold&soldOut=1&photos=1")).ok, true);
  for (const params of ["format=csv", "itemType=gadget", "location=moon", "status=bogus", "brand=not-a-uuid", "category=1%27%20or%201=1"]) assert.equal(parseCurrentInventoryParams(new URLSearchParams(params)).ok, false, params);
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(parseMovementReportParams(new URLSearchParams(`action=hack`)).ok, false);
  assert.equal(parseMovementReportParams(new URLSearchParams(`product=x`)).ok, false);
  assert.equal(parseMovementReportParams(new URLSearchParams(`product=${id.toUpperCase()}&action=sale&location=warehouse&person=Alex`)).ok, true);
  const parsed = parseCurrentInventoryParams(new URLSearchParams("brand=" + id.toUpperCase())); assert.ok(parsed.ok); assert.equal(parsed.value.brand, id);
  assert.ok(parsed.value.excelPhotos); assert.equal(parsed.value.photos, false);
  const off = parseCurrentInventoryParams(new URLSearchParams("excelPhotos=0")); assert.ok(off.ok); assert.equal(off.value.excelPhotos, false);
  const moves = parseMovementReportParams(new URLSearchParams("photos=0")); assert.ok(moves.ok); assert.equal(moves.value.photos, false);
  const movesOn = parseMovementReportParams(new URLSearchParams("")); assert.ok(movesOn.ok); assert.equal(movesOn.value.photos, true);
  assert.equal(parseCurrentInventoryParams(new URLSearchParams("")).ok, true);
});
test("report links carry only the chosen filters, and the photo note comes from the response headers", () => {
  const filters = { brand: "", category: "", itemType: "accessory" as const, location: "warehouse" as const, status: "" as const, includeSoldOut: true, photos: true, excelPhotos: true };
  assert.equal(currentReportUrl(filters, "xlsx"), "/api/inventory/reports/current?format=xlsx&itemType=accessory&location=warehouse&soldOut=1");
  assert.equal(currentReportUrl({ ...filters, excelPhotos: false }, "xlsx"), "/api/inventory/reports/current?format=xlsx&itemType=accessory&location=warehouse&soldOut=1&excelPhotos=0");
  assert.equal(currentReportUrl(filters, "pdf"), "/api/inventory/reports/current?format=pdf&itemType=accessory&location=warehouse&soldOut=1&photos=1");
  assert.equal(movementsReportUrl({ from: "2026-10-01", to: "2026-10-31", product: "", action: "sale", location: "", person: " Alex ", photos: true }), "/api/inventory/reports/movements?from=2026-10-01&to=2026-10-31&action=sale&person=Alex");
  assert.ok(movementsReportUrl({ from: "2026-10-01", to: "2026-10-31", product: "", action: "", location: "", person: "", photos: false }).endsWith("&photos=0"));
  assert.equal(downloadName("attachment; filename=\"a.xlsx\"; filename*=UTF-8''b%20c.xlsx", "x"), "b c.xlsx");
  assert.equal(downloadName(null, "fallback.pdf"), "fallback.pdf");
  const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
  assert.equal(photoNote(headers({ "X-Photos-Omitted": "too-many" })), "Narrow the filters to include photos.");
  assert.equal(photoNote(headers({ "X-Photos-Skipped": "3" })), "3 photos could not be loaded.");
  assert.equal(photoNote(headers({ "X-Photos-Skipped": "1" })), "1 photo could not be loaded.");
  assert.equal(photoNote(headers({})), null);
});
test("formula injection: text that starts like a formula is stored with a leading apostrophe", () => {
  for (const text of ["=1+1", "+SUM(A1)", "-5+2", "@cmd", "\t=1", "\r=1", "=HYPERLINK(\"http://x\",\"y\")"]) assert.equal(safeCell(text), `'${text}`);
  for (const text of ["Arlo chair", "", "10 - 20", "a=b", "CHR-042"]) assert.equal(safeCell(text), text);
  assert.equal(safeCell(null), ""); assert.equal(safeCell(undefined), "");
});

test("Current inventory layout: title block, header row 5, column order, widths, frozen panes, filter, print setup", async () => {
  const workbook = await read(await buildCurrentInventoryWorkbook([row(), row({ stock_ref: "02-0002" })], meta, { buffers: new Map([[photoKey(url("x"))!, await jpeg("#888")]]), skipped: 0 } as PhotoSet));
  const sheet = workbook.getWorksheet("Current inventory")!;
  assert.equal(sheet.getCell("A1").value, "Current inventory"); assert.equal(sheet.getCell("A1").font?.size, 18); assert.equal(sheet.getCell("A1").font?.bold, true); assert.equal(sheet.getCell("A1").font?.color?.argb, "FF064E3B");
  assert.equal(sheet.getCell("A2").value, "NOA Offices · ProjectWorkflow Inventory"); assert.equal(sheet.getCell("A2").font?.size, 10); assert.equal(sheet.getCell("A2").font?.color?.argb, "FF6B7280");
  assert.equal(sheet.getCell("A3").value, "Made on 25 Oct 2026, 14:05 (Dubai time) · Filters: Sold-out items left out"); assert.equal(sheet.getCell("A3").font?.size, 10);
  assert.deepEqual(CURRENT_EXCEL_HEADERS, ["Photo", "Stock ref", "Item name", "Brand", "Category / Subcategory", "Type", "Status", "Item code", "Model", "Condition", "Warehouse", "Dubai Showroom", "Abu Dhabi Showroom", "Mockup", "Temporary Out", "Total live", "Reserved", "Available", "Sold (cumulative)"]);
  assert.deepEqual((sheet.getRow(5).values as string[]).slice(1), CURRENT_EXCEL_HEADERS);
  assert.deepEqual(CURRENT_EXCEL_COLUMNS.map(column => column.width), [17, 11, 30, 16, 15, 12, 12, 11, 11, 11, 11, 11, 11, 9, 11, 10, 10, 10, 15]);
  assert.equal(sheet.getColumn(1).width, 17); assert.equal(sheet.getColumn(3).width, 30); assert.equal(sheet.getColumn(19).width, 15);
  const view = sheet.views[0] as { state: string; xSplit: number; ySplit: number; showGridLines: boolean };
  assert.deepEqual([view.state, view.xSplit, view.ySplit, view.showGridLines], ["frozen", 2, 5, false]);
  assert.equal(sheet.autoFilter, "A5:S7"); // header row through the last data row
  assert.equal(sheet.pageSetup.orientation, "landscape"); assert.equal(sheet.pageSetup.fitToPage, true); assert.equal(sheet.pageSetup.fitToWidth, 1); assert.equal(sheet.pageSetup.fitToHeight, 0); assert.equal(sheet.pageSetup.printTitlesRow, "5:5");
  assert.equal(sheet.getRow(6).height, 66); assert.equal(sheet.getRow(5).height, 38);
});
test("Current inventory styling: header, dividers, alternate tint, bold cells, reserved highlight, number format", async () => {
  const sheet = (await read(await buildCurrentInventoryWorkbook([row(), row({ reserved: 0, available: 16 }), row({ stock_ref: "02-0003" })], meta))).getWorksheet("Current inventory")!;
  const header = sheet.getRow(5).getCell(3);
  assert.equal(header.font?.color?.argb, "FFFFFFFF"); assert.equal(header.font?.bold, true); assert.equal(argb(header), "FF064E3B"); assert.equal(header.alignment?.wrapText, true); assert.equal(header.alignment?.horizontal, "left");
  assert.equal(sheet.getRow(5).getCell(1).alignment?.horizontal, "center"); assert.equal(sheet.getRow(5).getCell(11).alignment?.horizontal, "center");
  assert.equal(header.border?.right?.style, "thin");
  // Medium dark-green dividers on the left of Warehouse (11), Total live (16) and Sold (19), in header, data and totals rows.
  assert.deepEqual(CURRENT_DIVIDERS, ["warehouse", "total_live", "sold"]);
  for (const rowNumber of [5, 6, 7, 8, 9]) for (const column of [11, 16, 19]) { const border = sheet.getRow(rowNumber).getCell(column).border?.left; assert.equal(border?.style, "medium", `row ${rowNumber} col ${column}`); }
  for (const column of [2, 10, 12, 17, 18]) assert.notEqual(sheet.getRow(6).getCell(column).border?.left?.style, "medium", `col ${column}`);
  for (const column of [3, 12]) { const border = sheet.getRow(6).getCell(column).border!; assert.deepEqual([border.top?.style, border.bottom?.style, border.left?.style, border.right?.style], ["thin", "thin", "thin", "thin"]); }
  // every second data row is tinted
  assert.equal(argb(sheet.getRow(6).getCell(3)), undefined); assert.equal(argb(sheet.getRow(7).getCell(3)), "FFF4F8F6"); assert.equal(argb(sheet.getRow(8).getCell(3)), undefined);
  assert.equal(sheet.getRow(6).getCell(2).font?.bold, true); assert.equal(sheet.getRow(6).getCell(2).font?.color?.argb, "FF064E3B");
  assert.equal(sheet.getRow(6).getCell(3).font?.bold, true); assert.equal(sheet.getRow(6).getCell(16).font?.bold, true);
  assert.equal(sheet.getRow(6).getCell(3).alignment?.vertical, "middle"); assert.equal(sheet.getRow(6).getCell(3).alignment?.wrapText, true);
  // reserved above 0: bold amber on pale amber; reserved 0: plain
  const hot = sheet.getRow(6).getCell(17), plain = sheet.getRow(7).getCell(17);
  assert.equal(hot.font?.bold, true); assert.equal(hot.font?.color?.argb, "FFB45309"); assert.equal(argb(hot), "FFFEF3C7");
  assert.notEqual(plain.font?.color?.argb, "FFB45309"); assert.notEqual(argb(plain), "FFFEF3C7");
  // real numbers, zero shown as a dash
  assert.equal(sheet.getRow(6).getCell(11).value, 10); assert.equal(typeof sheet.getRow(6).getCell(11).value, "number");
  assert.equal(sheet.getRow(6).getCell(14).value, 0); assert.equal(sheet.getRow(6).getCell(14).numFmt, '0;-0;"–"');
  for (let column = 11; column <= 19; column++) assert.equal(sheet.getRow(6).getCell(column).numFmt, '0;-0;"–"');
});
test("Current inventory content: category shown together, empty code and model stay empty, totals are SUM formulas", async () => {
  const rows = [row(), row({ stock_ref: "02-0002", item_code: null, model_name: null, subcategory: null, item_name: "=HYPERLINK(\"http://evil\",\"Click\")", item_type: "accessory", status: "showroom" })];
  const sheet = (await read(await buildCurrentInventoryWorkbook(rows, meta))).getWorksheet("Current inventory")!;
  assert.equal(sheet.getRow(6).getCell(5).value, "Chairs / Task chairs"); assert.equal(sheet.getRow(7).getCell(5).value, "Chairs");
  assert.equal(sheet.getRow(6).getCell(6).value, "Product"); assert.equal(sheet.getRow(7).getCell(7).value, "Showroom");
  assert.equal(sheet.getRow(7).getCell(8).value, null); assert.equal(sheet.getRow(7).getCell(9).value, null); assert.equal(sheet.getRow(6).getCell(8).value, "CHR-042");
  const dangerous = sheet.getRow(7).getCell(3).value; assert.equal(typeof dangerous, "string"); assert.ok((dangerous as string).startsWith("'=HYPERLINK"));
  const totals = sheet.getRow(8);
  assert.equal(totals.getCell(3).value, "Total (2 items)");
  for (let column = 11; column <= 19; column++) {
    const value = totals.getCell(column).value as { formula: string; result: number }, letter = String.fromCharCode(64 + column);
    assert.equal(value.formula, `SUM(${letter}6:${letter}7)`); assert.ok(value.result === undefined || typeof value.result === "number");
  }
  assert.deepEqual([11, 16, 19].map(column => (totals.getCell(column).value as { result: number }).result), [20, 32, 16]);
  const zip = await JSZip.loadAsync(await buildCurrentInventoryWorkbook(rows, meta));
  assert.match(await zip.file("xl/workbook.xml")!.async("string"), /fullCalcOnLoad="1"/); // Excel recalculates the SUMs on open
  assert.equal(totals.getCell(3).font?.bold, true); assert.equal(argb(totals.getCell(3)), "FFD1FAE5"); assert.equal(totals.getCell(3).border?.top?.style, "medium"); assert.equal(totals.getCell(3).border?.bottom?.style, "medium"); assert.equal(totals.getCell(3).border?.top?.color?.argb, "FF064E3B");
  // formulas hold numbers only: no cell in the data rows is a formula, and no text cell is
  for (const rowNumber of [6, 7]) sheet.getRow(rowNumber).eachCell(cell => assert.equal(typeof cell.value === "object" && cell.value !== null && "formula" in (cell.value as object), false));
  for (let column = 1; column <= 10; column++) assert.equal(typeof totals.getCell(column).value === "object" && totals.getCell(column).value !== null, false);
});
test("Current inventory: totals, empty result, filter lines and no photo column when there are no photos", async () => {
  assert.deepEqual(Object.values(currentTotals([row(), row()])), [20, 6, 4, 0, 2, 32, 8, 24, 16]);
  assert.deepEqual(Object.values(currentTotals([])), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const empty = (await read(await buildCurrentInventoryWorkbook([], meta))).getWorksheet("Current inventory")!;
  assert.equal(empty.getRow(6).getCell(3).value, "Total (0 items)"); assert.equal(empty.getRow(6).getCell(11).value, 0); assert.equal(empty.autoFilter, undefined);
  assert.equal(empty.getColumn(1).hidden, true);
  const lines = currentFilterLines({ brand: "b", category: "", itemType: "accessory", location: "warehouse", status: "", includeSoldOut: false, photos: false, excelPhotos: true }, { brand: "Nora Office" });
  assert.deepEqual(lines, ["Brand: Nora Office", "Type: Accessory", "Location: Warehouse (more than 0 units)", "Sold-out items left out"]);
  const plain = (await read(await buildCurrentInventoryWorkbook([row()], meta))).getWorksheet("Current inventory")!;
  assert.equal(plain.getRow(6).height, 48); assert.equal(plain.getColumn(1).hidden, true);
});
test("Photos in Excel: each distinct image is added once, placed in the Photo cell, and a skipped-photos note is written", async () => {
  const shared = url("shared"), other = url("other");
  const rows = [row({ photo_url: shared }), row({ stock_ref: "02-0002", photo_url: shared.replace(/token=.*/, "token=different") }), row({ stock_ref: "02-0003", photo_url: other }), row({ stock_ref: "02-0004", photo_url: url("broken") }), row({ stock_ref: "02-0005", photo_url: null })];
  const photos: PhotoSet = { buffers: new Map([[photoKey(shared)!, await jpeg("#aaa")], [photoKey(other)!, await jpeg("#555")]]), skipped: 1 };
  const workbook = await read(await buildCurrentInventoryWorkbook(rows, meta, photos)), sheet = workbook.getWorksheet("Current inventory")!;
  assert.equal(workbook.model.media!.length, 2); // 3 photos shown, 2 distinct images
  assert.equal(sheet.getImages().length, 3);
  assert.equal(sheet.getColumn(1).hidden, false); assert.equal(sheet.getRow(6).height, 66);
  const first = sheet.getImages()[0], range = first.range as unknown as { tl: { nativeCol: number; nativeRow: number }; ext?: { width: number; height: number } };
  assert.equal(range.tl.nativeCol, 0); assert.equal(range.tl.nativeRow, 5); assert.deepEqual(range.ext, { width: 88, height: 66 });
  assert.equal(sheet.getCell("A13").value, "1 photo could not be loaded."); // two rows under the totals row (11)
});
test("no report contains prices or costs", async () => {
  const bad = /\b(price|costs?|vat|labour|freight|duty|transport|c ?& ?f)\b/i;
  for (const header of [...CURRENT_EXCEL_HEADERS, ...MOVEMENT_HEADERS]) assert.doesNotMatch(header, bad, header);
  const html = buildCurrentInventoryPdfHtml([row()], meta, { photos: false });
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ""), bad);
});
test("Movements workbook: same look, plain-words actions, Dubai dates, real numbers, notes wrap, photos", async () => {
  const items = [movement({ main_image_url: url("p1") }), movement({ id: "m2", action_type: "sale", movement_type: "stock_out", from_location: "warehouse", to_location: "sold", quantity: 2, previous_quantity: 17, new_quantity: 15, note: "=cmd|' /C calc'!A0", linked: null, actor_display_name: "+Pat", product: null })];
  const photos: PhotoSet = { buffers: new Map([[photoKey(items[0].main_image_url)!, await jpeg("#999")]]), skipped: 0 };
  const workbook = await read(await buildMovementsWorkbook(items, { generatedAt: meta.generatedAt, filterLines: ["Dates: 2026-10-01 to 2026-10-31"] }, photos)), sheet = workbook.getWorksheet("Movements")!;
  assert.equal(sheet.getCell("A1").value, "Movements history"); assert.equal(sheet.getCell("A1").font?.size, 18); assert.match(sheet.getCell("A3").value as string, /^Made on 25 Oct 2026, 14:05 \(Dubai time\) · Filters: Dates:/);
  assert.deepEqual((sheet.getRow(5).values as string[]).slice(1), MOVEMENT_HEADERS);
  assert.deepEqual(MOVEMENT_HEADERS, ["Photo", "Date and time (Dubai time)", "Stock ref", "Item name", "Brand", "Action", "From", "To", "Quantity", "Total before", "Total after", "Note", "Done by", "Linked request or reservation"]);
  const first = sheet.getRow(6);
  assert.ok(first.getCell(2).value instanceof Date); assert.equal((first.getCell(2).value as Date).toISOString(), "2026-10-25T02:30:00.000Z"); assert.equal(first.getCell(2).numFmt, "d mmm yyyy, hh:mm");
  assert.deepEqual([6, 7, 8, 13, 14].map(column => first.getCell(column).value), ["Moved", "Warehouse", "Dubai Showroom", "Alex Morgan", "Stock request"]);
  assert.deepEqual([9, 10, 11].map(column => first.getCell(column).value), [3, 17, 17]); assert.equal(first.getCell(9).numFmt, '0;-0;"–"');
  const second = sheet.getRow(7);
  assert.equal(second.getCell(6).value, "Sold"); assert.equal(second.getCell(4).value, "Unknown product");
  assert.ok((second.getCell(12).value as string).startsWith("'=cmd")); assert.ok((second.getCell(13).value as string).startsWith("'+Pat"));
  assert.equal(argb(sheet.getRow(5).getCell(4)), "FF064E3B"); assert.equal(sheet.getRow(5).getCell(4).font?.bold, true);
  assert.deepEqual(MOVEMENT_DIVIDERS, ["quantity", "note"]);
  for (const column of [9, 12]) assert.equal(first.getCell(column).border?.left?.style, "medium");
  assert.equal(argb(sheet.getRow(7).getCell(4)), "FFF4F8F6"); assert.equal(first.getCell(12).alignment?.wrapText, true);
  const view = sheet.views[0] as { state: string; xSplit: number; ySplit: number }; assert.deepEqual([view.state, view.xSplit, view.ySplit], ["frozen", 3, 5]);
  assert.equal(sheet.autoFilter, "A5:N7");
  assert.equal(sheet.pageSetup.orientation, "landscape"); assert.equal(sheet.pageSetup.printTitlesRow, "5:5"); assert.equal(sheet.getImages().length, 1); assert.equal(first.height, 66);
  assert.equal(movementReportRow(movement({ action_type: "receive_stock", from_location: null })).from, "");
  assert.equal(movementReportRow(movement({ action_type: "adjustment" })).action, "Adjusted");
  assert.equal(movementReportRow(movement({ action_type: "return_to_warehouse" })).action, "Returned");
  assert.equal(movementReportRow(movement({ action_type: "receive_stock" })).action, "Received");
});
test("Movements: more than 20,000 rows is refused with a clear message; empty is fine", async () => {
  assert.equal(MOVEMENT_REPORT_LIMIT, 20000);
  await assert.rejects(() => buildMovementsWorkbook(Array.from({ length: 20001 }, () => movement()), { generatedAt: meta.generatedAt, filterLines: [] }), (error: Error) => error instanceof ReportTooLargeError && error.message === NARROW_RANGE_MESSAGE);
  assert.match(NARROW_RANGE_MESSAGE, /Narrow the date range/);
  const empty = (await read(await buildMovementsWorkbook([], { generatedAt: meta.generatedAt, filterLines: [] }))).getWorksheet("Movements")!;
  assert.equal(empty.getRow(6).getCell(2).value, null);
});
test("PDF page: A4 landscape, title, Dubai time, filters, page numbers, escaped text, optional photos", () => {
  const rows = [row({ item_name: "<script>alert(1)</script>", photo_url: "https://example.test/a.jpg" })];
  const without = buildCurrentInventoryPdfHtml(rows, meta, { photos: false }), withPhotos = buildCurrentInventoryPdfHtml(rows, meta, { photos: true });
  assert.match(without, /size:A4 landscape/); assert.ok(without.includes("<h1>Current inventory</h1>")); assert.ok(without.includes("25 Oct 2026, 14:05 (Dubai time)")); assert.ok(without.includes("Sold-out items left out"));
  assert.doesNotMatch(without, /<script>alert|<img/); assert.ok(without.includes("&lt;script&gt;")); assert.ok(without.includes("Total (1 item)"));
  assert.match(withPhotos, /<img src="https:\/\/example.test\/a.jpg"/); assert.ok(withPhotos.includes(">Photo<"));
  const options = reportPdfOptions(meta);
  assert.equal(options.landscape, true); assert.equal(options.format, "A4"); assert.equal(options.displayHeaderFooter, true);
  assert.match(options.footerTemplate, /class="pageNumber"/); assert.match(options.footerTemplate, /class="totalPages"/); assert.ok(options.footerTemplate.includes("Dubai time"));
  assert.equal(escapeHtml(`a<b>&"'`), "a&lt;b&gt;&amp;&quot;&#39;");
});

// Role gating: every download route checks the role first and reads nothing for other roles.
let role: string | null = "system_owner";
const calls: string[] = [], seen: { current?: unknown; movements?: unknown } = {};
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/auth", { namedExports: { requireInventoryUser: async () => ({ profile: { role }, user: { id: "u" } }) } });
mock.module("@/lib/inventory/queries", { namedExports: {
  listCurrentInventoryReport: async (_filters: unknown, options: unknown) => { calls.push("current"); seen.current = options; return { rows: [row()], brandName: null, categoryName: null, photosOmitted: false }; },
  listMovementsForReport: async (_filters: unknown, _limit: unknown, options: unknown) => { calls.push("movements"); seen.movements = options; return { movements: [movement()], photosOmitted: true }; },
} });
mock.module("@/lib/server/generate-pdf-buffer", { namedExports: { generatePdfFromHtml: async () => { calls.push("pdf"); return Buffer.from("%PDF-1.4 test"); } } });
const currentRoute = await import("../../../app/api/inventory/reports/current/route");
const movementsRoute = await import("../../../app/api/inventory/reports/movements/route");
const request = (path: string) => Object.assign(new Request(`http://localhost${path}`), { nextUrl: new URL(`http://localhost${path}`) }) as never;

test("report routes send other roles back to Inventory before reading anything", async () => {
  for (const other of ["procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff", "unknown", null]) {
    role = other; calls.length = 0;
    for (const response of [await currentRoute.GET(request("/api/inventory/reports/current?format=xlsx")), await currentRoute.GET(request("/api/inventory/reports/current?format=pdf")), await movementsRoute.GET(request("/api/inventory/reports/movements"))]) {
      assert.equal(response.status, 303, String(other)); assert.equal(new URL(response.headers.get("location")!).pathname, "/inventory");
    }
    assert.deepEqual(calls, [], String(other));
  }
});
test("report routes: managers get files with no-store headers, photo limits are passed on, bad input gets a plain 400", async () => {
  for (const manager of ["system_owner", "admin_manager"]) {
    role = manager; calls.length = 0;
    const xlsx = await currentRoute.GET(request("/api/inventory/reports/current?format=xlsx"));
    assert.equal(xlsx.status, 200); assert.equal(xlsx.headers.get("Cache-Control"), "no-store"); assert.match(xlsx.headers.get("Content-Type")!, /spreadsheetml/); assert.match(xlsx.headers.get("Content-Disposition")!, /inventory-current-\d{4}-\d{2}-\d{2}\.xlsx/);
    assert.deepEqual(seen.current, { photos: true, photoLimit: 500 });
    assert.equal((await read(Buffer.from(await xlsx.arrayBuffer()))).worksheets.length, 1);
    await currentRoute.GET(request("/api/inventory/reports/current?format=xlsx&excelPhotos=0")); assert.deepEqual(seen.current, { photos: false, photoLimit: 500 });
    const pdf = await currentRoute.GET(request("/api/inventory/reports/current?format=pdf"));
    assert.equal(pdf.status, 200); assert.equal(pdf.headers.get("Content-Type"), "application/pdf"); assert.match(pdf.headers.get("Content-Disposition")!, /\.pdf/); assert.deepEqual(seen.current, { photos: false, photoLimit: 500 });
    const moves = await movementsRoute.GET(request("/api/inventory/reports/movements"));
    assert.equal(moves.status, 200); assert.match(moves.headers.get("Content-Disposition")!, /inventory-movements-/); assert.deepEqual(seen.movements, { photos: true, photoLimit: 2000 });
    assert.equal(moves.headers.get("X-Photos-Omitted"), "too-many"); // the screen can say "Narrow the filters to include photos."
    assert.deepEqual(calls, ["current", "current", "current", "pdf", "movements"]);
  }
  role = "admin_manager"; calls.length = 0;
  const bad = await currentRoute.GET(request("/api/inventory/reports/current?format=csv"));
  assert.equal(bad.status, 400); assert.equal(bad.headers.get("Cache-Control"), "no-store"); assert.ok((await bad.json() as { error: string }).error.length > 5);
  assert.equal((await movementsRoute.GET(request("/api/inventory/reports/movements?from=2026-02-31"))).status, 400);
  assert.deepEqual(calls, []);
});
