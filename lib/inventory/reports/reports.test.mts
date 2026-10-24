import assert from "node:assert/strict";
import test, { mock } from "node:test";
import ExcelJS from "exceljs";
import { CURRENT_HEADERS, buildCurrentInventoryPdfHtml, buildCurrentInventoryWorkbook, currentFilterLines, currentTotals, reportPdfOptions, type CurrentInventoryRow } from "./current-inventory";
import { dubaiDateKey, dubaiDayBounds, escapeHtml, excelDubaiDate, formatDubaiDateTime, isValidDateKey, reportFileName, safeCell, shiftDateKey } from "./format";
import { MOVEMENT_HEADERS, MOVEMENT_REPORT_LIMIT, NARROW_RANGE_MESSAGE, ReportTooLargeError, buildMovementsWorkbook, movementReportRow } from "./movements-report";
import { defaultMovementRange, parseCurrentInventoryParams, parseMovementReportParams } from "./params";
import { currentReportUrl, downloadName, movementsReportUrl } from "./urls";
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
test("every query parameter is checked against an allow-list", () => {
  assert.equal(parseCurrentInventoryParams(new URLSearchParams("format=pdf&itemType=accessory&location=sold&status=hold&soldOut=1&photos=1")).ok, true);
  for (const params of ["format=csv", "itemType=gadget", "location=moon", "status=bogus", "brand=not-a-uuid", "category=1%27%20or%201=1"]) assert.equal(parseCurrentInventoryParams(new URLSearchParams(params)).ok, false, params);
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(parseMovementReportParams(new URLSearchParams(`action=hack`)).ok, false);
  assert.equal(parseMovementReportParams(new URLSearchParams(`product=x`)).ok, false);
  assert.equal(parseMovementReportParams(new URLSearchParams(`product=${id.toUpperCase()}&action=sale&location=warehouse&person=Alex`)).ok, true);
  const parsed = parseCurrentInventoryParams(new URLSearchParams("brand=" + id.toUpperCase())); assert.ok(parsed.ok); assert.equal(parsed.value.brand, id);
  assert.equal(parseCurrentInventoryParams(new URLSearchParams("")).ok, true);
});
test("report links carry only the chosen filters", () => {
  const filters = { brand: "", category: "", itemType: "accessory" as const, location: "warehouse" as const, status: "" as const, includeSoldOut: true, photos: true };
  assert.equal(currentReportUrl(filters, "xlsx"), "/api/inventory/reports/current?format=xlsx&itemType=accessory&location=warehouse&soldOut=1");
  assert.equal(currentReportUrl(filters, "pdf"), "/api/inventory/reports/current?format=pdf&itemType=accessory&location=warehouse&soldOut=1&photos=1");
  assert.equal(movementsReportUrl({ from: "2026-10-01", to: "2026-10-31", product: "", action: "sale", location: "", person: " Alex " }), "/api/inventory/reports/movements?from=2026-10-01&to=2026-10-31&action=sale&person=Alex");
  assert.equal(downloadName("attachment; filename=\"a.xlsx\"; filename*=UTF-8''b%20c.xlsx", "x"), "b c.xlsx");
  assert.equal(downloadName(null, "fallback.pdf"), "fallback.pdf");
});
test("formula injection: text that starts like a formula is stored with a leading apostrophe", () => {
  for (const text of ["=1+1", "+SUM(A1)", "-5+2", "@cmd", "\t=1", "\r=1", "=HYPERLINK(\"http://x\",\"y\")"]) assert.equal(safeCell(text), `'${text}`);
  for (const text of ["Arlo chair", "", "10 - 20", "a=b", "CHR-042"]) assert.equal(safeCell(text), text);
  assert.equal(safeCell(null), ""); assert.equal(safeCell(undefined), "");
});
test("Current inventory workbook: columns, real numbers, totals, frozen bold header, filter, widths", async () => {
  const rows = [row(), row({ stock_ref: "02-0002", item_name: "=HYPERLINK(\"http://evil\",\"Click\")", item_code: null, model_name: null, warehouse: 5, dubai_showroom: 0, abudhabi_showroom: 0, temporary_out: 0, total_live: 5, reserved: 0, available: 5, sold: 0, item_type: "accessory", status: "showroom" })];
  const workbook = await read(await buildCurrentInventoryWorkbook(rows, meta)), sheet = workbook.getWorksheet("Current inventory")!;
  assert.ok(sheet);
  assert.deepEqual((sheet.getRow(1).values as string[]).slice(1), CURRENT_HEADERS);
  assert.deepEqual(CURRENT_HEADERS, ["Stock ref", "Item code", "Item name", "Model", "Brand", "Category", "Subcategory", "Type", "Status", "Condition", "Warehouse", "Dubai Showroom", "Abu Dhabi Showroom", "Mockup", "Temporary Out", "Total live", "Reserved", "Available", "Sold (cumulative)"]);
  assert.equal(sheet.getRow(1).font?.bold, true);
  assert.equal(sheet.views[0].state, "frozen"); assert.equal((sheet.views[0] as { ySplit?: number }).ySplit, 1);
  assert.ok(sheet.autoFilter); assert.ok(sheet.getColumn(3).width! >= 30);
  const first = sheet.getRow(2);
  assert.equal(first.getCell(11).value, 10); assert.equal(typeof first.getCell(11).value, "number"); assert.equal(first.getCell(8).value, "Product"); assert.equal(first.getCell(9).value, "Available");
  assert.equal(typeof first.getCell(19).value, "number");
  const dangerous = sheet.getRow(3).getCell(3).value;
  assert.equal(typeof dangerous, "string"); assert.ok((dangerous as string).startsWith("'=HYPERLINK")); // never a formula
  assert.equal(sheet.getRow(3).getCell(8).value, "Accessory");
  const totals = sheet.getRow(4);
  assert.equal(totals.font?.bold, true); assert.equal(totals.getCell(3).value, "Total (2 items)");
  assert.deepEqual([11, 12, 13, 14, 15, 16, 17, 18, 19].map(column => totals.getCell(column).value), [15, 3, 2, 0, 1, 21, 4, 17, 8]);
  for (let r = 1; r <= 4; r++) sheet.getRow(r).eachCell(cell => assert.equal(typeof cell.value === "object" && cell.value !== null && "formula" in (cell.value as object), false));
});
test("Current inventory: totals, empty result and filter lines", async () => {
  assert.deepEqual(Object.values(currentTotals([row(), row()])), [20, 6, 4, 0, 2, 32, 8, 24, 16]);
  assert.deepEqual(Object.values(currentTotals([])), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const empty = (await read(await buildCurrentInventoryWorkbook([], meta))).getWorksheet("Current inventory")!;
  assert.equal(empty.rowCount, 2); assert.equal(empty.getRow(2).getCell(3).value, "Total (0 items)");
  const lines = currentFilterLines({ brand: "b", category: "", itemType: "accessory", location: "warehouse", status: "", includeSoldOut: false, photos: false }, { brand: "Nora Office" });
  assert.deepEqual(lines, ["Brand: Nora Office", "Type: Accessory", "Location: Warehouse (more than 0 units)", "Sold-out items left out"]);
});
test("no report contains prices or costs", async () => {
  const bad = /(price|costs?|vat|labour|freight|duty|transport|c ?& ?f)/i;
  for (const header of [...CURRENT_HEADERS, ...MOVEMENT_HEADERS]) assert.doesNotMatch(header, bad, header);
  const html = buildCurrentInventoryPdfHtml([row()], meta, { photos: false });
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ""), bad);
});
test("Movements workbook: plain-words actions, Dubai dates, real numbers, notes wrap", async () => {
  const items = [movement(), movement({ id: "m2", action_type: "sale", movement_type: "stock_out", from_location: "warehouse", to_location: "sold", quantity: 2, previous_quantity: 17, new_quantity: 15, note: "=cmd|' /C calc'!A0", linked: null, actor_display_name: "+Pat", product: null })];
  const sheet = (await read(await buildMovementsWorkbook(items, { generatedAt: meta.generatedAt, filterLines: [] }))).getWorksheet("Movements")!;
  assert.deepEqual((sheet.getRow(1).values as string[]).slice(1), MOVEMENT_HEADERS);
  assert.deepEqual(MOVEMENT_HEADERS, ["Date and time (Dubai time)", "Stock ref", "Item name", "Action", "From", "To", "Quantity", "Total before", "Total after", "Note", "Done by", "Linked request or reservation"]);
  const first = sheet.getRow(2);
  assert.ok(first.getCell(1).value instanceof Date); assert.equal((first.getCell(1).value as Date).toISOString(), "2026-10-25T02:30:00.000Z"); assert.equal(first.getCell(1).numFmt, "dd mmm yyyy hh:mm");
  assert.deepEqual([4, 5, 6, 11, 12].map(column => first.getCell(column).value), ["Moved", "Warehouse", "Dubai Showroom", "Alex Morgan", "Stock request"]);
  assert.deepEqual([7, 8, 9].map(column => first.getCell(column).value), [3, 17, 17]);
  const second = sheet.getRow(3);
  assert.equal(second.getCell(4).value, "Sold"); assert.equal(second.getCell(3).value, "Unknown product");
  assert.ok((second.getCell(10).value as string).startsWith("'=cmd")); assert.ok((second.getCell(11).value as string).startsWith("'+Pat"));
  assert.equal(sheet.getColumn(10).alignment?.wrapText, true); assert.equal(sheet.getRow(1).font?.bold, true); assert.equal(sheet.views[0].state, "frozen"); assert.ok(sheet.autoFilter);
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
  assert.equal(empty.rowCount, 1);
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
const calls: string[] = [];
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/auth", { namedExports: { requireInventoryUser: async () => ({ profile: { role }, user: { id: "u" } }) } });
mock.module("@/lib/inventory/queries", { namedExports: {
  listCurrentInventoryReport: async () => { calls.push("current"); return { rows: [row()], brandName: null, categoryName: null }; },
  listMovementsForReport: async () => { calls.push("movements"); return [movement()]; },
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
test("report routes: managers get files with no-store headers, bad input gets a plain 400", async () => {
  for (const manager of ["system_owner", "admin_manager"]) {
    role = manager; calls.length = 0;
    const xlsx = await currentRoute.GET(request("/api/inventory/reports/current?format=xlsx"));
    assert.equal(xlsx.status, 200); assert.equal(xlsx.headers.get("Cache-Control"), "no-store"); assert.match(xlsx.headers.get("Content-Type")!, /spreadsheetml/); assert.match(xlsx.headers.get("Content-Disposition")!, /inventory-current-\d{4}-\d{2}-\d{2}\.xlsx/);
    assert.equal((await read(Buffer.from(await xlsx.arrayBuffer()))).worksheets.length, 1);
    const pdf = await currentRoute.GET(request("/api/inventory/reports/current?format=pdf"));
    assert.equal(pdf.status, 200); assert.equal(pdf.headers.get("Content-Type"), "application/pdf"); assert.match(pdf.headers.get("Content-Disposition")!, /\.pdf/);
    const moves = await movementsRoute.GET(request("/api/inventory/reports/movements"));
    assert.equal(moves.status, 200); assert.match(moves.headers.get("Content-Disposition")!, /inventory-movements-/);
    assert.deepEqual(calls, ["current", "current", "pdf", "movements"]);
  }
  role = "admin_manager"; calls.length = 0;
  const bad = await currentRoute.GET(request("/api/inventory/reports/current?format=csv"));
  assert.equal(bad.status, 400); assert.equal(bad.headers.get("Cache-Control"), "no-store"); assert.ok((await bad.json() as { error: string }).error.length > 5);
  assert.equal((await movementsRoute.GET(request("/api/inventory/reports/movements?from=2026-02-31"))).status, 400);
  assert.deepEqual(calls, []);
});
