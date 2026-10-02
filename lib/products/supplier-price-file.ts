import type { RawSupplierRow } from "./supplier-price-contracts";

function records(headers: string[], values: unknown[][], sheet: string, physicalRows?: number[]): RawSupplierRow[] {
  if (!headers.length || headers.some((header) => !header) || new Set(headers).size !== headers.length) throw Error("Headers must be non-empty unique text.");
  return values.map((row, index) => ({ unit_key: JSON.stringify([sheet, physicalRows?.[index] ?? index + 2]), row_number: physicalRows?.[index] ?? index + 2, sheet, values: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? null])) })).filter((row) => Object.values(row.values).some((value) => value !== null && value !== ""));
}
export function parseSupplierCsv(text: string): RawSupplierRow[] {
  const rows: string[][] = []; const physicalRows: number[] = []; let line = 1; let rowStart = 1; let row: string[] = []; let value = ""; let quoted = false; let afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (afterQuote && ![",", "\r", "\n"].includes(c)) throw Error("Malformed CSV closing quote.");
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else if (!quoted && value) throw Error("Malformed CSV quote."); else { afterQuote = quoted; quoted = !quoted; } }
    else if (c === "," && !quoted) { row.push(value); value = ""; afterQuote = false; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(value); rows.push(row); physicalRows.push(rowStart); row = []; value = ""; afterQuote = false; line++; rowStart = line; }
    else if (c === "\n" || c === "\r") { value += c; if (c === "\n" || text[i + 1] !== "\n") line++; }
    else value += c;
  }
  if (quoted) throw Error("Unclosed CSV quote.");
  if (row.length || value) { row.push(value); rows.push(row); physicalRows.push(rowStart); }
  const headers = rows.shift()?.map((header) => header.replace(/^\uFEFF/, "").trim()) ?? [];
  physicalRows.shift();
  return records(headers, rows, "CSV", physicalRows);
}
export function parseSupplierJson(text: string): RawSupplierRow[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw Error("JSON source must be an array of records.");
  return data.map((values, index) => ({ unit_key: JSON.stringify(["JSON", index + 1]), row_number: index + 1, sheet: "JSON", values: values as Record<string, unknown> }));
}
export async function parseSupplierFile(file: File, sheetNames?: string[]): Promise<RawSupplierRow[]> {
  if (file.size > 40_000_000) throw Error("Source file exceeds 40 MB.");
  const type = file.name.split(".").pop()?.toLowerCase();
  if (type === "csv") return parseSupplierCsv(await file.text());
  if (type === "json") return parseSupplierJson(await file.text());
  if (type !== "xlsx") throw Error("Use XLSX, CSV or structured JSON. PDF extraction is not supported.");
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  if (sheetNames?.some((name) => !workbook.getWorksheet(name))) throw Error("A configured source sheet is missing.");
  const rows: RawSupplierRow[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheetNames && !sheetNames.includes(sheet.name)) continue;
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((value) => typeof value === "string" ? value.trim() : "");
    const values: unknown[][] = [];
    for (let i = 2; i <= sheet.rowCount; i++) values.push(headers.map((_header, column) => {
      const value = sheet.getRow(i).getCell(column + 1).value;
      // Retain typed/formula values rather than fabricating text codes or trusting cached formulas.
      return value ?? null;
    }));
    rows.push(...records(headers, values, sheet.name));
  }
  return rows;
}
