import { isWarehouseStaffRequest } from "@/lib/auth";
import type { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { requireActiveUser } from "@/lib/auth";
import { getCompanySettingsRecord } from "@/lib/company-profile";
import { resolveDocumentSetup } from "@/lib/quotations/document-setup";
import { DEFAULT_QUOTATION_NOTES, DEFAULT_QUOTATION_PDF_SETTINGS } from "@/lib/quotations/quotation-pdf-settings";
import { loadQuotationPdfSettings } from "@/lib/quotations/quotation-pdf-settings-store";
import {
  loadQuotationDerivedDocumentData,
  type DerivedDocumentItem,
  type DerivedDocumentSection,
} from "@/lib/quotations/derived-document-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Look (copied from reference-excel/Quotation-QN-0004-002-improved.xlsx) ─────────────────────

const FONT = "Arial";
const INK = "FF1A1A1A";
const GREY = "FF6B6B6B";
const LINE = "FFBFBFBF";
const BAR_GREY = "FFE6E6E6";
const BLACK = "FF000000";
const WHITE = "FFFFFFFF";

function font(size: number, extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> {
  return { name: FONT, size, color: { argb: INK }, ...extra };
}

function allBorder(color: string): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: color } };
  return { top: side, left: side, bottom: side, right: side };
}

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

// Whole numbers show as #,##0; values with decimals keep 2 decimals so nothing is hidden.
function moneyFmt(value: number) {
  return Math.abs(value - Math.round(value)) < 0.005 ? "#,##0" : "#,##0.00";
}

// Runs of consecutive rows: [20,21,22,25] -> [[20,22],[25,25]].
function rangesOf(rows: number[]): Array<[number, number]> {
  const sorted = [...rows].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const row of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && row === last[1] + 1) last[1] = row;
    else ranges.push([row, row]);
  }
  return ranges;
}

// SUM over a column using ranges for consecutive rows (J20:J23,J25).
function sumFormula(col: string, rows: number[]) {
  const ranges = rangesOf(rows);
  if (!ranges.length) return "0";
  return `SUM(${ranges.map(([a, b]) => (a === b ? `${col}${a}` : `${col}${a}:${col}${b}`)).join(",")})`;
}

// ── Route ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (await isWarehouseStaffRequest()) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  try {
    await requireActiveUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const quotationId = new URL(request.url).searchParams.get("quotationId");
  if (!quotationId) {
    return new Response("Missing quotationId", { status: 400 });
  }

  const derivedData = await loadQuotationDerivedDocumentData(quotationId);
  if (!derivedData) {
    return new Response("Quotation not found", { status: 404 });
  }

  const { quotation, client, project, companyProfile, imageUrlByItemId, sections, items } =
    derivedData;
  const currency = (quotation.currency || "AED").replace(/"/g, "");

  // ── Workbook / sheet setup ────────────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Quotation", {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      scale: 100,
      showGridLines: false,
      margins: { left: 0.4, right: 0.4, top: 0.45, bottom: 0.6, header: 0.511811023622047, footer: 0.25 },
    },
  });

  // A=S.NO B=CODE C=image D=specifications E=origin/supplier F=QTY G=U.PRICE H=DISC. AMOUNT I=NET PRICE J=NET TOTAL
  sheet.columns = [
    { width: 5 },
    { width: 7 },
    { width: 19 },
    { width: 33 },
    { width: 13 },
    { width: 5 },
    { width: 10 },
    { width: 9.01 }, // 9 is ExcelJS's default and would not be written
    { width: 10 },
    { width: 11 },
  ];

  const rowHeights: Record<number, number> = {
    1: 30, 2: 15.75, 3: 6, 4: 15.75, 5: 15, 6: 15, 7: 7.5, 8: 18, 9: 15, 10: 16.5,
    11: 15, 12: 16.5, 13: 15, 14: 16.5, 15: 9.75, 16: 24, 17: 9.75,
  };
  for (const [row, height] of Object.entries(rowHeights)) sheet.getRow(Number(row)).height = height;

  // Style first, merge after (ExcelJS copies the master's style to the merged cells at merge time).
  function put(
    address: string,
    value: ExcelJS.CellValue,
    style: {
      align?: Partial<ExcelJS.Alignment>;
      bg?: string;
      border?: Partial<ExcelJS.Borders>;
      font?: Partial<ExcelJS.Font>;
      numFmt?: string;
      merge?: string;
    },
  ) {
    const cell = sheet.getCell(address);
    cell.value = value;
    if (style.font) cell.font = style.font;
    if (style.bg) cell.fill = fill(style.bg);
    if (style.align) cell.alignment = style.align;
    if (style.border) cell.border = style.border;
    if (style.numFmt) cell.numFmt = style.numFmt;
    if (style.merge) sheet.mergeCells(style.merge);
    return cell;
  }

  // ── Rows 1-2: logo, title, ref no, date ───────────────────────────────────────
  const logoPath = path.join(process.cwd(), "public", "noa-logo.png");
  try {
    const logoBuffer = fs.readFileSync(logoPath);
    const logoId = workbook.addImage({ base64: logoBuffer.toString("base64"), extension: "png" });
    // Logo is 4116x738 (~5.58:1): fixed pixel size keeps the aspect ratio.
    sheet.addImage(logoId, { tl: { col: 0.05, row: 0.09 }, ext: { width: 201, height: 36 }, editAs: "oneCell" });
  } catch {
    put("A1", "NOA OFFICE SOLUTIONS LLC", { font: font(12, { bold: true, color: { argb: "FFCC0000" } }), align: { vertical: "middle" }, merge: "A1:C2" });
  }
  put("D1", "QUOTATION", { font: font(16, { bold: true }), align: { horizontal: "center", vertical: "middle" }, merge: "D1:G2" });
  put("H1", "REF NO.", { font: font(7, { color: { argb: GREY } }), align: { horizontal: "right", vertical: "middle" } });
  put("I1", quotation.quotation_no ?? "", { font: font(9, { bold: true }), align: { horizontal: "right", vertical: "middle" }, merge: "I1:J1" });
  put("H2", "DATE", { font: font(7, { color: { argb: GREY } }), align: { horizontal: "right", vertical: "middle" } });
  const dateMatch = String(quotation.quotation_date ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  put("I2", dateMatch ? new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))) : String(quotation.quotation_date ?? ""), {
    font: font(9, { bold: true }),
    numFmt: "yyyy-mm-dd",
    align: { horizontal: "right", vertical: "middle" },
    merge: "I2:J2",
  });

  // ── Rows 4-6: company ─────────────────────────────────────────────────────────
  const addressText =
    [companyProfile.addressLine1, companyProfile.addressLine2, companyProfile.city, companyProfile.country]
      .filter(Boolean)
      .join(", ") || companyProfile.offices.map((office) => office.location).filter(Boolean).join(" / ");
  put("A4", companyProfile.companyName || "NOA Office Solutions LLC", { font: font(10, { bold: true }), align: { horizontal: "left", vertical: "middle" }, merge: "A4:E4" });
  put("A5", addressText, { font: font(7, { color: { argb: GREY } }), align: { horizontal: "left", vertical: "middle" }, merge: "A5:E5" });
  put("A6", `TRN: ${companyProfile.trn ?? ""}`, { font: font(7, { color: { argb: GREY } }), align: { horizontal: "left", vertical: "middle" }, merge: "A6:E6" });

  // ── Rows 8-14: client & project ───────────────────────────────────────────────
  put("A8", "CLIENT & PROJECT", { font: font(8, { bold: true }), align: { horizontal: "left", vertical: "middle" }, border: { top: { style: "thin", color: { argb: LINE } } }, merge: "A8:J8" });
  const dash = (value: string | null | undefined) => (value && value.trim() ? value : "-");
  const labelStyle = { font: font(7, { color: { argb: GREY } }), align: { horizontal: "left", vertical: "bottom" } } as const;
  const valueStyle = { font: font(8, { bold: true }), align: { horizontal: "left", vertical: "top", wrapText: true } } as const;
  put("A9", "CLIENT", { ...labelStyle, merge: "A9:C9" });
  put("D9", "PROJECT / REFERENCE", { ...labelStyle, merge: "D9:E9" });
  put("F9", "LOCATION", { ...labelStyle, merge: "F9:J9" });
  put("A10", dash(client?.company_name), { ...valueStyle, merge: "A10:C10" });
  put("D10", dash(project?.project_name), { ...valueStyle, merge: "D10:E10" });
  put("F10", dash(project?.location), { ...valueStyle, merge: "F10:J10" });
  put("A11", "ATTENTION / CONTACT", { ...labelStyle, merge: "A11:C11" });
  put("D11", "TELEPHONE", { ...labelStyle, merge: "D11:E11" });
  put("F11", "PO BOX", { ...labelStyle, merge: "F11:J11" });
  put("A12", dash(project?.attention_to), { ...valueStyle, merge: "A12:C12" });
  put("D12", dash(project?.attention_mobile ?? project?.attention_landline), { ...valueStyle, merge: "D12:E12" });
  put("F12", dash(project?.po_box), { ...valueStyle, merge: "F12:J12" });
  put("A13", "PROJECT ADDRESS", { ...labelStyle, merge: "A13:J13" });
  put("A14", dash(project?.project_address), { ...valueStyle, border: { bottom: { style: "thin", color: { argb: LINE } } }, merge: "A14:J14" });

  // ── Rows 16-17: table header ──────────────────────────────────────────────────
  const headerStyle = { font: font(7, { bold: true }), bg: BAR_GREY, border: allBorder(LINE), align: { horizontal: "center", vertical: "middle", wrapText: true } } as const;
  put("A16", "S.NO", { ...headerStyle, merge: "A16:A17" });
  put("B16", "CODE", { ...headerStyle, merge: "B16:B17" });
  put("C16", "PROPOSED ITEM\nREFERENCE IMAGE", { ...headerStyle, merge: "C16:C17" });
  put("D16", "SPECIFICATIONS", { ...headerStyle, merge: "D16:D17" });
  put("E16", "ORIGIN /\nSUPPLIER", { ...headerStyle, merge: "E16:E17" });
  put("F16", "QTY", headerStyle);
  put("G16", "U.PRICE", headerStyle);
  put("H16", "DISC.\nAMOUNT", headerStyle);
  put("I16", "NET\nPRICE", headerStyle);
  put("J16", "NET TOTAL", headerStyle);
  const unitStyle = { font: font(6, { color: { argb: GREY } }), bg: BAR_GREY, border: allBorder(LINE), align: { horizontal: "center", vertical: "middle" } } as const;
  put("F17", "Pc", unitStyle);
  for (const col of ["G", "H", "I", "J"]) put(`${col}17`, currency, unitStyle);

  // ── Build section / item maps ─────────────────────────────────────────────────
  const itemsBySection = new Map<string, DerivedDocumentItem[]>();
  for (const item of items) {
    const key = item.section_id ?? "__none__";
    if (!itemsBySection.has(key)) itemsBySection.set(key, []);
    itemsBySection.get(key)!.push(item);
  }

  const subsectionsByParent = new Map<string, DerivedDocumentSection[]>();
  const mainSections: DerivedDocumentSection[] = [];
  for (const section of sections) {
    if (!section.parent_section_id) {
      mainSections.push(section);
    } else {
      const p = section.parent_section_id;
      if (!subsectionsByParent.has(p)) subsectionsByParent.set(p, []);
      subsectionsByParent.get(p)!.push(section);
    }
  }

  // ── Image cache + parallel prefetch ──────────────────────────────────────────
  type ImgMeta = { buffer: Buffer; width: number; height: number };
  const imageCache = new Map<string, ImgMeta>();

  async function fetchImageMeta(url: string): Promise<ImgMeta | null> {
    if (imageCache.has(url)) return imageCache.get(url)!;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const original = Buffer.from(await res.arrayBuffer());
      // Always re-encode to a real PNG (whatever the source format: JPEG, WebP, AVIF, GIF, SVG...), at most 600 px wide.
      // If sharp cannot decode the bytes, the image is skipped: nothing that is not a valid PNG is written to the workbook.
      const converted = await sharp(original)
        .resize({ width: 600, withoutEnlargement: true })
        .png()
        .toBuffer({ resolveWithObject: true });
      const result: ImgMeta = { buffer: converted.data, width: converted.info.width, height: converted.info.height };
      imageCache.set(url, result);
      return result;
    } catch {
      return null;
    }
  }

  const uniqueImageUrls = [
    ...new Set(
      items
        .map((item) => imageUrlByItemId.get(item.id))
        .filter((url): url is string => typeof url === "string"),
    ),
  ];
  await Promise.all(uniqueImageUrls.map(fetchImageMeta));

  // ── Item renderer ─────────────────────────────────────────────────────────────
  let currentRow = 18;
  let itemSequence = 1;
  const includedRows: number[] = []; // J cells that count toward the grand total (same rule as before)
  let includedQtyPrice = 0; // sum of qty x U.Price of included items
  let includedQtyDiscount = 0; // sum of qty x Disc. amount of included items
  const mainTotalRows: number[] = [];
  let unitRows: number[] = [];
  let unitTotal = 0;

  // Column C is stored with width 19, which Excel draws as 133 px (19 x 7 px). Rows: 1 pt = 96/72 px.
  const COL_C_PX = 133;
  const BASE_ROW_PT = 90; // fixed base height of an item row; only long text makes it taller
  const IMG_FILL = 0.8; // the image box is 80% of the cell width and of the base row height
  const IMG_BOX_W_PX = COL_C_PX * IMG_FILL;
  const IMG_BOX_H_PX = BASE_ROW_PT * (96 / 72) * IMG_FILL;
  const EMU_PER_PX = 9525;

  async function renderItem(item: DerivedDocumentItem, r: number) {
    const specParts: string[] = [];
    if (item.item_name_snapshot) specParts.push(item.item_name_snapshot);
    if (item.specification_snapshot) specParts.push(item.specification_snapshot);
    if (item.size_snapshot) specParts.push(item.size_snapshot);
    const specText = specParts.join("\n");
    const specLines = specText.split("\n").reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / 46)), 0);

    // Row height: a fixed 90 pt base that only grows when the specification text needs more (no image term, no cap).
    const imageUrl = imageUrlByItemId.get(item.id);
    const imgMeta = imageUrl ? await fetchImageMeta(imageUrl) : null;
    const rowHeight = Math.max(BASE_ROW_PT, specLines * 11.5 + 8);
    sheet.getRow(r).height = rowHeight;

    const base = { border: allBorder(LINE) };
    put(`A${r}`, String(itemSequence).padStart(2, "0"), { ...base, font: font(8), align: { horizontal: "center", vertical: "middle" } });
    put(`B${r}`, item.item_code_snapshot?.trim() ? item.item_code_snapshot : "-", { ...base, font: font(8), align: { horizontal: "center", vertical: "middle", wrapText: true } });
    put(`C${r}`, null, base);

    // Image: fitted into a FIXED box (80% of the width and of the 90 pt base row), aspect ratio kept, then centred in the
    // real cell. ExcelJS turns fractional anchors into offsets using its own scale (column width x 10000 EMU), which is far
    // smaller than the real cell, so the offsets are given in exact EMU (native anchor) instead.
    if (imgMeta) {
      const imgId = workbook.addImage({ buffer: imgMeta.buffer as unknown as ExcelJS.Buffer, extension: "png" });
      const rowPx = rowHeight * (96 / 72);
      const scale = Math.min(IMG_BOX_W_PX / imgMeta.width, IMG_BOX_H_PX / imgMeta.height, 2);
      const imgW = Math.max(1, Math.round(imgMeta.width * scale));
      const imgH = Math.max(1, Math.round(imgMeta.height * scale));
      sheet.addImage(imgId, {
        tl: {
          nativeCol: 2,
          nativeColOff: Math.round(Math.max(0, (COL_C_PX - imgW) / 2) * EMU_PER_PX),
          nativeRow: r - 1,
          nativeRowOff: Math.round(Math.max(0, (rowPx - imgH) / 2) * EMU_PER_PX),
        } as unknown as ExcelJS.Anchor,
        ext: { width: imgW, height: imgH },
        editAs: "oneCell",
      });
    }

    // D: item name (bold) on the first line, then the same description text as before.
    const descValue: ExcelJS.CellValue = item.item_name_snapshot && specParts.length > 1
      ? {
          richText: [
            { text: `${item.item_name_snapshot}\n`, font: font(8, { bold: true }) },
            { text: specParts.slice(1).join("\n"), font: font(8) },
          ],
        }
      : specText;
    put(`D${r}`, descValue, { ...base, font: font(8, { bold: Boolean(item.item_name_snapshot) && specParts.length === 1 }), align: { horizontal: "left", vertical: "middle", wrapText: true } });

    // E: brand / origin, centred (supplier when there is no brand or origin).
    const origin = [item.brand_name_snapshot, item.origin_snapshot].filter(Boolean).join(" - ") || item.supplier_name_snapshot || "-";
    put(`E${r}`, origin.toUpperCase(), { ...base, font: font(7), align: { horizontal: "center", vertical: "middle", wrapText: true } });

    put(`F${r}`, item.qty, { ...base, font: font(8), numFmt: "0", align: { horizontal: "center", vertical: "middle" } });

    // Discount per unit stays derived (no explicit field): unit price - net total / qty.
    const discount = !item.is_rate_only && item.qty > 0 ? Math.max(0, item.unit_price - item.net_total / item.qty) : 0;
    const netPrice = item.unit_price - discount;
    const netTotal = netPrice * item.qty;
    const money = { ...base, font: font(8), align: { horizontal: "right", vertical: "middle" } } as const;
    put(`G${r}`, item.unit_price, { ...money, numFmt: moneyFmt(item.unit_price) });
    put(`H${r}`, discount, { ...money, numFmt: moneyFmt(discount) });
    put(`I${r}`, { formula: `G${r}-H${r}`, result: netPrice }, { ...money, numFmt: moneyFmt(netPrice) });

    const countsInTotal = !item.is_rate_only && (item.is_optional ? item.include_in_total : true);
    if (item.is_rate_only) {
      put(`J${r}`, "RATE ONLY", { ...base, font: font(8, { italic: true, color: { argb: "FF0070C0" } }), align: { horizontal: "right", vertical: "middle" } });
    } else {
      put(`J${r}`, { formula: `I${r}*F${r}`, result: netTotal }, { ...money, font: font(8, { bold: true }), numFmt: moneyFmt(netTotal) });
    }

    if (countsInTotal) {
      includedRows.push(r);
      includedQtyPrice += item.qty * item.unit_price;
      includedQtyDiscount += item.qty * discount;
      unitRows.push(r);
      unitTotal += netTotal;
    }
    itemSequence++;
  }

  // One "SECTION SUBTOTAL" row (G:I label, value in J).
  function renderSubtotal(r: number) {
    sheet.getRow(r).height = 19.5;
    put(`G${r}`, "SECTION SUBTOTAL", { font: font(7, { bold: true }), bg: BAR_GREY, border: allBorder(LINE), align: { horizontal: "right", vertical: "middle" }, merge: `G${r}:I${r}` });
    put(`J${r}`, { formula: sumFormula("J", unitRows), result: unitTotal }, { font: font(9, { bold: true }), bg: BAR_GREY, border: allBorder(LINE), numFmt: moneyFmt(unitTotal), align: { horizontal: "right", vertical: "middle" } });
  }

  // ── Render sections ───────────────────────────────────────────────────────────
  for (const main of mainSections) {
    // Main section bar (black).
    sheet.getRow(currentRow).height = 19.5;
    put(`A${currentRow}`, main.section_title, { font: font(9, { bold: true, color: { argb: WHITE } }), bg: BLACK, border: allBorder(LINE), align: { horizontal: "center", vertical: "middle" }, merge: `A${currentRow}:J${currentRow}` });
    currentRow++;

    const subtotalRows: number[] = [];
    let mainTotal = 0;
    const directItems = itemsBySection.get(main.id) ?? [];
    const subs = subsectionsByParent.get(main.id) ?? [];

    // Items placed directly in the main section get their own subtotal.
    if (directItems.length || !subs.length) {
      unitRows = [];
      unitTotal = 0;
      for (const item of directItems) {
        await renderItem(item, currentRow);
        currentRow++;
      }
      renderSubtotal(currentRow);
      subtotalRows.push(currentRow);
      mainTotal += unitTotal;
      currentRow++;
    }

    for (const sub of subs) {
      sheet.getRow(currentRow).height = 18;
      put(`A${currentRow}`, sub.section_title, { font: font(8, { bold: true }), bg: BAR_GREY, border: allBorder(LINE), align: { horizontal: "center", vertical: "middle" }, merge: `A${currentRow}:J${currentRow}` });
      currentRow++;

      unitRows = [];
      unitTotal = 0;
      for (const item of itemsBySection.get(sub.id) ?? []) {
        await renderItem(item, currentRow);
        currentRow++;
      }
      renderSubtotal(currentRow);
      subtotalRows.push(currentRow);
      mainTotal += unitTotal;
      currentRow++;
    }

    // Main section total (black): the sum of its subtotals.
    sheet.getRow(currentRow).height = 19.5;
    put(`A${currentRow}`, `${main.section_title.toUpperCase()} TOTAL (${currency})`, { font: font(8, { bold: true, color: { argb: WHITE } }), bg: BLACK, align: { horizontal: "right", vertical: "middle" }, merge: `A${currentRow}:I${currentRow}` });
    put(`J${currentRow}`, { formula: sumFormula("J", subtotalRows), result: mainTotal }, { font: font(9, { bold: true, color: { argb: WHITE } }), bg: BLACK, numFmt: moneyFmt(mainTotal), align: { horizontal: "right", vertical: "middle" } });
    mainTotalRows.push(currentRow);
    currentRow++;
    sheet.getRow(currentRow).height = 7.5;
    currentRow++;
  }

  // ── Summary page (own final page) ─────────────────────────────────────────────
  // One thin empty row after the last main total, then a manual page break.
  const spacerRow = currentRow - 1;
  sheet.getRow(spacerRow).height = 8;
  sheet.getRow(spacerRow).addPageBreak();
  // About 14pt of air above the first card.
  sheet.getRow(currentRow).height = 14;
  currentRow++;

  const vatRate = quotation.vat_percent / 100;
  const round2 = (value: number) => Math.round(value * 100 + 1e-9) / 100;
  const tidy = (value: number) => Math.round(value * 1e6) / 1e6;
  const setup = resolveDocumentSetup({ client: client ?? null, project: project ?? null, quotation });
  const dashText = (value: string | null | undefined) => (value && value.trim() ? value.trim() : "-");

  const colIndex = (letters: string) => letters.charCodeAt(0) - 64;
  const forEachCell = (range: string, apply: (cell: ExcelJS.Cell, row: number, col: number) => void) => {
    const [a, b] = range.split(":");
    const [, c1, r1] = a.match(/([A-Z]+)(\d+)/)!;
    const [, c2, r2] = b.match(/([A-Z]+)(\d+)/)!;
    for (let r = Number(r1); r <= Number(r2); r++) for (let c = colIndex(c1); c <= colIndex(c2); c++) apply(sheet.getCell(r, c), r, c);
  };
  const lightSide: Partial<ExcelJS.Border> = { style: "thin", color: { argb: LINE } };
  // Outline of a card (every edge cell, so merged cells draw it too).
  const box = (range: string, color: string) => {
    const [a, b] = range.split(":");
    const [, c1, r1] = a.match(/([A-Z]+)(\d+)/)!;
    const [, c2, r2] = b.match(/([A-Z]+)(\d+)/)!;
    const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: color } };
    forEachCell(range, (cell, r, c) => {
      cell.border = {
        ...cell.border,
        ...(r === Number(r1) ? { top: side } : {}),
        ...(r === Number(r2) ? { bottom: side } : {}),
        ...(c === colIndex(c1) ? { left: side } : {}),
        ...(c === colIndex(c2) ? { right: side } : {}),
      };
    });
  };
  // Thin light-grey line under a range (title rows and row dividers).
  const underline = (range: string) => forEachCell(range, (cell) => { cell.border = { ...cell.border, bottom: lightSide }; });

  // Overall discount (same maths as lib/local/quotation-workspace.ts): percent of the net total, or a fixed amount,
  // never more than the net total. Only shown when the quotation has one.
  const overallType = quotation.overall_discount_type ?? setup.commercial.overallDiscountType;
  const overallValue = Number(quotation.overall_discount_value ?? setup.commercial.overallDiscountValue ?? 0);
  const hasOverall = overallValue > 0;
  const isPercentOverall = overallType === "percent";

  const rightRowCount = 4 + (hasOverall ? 1 : 0) + 2; // total, item discount, net, [overall], VAT, final (2 rows)
  const cardRows = Math.max(6, rightRowCount);
  const top = currentRow; // title row of both cards
  const rowOf = (index: number) => top + 1 + index; // index 0 = first row under the titles
  // The two cards share rows, so every shared row is 24pt (terms pairs and totals rows both read well at that height).
  sheet.getRow(top).height = 24;
  for (let i = 0; i < cardRows; i++) sheet.getRow(rowOf(i)).height = 24;

  const cardLabel = { font: font(7.5, { color: { argb: GREY } }), align: { horizontal: "left", vertical: "bottom", indent: 1 } } as const;
  const cardValue = { font: font(10, { bold: true }), align: { horizontal: "left", vertical: "top", wrapText: true, indent: 1 } } as const;
  const titleStyle = { font: font(10, { bold: true }), bg: "FFF2F2F2", align: { horizontal: "left", vertical: "middle", indent: 1 } } as const;

  // Left card (A:D): COMMERCIAL TERMS, 3 rows of label/value pairs.
  put(`A${top}`, "COMMERCIAL TERMS", { ...titleStyle, merge: `A${top}:D${top}` });
  underline(`A${top}:D${top}`);
  const pairs: Array<[[string, string | null], [string, string | number | null]]> = [
    [["PAYMENT TERMS", setup.commercial.paymentTerms], ["VALIDITY", setup.commercial.validity]],
    [["WARRANTY", setup.commercial.warrantyTerms], ["DELIVERY TERMS", setup.commercial.deliveryTerms]],
    [["CURRENCY", setup.commercial.currency || currency], ["VAT", vatRate]],
  ];
  let vatRateCell = "";
  pairs.forEach(([left, right], index) => {
    const labelRow = rowOf(index * 2), valueRow = labelRow + 1;
    put(`A${labelRow}`, left[0], { ...cardLabel, merge: `A${labelRow}:C${labelRow}` });
    put(`D${labelRow}`, right[0], cardLabel);
    put(`A${valueRow}`, dashText(left[1]), { ...cardValue, merge: `A${valueRow}:C${valueRow}` });
    if (typeof right[1] === "number") {
      put(`D${valueRow}`, right[1], { ...cardValue, numFmt: "0.##%" });
      vatRateCell = `$D$${valueRow}`;
    } else {
      put(`D${valueRow}`, dashText(right[1]), cardValue);
    }
  });

  // Right card (F:J, column E is the gap): SUMMARY / TOTALS, labels F:H, values I:J.
  put(`F${top}`, "SUMMARY / TOTALS", { ...titleStyle, merge: `F${top}:J${top}` });
  underline(`F${top}:J${top}`);
  const totalPrice = tidy(includedQtyPrice);
  const itemDiscount = tidy(includedQtyDiscount);
  const netTotal = tidy(totalPrice - itemDiscount);
  const overallDiscount = hasOverall
    ? round2(Math.min(isPercentOverall ? (netTotal * Math.min(Math.max(overallValue, 0), 100)) / 100 : Math.max(overallValue, 0), netTotal))
    : 0;
  const netAfterDiscount = tidy(netTotal - overallDiscount);
  const vatAmount = round2(netAfterDiscount * vatRate);
  const finalTotal = tidy(netAfterDiscount + vatAmount);

  let index = 0;
  const summaryRow = (label: string, value: ExcelJS.CellValue, result: number) => {
    const r = rowOf(index++);
    put(`F${r}`, label, { font: font(9), align: { horizontal: "left", vertical: "middle", indent: 1 }, merge: `F${r}:H${r}` });
    put(`I${r}`, value, { font: font(10, { bold: true }), numFmt: moneyFmt(result), align: { horizontal: "right", vertical: "middle", indent: 1 }, merge: `I${r}:J${r}` });
    underline(`F${r}:J${r}`);
    return `I${r}`;
  };

  // Formulas use ONLY the included item rows (same rule as the section sums), as one SUMPRODUCT per run of rows.
  const productSum = (colA: string, colB: string) => {
    const ranges = rangesOf(includedRows);
    return ranges.length ? ranges.map(([a, b]) => `SUMPRODUCT(${colA}${a}:${colA}${b},${colB}${a}:${colB}${b})`).join("+") : "0";
  };
  const totalFormula = productSum("F", "G");
  const discountFormula = productSum("F", "H");
  const tooLong = totalFormula.length > 7000 || discountFormula.length > 7000;

  const totalCell = summaryRow(`Total Price (${currency})`, tooLong ? totalPrice : { formula: totalFormula, result: totalPrice }, totalPrice);
  const discountCell = summaryRow(`Item Discount (${currency})`, tooLong ? itemDiscount : { formula: discountFormula, result: itemDiscount }, itemDiscount);
  // With very long quotations the two long formulas above are written as values and the net total sums the main totals.
  const netCell = summaryRow(`Net Total, excl. VAT (${currency})`, { formula: tooLong ? sumFormula("J", mainTotalRows) : `${totalCell}-${discountCell}`, result: netTotal }, netTotal);
  let overallCell: string | null = null;
  if (hasOverall) {
    const cap = isPercentOverall ? `ROUND(${netCell}*${Math.min(Math.max(overallValue, 0), 100)}/100,2)` : `${Math.max(overallValue, 0)}`;
    overallCell = summaryRow(
      isPercentOverall ? `Overall Discount ${overallValue}% (${currency})` : `Overall Discount (${currency})`,
      { formula: `MIN(${cap},${netCell})`, result: overallDiscount },
      overallDiscount,
    );
  }
  const afterDiscount = overallCell ? `(${netCell}-${overallCell})` : netCell;
  const vatCell = summaryRow(`VAT ${quotation.vat_percent}% (${currency})`, { formula: `ROUND(${afterDiscount}*${vatRateCell},2)`, result: vatAmount }, vatAmount);

  // Final Total: black box, two rows tall (the only black element on this page besides the main totals above).
  const finalRow = rowOf(index);
  put(`F${finalRow}`, `Final Total (${currency})`, { font: font(12, { bold: true, color: { argb: WHITE } }), bg: BLACK, align: { horizontal: "left", vertical: "middle", indent: 1 }, merge: `F${finalRow}:H${finalRow + 1}` });
  put(`I${finalRow}`, { formula: `${afterDiscount}+${vatCell}`, result: finalTotal }, { font: font(14, { bold: true, color: { argb: WHITE } }), bg: BLACK, numFmt: moneyFmt(finalTotal), align: { horizontal: "right", vertical: "middle", indent: 1 }, merge: `I${finalRow}:J${finalRow + 1}` });
  for (const col of ["G", "H", "J"]) {
    sheet.getCell(`${col}${finalRow}`).fill = fill(BLACK);
    sheet.getCell(`${col}${finalRow + 1}`).fill = fill(BLACK);
  }
  sheet.getCell(`F${finalRow + 1}`).fill = fill(BLACK);
  sheet.getCell(`I${finalRow + 1}`).fill = fill(BLACK);
  box(`A${top}:D${top + cardRows}`, LINE);
  box(`F${top}:J${top + cardRows}`, LINE);

  // ── Notes (left) and closing box (right) ───────────────────────────────────────
  // Same resolution as the PDF: notesOverride → document setup note → company default → built-in default.
  const pdfSettingsResult = await loadQuotationPdfSettings(quotationId).catch(() => null);
  const pdfSettings = pdfSettingsResult && pdfSettingsResult.success ? pdfSettingsResult.settings : DEFAULT_QUOTATION_PDF_SETTINGS;
  const companyRecord = await getCompanySettingsRecord().catch(() => null);
  const resolvedNotes =
    pdfSettings.notesOverride?.trim() ||
    setup.notes.clientIntroNote ||
    companyRecord?.default_quotation_notes?.trim() ||
    DEFAULT_QUOTATION_NOTES;
  const noteLines = resolvedNotes
    .split("\n")
    .map((line) => line.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter(Boolean);

  const notesHeader = top + cardRows + 2;
  sheet.getRow(top + cardRows + 1).height = 14;
  // The box fits the notes; at least 6 rows so the closing box (right) has room for its signature block.
  const noteSlots = Math.max(6, noteLines.length);
  sheet.getRow(notesHeader).height = 24;
  put(`A${notesHeader}`, "NOTES", { ...titleStyle, merge: `A${notesHeader}:D${notesHeader}` });
  underline(`A${notesHeader}:D${notesHeader}`);
  const notesEnd = notesHeader + noteSlots;
  for (let i = 0; i < noteSlots; i++) {
    const r = notesHeader + 1 + i;
    const text = noteLines[i] ? `•  ${noteLines[i]}` : "";
    sheet.getRow(r).height = Math.max(30, Math.ceil(text.length / 85) * 12 + 6);
    put(`A${r}`, text, { font: font(9), align: { horizontal: "left", vertical: "middle", wrapText: true, indent: 1 }, merge: `A${r}:D${r}` });
  }
  box(`A${notesHeader}:D${notesEnd}`, LINE);

  // Closing box (F:J): text and "Yours faithfully," at the top, signature block at the bottom with ~40pt of space above the line.
  put(`F${notesHeader}`, "Assuring you of our best cooperation we remain,", { font: font(10), align: { horizontal: "left", vertical: "top", wrapText: true, indent: 1 }, merge: `F${notesHeader}:J${notesHeader + 1}` });
  put(`F${notesHeader + 2}`, "Yours faithfully,", { font: font(10, { bold: true }), align: { horizontal: "left", vertical: "top", indent: 1 }, merge: `F${notesHeader + 2}:J${notesHeader + 2}` });
  const namesRow = notesEnd - 2;
  const spaceRow = notesEnd - 1;
  const captionRow = notesEnd;
  sheet.getRow(spaceRow).height = Math.max(sheet.getRow(spaceRow).height ?? 30, 40);
  put(`F${namesRow}`, pdfSettings.closingPreparedName?.trim() || "NOA OFFICES", { font: font(7.5, { bold: true, color: { argb: GREY } }), align: { horizontal: "left", vertical: "bottom", indent: 1 }, merge: `F${namesRow}:G${namesRow}` });
  put(`H${namesRow}`, "FOR APPROVAL", { font: font(7.5, { bold: true, color: { argb: GREY } }), align: { horizontal: "left", vertical: "bottom", indent: 1 }, merge: `H${namesRow}:J${namesRow}` });
  put(`F${captionRow}`, "Prepared by", { font: font(7.5, { color: { argb: GREY } }), align: { horizontal: "left", vertical: "top", indent: 1 }, merge: `F${captionRow}:G${captionRow}` });
  put(`H${captionRow}`, "Authorized signature / stamp", { font: font(7.5, { color: { argb: GREY } }), align: { horizontal: "left", vertical: "top", indent: 1 }, merge: `H${captionRow}:J${captionRow}` });
  const lineSide: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF999999" } };
  for (const col of ["F", "G", "H", "I", "J"]) {
    const cell = sheet.getCell(`${col}${captionRow}`);
    cell.border = { ...cell.border, top: lineSide };
  }
  box(`F${notesHeader}:J${notesEnd}`, LINE);

  // ── Page footer (all pages) ───────────────────────────────────────────────────
  const footerLeft = companyProfile.companyName || "NOA Office Solutions LLC";
  const footerCentre = [companyProfile.city || "Dubai / Abu Dhabi", companyProfile.phone || "+971 4 3809234", companyProfile.email || "info@noaoffices.com"].join(" | ");
  const footerRight = companyProfile.website || "www.noaoffices.com";
  const footerText = (value: string) => value.replace(/&/g, "&&");
  sheet.headerFooter.oddFooter =
    `&L&"Arial,Regular"&7 ${footerText(footerLeft)}` +
    `&C&"Arial,Regular"&7 ${footerText(footerCentre)}` +
    `&R&"Arial,Regular"&7 ${footerText(footerRight)} | Page &P`;

  // ── Print area ────────────────────────────────────────────────────────────────
  sheet.pageSetup.printArea = `A1:J${notesEnd}`;

  // ── Response ──────────────────────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();
  const qno = (quotation.quotation_no ?? "Draft").replace(/[\\/:*?"<>|]/g, "-");
  const filename = `Quotation-${qno}.xlsx`;

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Filename": filename,
    },
  });
}
