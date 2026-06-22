import type { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { requireActiveUser } from "@/lib/auth";
import {
  loadQuotationDerivedDocumentData,
  type DerivedDocumentItem,
  type DerivedDocumentSection,
} from "@/lib/quotations/derived-document-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

const DARK = "FF2D2D2D";
const WHITE = "FFFFFFFF";
const HDR_BORDER = "FF888888";

function allBorder(color: string): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = {
    style: "thin",
    color: { argb: color },
  };
  return { top: side, left: side, bottom: side, right: side };
}

function darkCell(cell: ExcelJS.Cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
  cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.border = allBorder(HDR_BORDER);
}

function solidFill(
  cell: ExcelJS.Cell,
  argb: string,
  fontColor = DARK,
) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb } };
  cell.font = { bold: true, color: { argb: fontColor }, size: 10 };
}

// ── Route ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
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

  // ── Workbook / sheet setup ────────────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("QUOTATION", {
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      scale: 85,
    },
  });

  sheet.pageSetup.margins = {
    left: 0.55,
    right: 0.45,
    top: 0.65,
    bottom: 0.65,
    header: 0.3,
    footer: 0.3,
  };

  // Col A widened to 12 to avoid "P.O. BOX :" / "PROJECT :" truncation
  sheet.columns = [
    { width: 12 },
    { width: 22 },
    { width: 42 },
    { width: 5 },
    { width: 11 },
    { width: 11 },
    { width: 11 },
    { width: 14 },
  ];

  // ── Row 1: Logo (or company name fallback) + Ref No ───────────────────────────
  // Row height 26 matches the 32px image height at Excel's ~96dpi scale.
  sheet.getRow(1).height = 26;
  const logoPath = path.join(process.cwd(), "public", "noa-logo.png");
  try {
    const logoBuffer = fs.readFileSync(logoPath);
    const logoId = workbook.addImage({
      base64: logoBuffer.toString("base64"),
      extension: "png",
    });
    // Use ImagePosition (tl + ext) to fix aspect ratio — logo is 4116×738 (~5.58:1).
    // ext gives exact pixel dimensions so Excel doesn't stretch to fit cell boundaries.
    sheet.addImage(logoId, {
      tl: { col: 0, row: 0 },
      ext: { width: 180, height: 32 },
      editAs: "oneCell",
    });
  } catch {
    // Logo file missing — fall back to text
    sheet.mergeCells("A1:E1");
    const a1 = sheet.getCell("A1");
    a1.value = "NOA OFFICE SOLUTIONS LLC";
    a1.font = { bold: true, color: { argb: "FFCC0000" }, size: 12, name: "Arial" };
  }

  const h1 = sheet.getCell("H1");
  h1.value = `REF.NO: ${quotation.quotation_no ?? ""}`;
  h1.font = { size: 9 };
  h1.alignment = { horizontal: "right" };

  // ── Row 2: Date ───────────────────────────────────────────────────────────────
  sheet.getRow(2).height = 14;
  const h2 = sheet.getCell("H2");
  h2.value = fmtDate(quotation.quotation_date);
  h2.font = { size: 9 };
  h2.alignment = { horizontal: "right" };

  // ── Row 3: Spacer ─────────────────────────────────────────────────────────────
  sheet.getRow(3).height = 5;

  // ── Row 4: Document title ─────────────────────────────────────────────────────
  sheet.getRow(4).height = 22;
  sheet.mergeCells("A4:H4");
  const a4 = sheet.getCell("A4");
  a4.value = "OFFICE FURNITURE - COMMERCIAL PROPOSAL";
  a4.font = { bold: true, size: 13, name: "Arial" };

  // ── Row 5: Spacer ─────────────────────────────────────────────────────────────
  sheet.getRow(5).height = 5;

  // ── Rows 6-10: Client block ───────────────────────────────────────────────────
  const clientBlock: [string, string | null | undefined][] = [
    ["M/S :", client?.company_name],
    ["PROJECT :", project?.project_name],
    ["ATTN :", project?.attention_to],
    ["P.O. BOX :", project?.po_box],
    ["TEL :", project?.attention_mobile],
  ];
  clientBlock.forEach(([label, value], i) => {
    const n = 6 + i;
    sheet.getRow(n).height = 15;
    sheet.mergeCells(`B${n}:H${n}`);
    const lbl = sheet.getCell(`A${n}`);
    lbl.value = label;
    lbl.font = { bold: true, size: 10 };
    const val = sheet.getCell(`B${n}`);
    val.value = value ?? "";
    val.font = { size: 10 };
  });

  // ── Row 11: Spacer ────────────────────────────────────────────────────────────
  sheet.getRow(11).height = 7;

  // ── Row 12: Column headers ────────────────────────────────────────────────────
  sheet.getRow(12).height = 20;
  [
    "S.No",
    "Image",
    "Specification",
    "Qty",
    "U.Price",
    "Discount",
    "Net Price",
    "Net Total",
  ].forEach((h, i) => {
    darkCell(sheet.getCell(12, i + 1));
    sheet.getCell(12, i + 1).value = h;
  });

  // ── Row 13: Unit sub-headers ──────────────────────────────────────────────────
  sheet.getRow(13).height = 14;
  ["", "", "", "Pc", "AED", "AED", "AED", "AED"].forEach((h, i) => {
    darkCell(sheet.getCell(13, i + 1));
    sheet.getCell(13, i + 1).value = h;
  });

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
      const buffer = Buffer.from(await res.arrayBuffer());
      let width = 80;
      let height = 80;
      try {
        const meta = await sharp(buffer).metadata();
        width = meta.width ?? 80;
        height = meta.height ?? 80;
      } catch {
        // sharp failed — fall back to square
      }
      const result: ImgMeta = { buffer, width, height };
      imageCache.set(url, result);
      return result;
    } catch {
      return null;
    }
  }

  // Prefetch all item images in parallel before the render loop
  const uniqueImageUrls = [
    ...new Set(
      items
        .map((item) => imageUrlByItemId.get(item.id))
        .filter((url): url is string => typeof url === "string"),
    ),
  ];
  await Promise.all(uniqueImageUrls.map(fetchImageMeta));

  // ── Item renderer ─────────────────────────────────────────────────────────────
  let currentRow = 14;
  let itemSequence = 1;
  let altIdx = 0;
  const netTotalCells: string[] = [];
  let sectionNetTotalCells: string[] = [];

  const ITEM_BORDER = "FFCCCCCC";

  async function renderItem(item: DerivedDocumentItem, r: number) {
    const bg = altIdx % 2 === 0 ? "FFFFFFFF" : "FFF5F5F5";

    function styleCell(cell: ExcelJS.Cell) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.border = allBorder(ITEM_BORDER);
    }

    // A: serial number
    const ca = sheet.getCell(r, 1);
    ca.value = String(itemSequence).padStart(2, "0");
    styleCell(ca);
    ca.alignment = { horizontal: "center", vertical: "middle" };

    // ── Spec text (computed early so rowHeight can be set before image placement) ──
    const specParts: string[] = [];
    if (item.item_name_snapshot) specParts.push(item.item_name_snapshot);
    const bo = [item.brand_name_snapshot, item.origin_snapshot]
      .filter(Boolean)
      .join(" / ");
    if (bo) specParts.push(`Brand / Origin: ${bo}`);
    if (item.specification_snapshot) specParts.push(item.specification_snapshot);
    if (item.size_snapshot) specParts.push(item.size_snapshot);
    const specText = specParts.join("\n");
    const specLines = specText.split("\n").reduce((acc, line) => {
      return acc + Math.max(1, Math.ceil(line.length / 42));
    }, 0);

    // ── Fetch image meta (needed for rowHeight calculation) ───────────────────────
    const TARGET_WIDTH = 120;
    const COL_B_PX = 165; // 22 Excel units × ~7.5px/unit
    const imageUrl = imageUrlByItemId.get(item.id);
    const imgMeta = imageUrl ? await fetchImageMeta(imageUrl) : null;
    const scaledHeight = imgMeta
      ? Math.round(TARGET_WIDTH * (imgMeta.height / imgMeta.width))
      : 0;

    // ── Row height set BEFORE image placement so centering uses actual value ───────
    const rowHeight = Math.max(80, specLines * 16, scaledHeight + 16);
    sheet.getRow(r).height = rowHeight;

    // ── B: product image centered in cell ─────────────────────────────────────────
    const cb = sheet.getCell(r, 2);
    styleCell(cb);
    if (imgMeta) {
      const imgExt: "jpeg" | "png" =
        imageUrl!.toLowerCase().includes(".jpg") ||
        imageUrl!.toLowerCase().includes(".jpeg")
          ? "jpeg"
          : "png";
      const imgId = workbook.addImage({
        base64: imgMeta.buffer.toString("base64"),
        extension: imgExt,
      });
      // Row height is in points; ×0.75 converts to pixels for offset math.
      const rowHeightPx = rowHeight * 0.75;
      const xFrac = Math.max(0, (COL_B_PX - TARGET_WIDTH) / 2 / COL_B_PX);
      const yFrac = Math.max(0, ((rowHeightPx - scaledHeight) / 2) / rowHeightPx);
      sheet.addImage(imgId, {
        tl: { col: 1 + xFrac, row: r - 1 + yFrac },
        ext: { width: TARGET_WIDTH, height: scaledHeight },
        editAs: "oneCell",
      });
    }

    const cc = sheet.getCell(r, 3);
    cc.value = specText;
    styleCell(cc);
    cc.alignment = { horizontal: "left", vertical: "top", wrapText: true };

    // D: qty
    const cd = sheet.getCell(r, 4);
    cd.value = item.qty;
    styleCell(cd);
    cd.alignment = { horizontal: "center", vertical: "middle" };

    // E: unit price
    const ce = sheet.getCell(r, 5);
    ce.value = item.unit_price;
    styleCell(ce);
    ce.numFmt = "#,##0.00";
    ce.alignment = { horizontal: "right", vertical: "middle" };

    // F: discount per unit (derived — no explicit field in schema)
    const discPerUnit =
      !item.is_rate_only && item.qty > 0
        ? Math.max(0, item.unit_price - item.net_total / item.qty)
        : 0;
    const cf = sheet.getCell(r, 6);
    cf.value = discPerUnit;
    styleCell(cf);
    cf.numFmt = "#,##0.00";
    cf.alignment = { horizontal: "right", vertical: "middle" };

    // G: net price = E − F
    const cg = sheet.getCell(r, 7);
    cg.value = { formula: `E${r}-F${r}` };
    styleCell(cg);
    cg.numFmt = "#,##0.00";
    cg.alignment = { horizontal: "right", vertical: "middle" };

    // H: net total = G × D  (or 0 for rate-only)
    const ch = sheet.getCell(r, 8);
    const countsInTotal =
      !item.is_rate_only &&
      (item.is_optional ? item.include_in_total : true);
    if (item.is_rate_only) {
      ch.value = "RATE ONLY";
      ch.font = { italic: true, color: { argb: "FF0070C0" }, size: 8 };
    } else {
      ch.value = { formula: `G${r}*D${r}` };
      ch.numFmt = "#,##0.00";
      ch.font = { bold: true };
    }
    styleCell(ch);
    ch.alignment = { horizontal: "right", vertical: "middle" };

    if (countsInTotal) {
      netTotalCells.push(`H${r}`);
      sectionNetTotalCells.push(`H${r}`);
    }
    itemSequence++;
    altIdx++;
  }

  // ── Render sections ───────────────────────────────────────────────────────────
  for (const main of mainSections) {
    sectionNetTotalCells = [];

    // Main section header
    sheet.getRow(currentRow).height = 16;
    sheet.mergeCells(`A${currentRow}:H${currentRow}`);
    const mhc = sheet.getCell(`A${currentRow}`);
    mhc.value = main.section_title;
    solidFill(mhc, "FF595959", WHITE);
    mhc.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    mhc.border = allBorder(HDR_BORDER);
    currentRow++;

    // Items belonging directly to this main section
    for (const item of itemsBySection.get(main.id) ?? []) {
      await renderItem(item, currentRow);
      currentRow++;
    }

    // Subsections
    for (const sub of subsectionsByParent.get(main.id) ?? []) {
      sheet.getRow(currentRow).height = 14;
      sheet.mergeCells(`A${currentRow}:H${currentRow}`);
      const shc = sheet.getCell(`A${currentRow}`);
      shc.value = sub.section_title;
      solidFill(shc, "FFD9D9D9", "FF000000");
      shc.alignment = { horizontal: "left", vertical: "middle", indent: 2 };
      shc.border = allBorder("FFAAAAAA");
      currentRow++;

      for (const item of itemsBySection.get(sub.id) ?? []) {
        await renderItem(item, currentRow);
        currentRow++;
      }
    }

    // Section subtotal row
    sheet.getRow(currentRow).height = 16;
    const stLbl = sheet.getCell(`G${currentRow}`);
    stLbl.value = "Section Total:";
    stLbl.font = { bold: true, size: 10, name: "Arial" };
    stLbl.alignment = { horizontal: "right", vertical: "middle" };
    stLbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
    stLbl.border = allBorder("FFAAAAAA");
    const stVal = sheet.getCell(`H${currentRow}`);
    stVal.value =
      sectionNetTotalCells.length > 0
        ? { formula: `SUM(${sectionNetTotalCells.join(",")})` }
        : 0;
    stVal.numFmt = '"AED "#,##0.00';
    stVal.font = { bold: true, size: 10, name: "Arial" };
    stVal.alignment = { horizontal: "right", vertical: "middle" };
    stVal.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
    stVal.border = allBorder("FFAAAAAA");
    currentRow++;
  }

  // ── Totals ────────────────────────────────────────────────────────────────────
  currentRow += 2;

  // Grand Total
  const grandTotalRow = currentRow;
  sheet.getRow(currentRow).height = 17;
  sheet.mergeCells(`E${currentRow}:G${currentRow}`);
  const gtLbl = sheet.getCell(`E${currentRow}`);
  gtLbl.value = "Grand Total";
  solidFill(gtLbl, "FFF0F0F0");
  gtLbl.alignment = { horizontal: "right", vertical: "middle" };
  gtLbl.border = allBorder(HDR_BORDER);
  const gtVal = sheet.getCell(`H${currentRow}`);
  gtVal.value = {
    formula:
      netTotalCells.length > 0
        ? `SUM(${netTotalCells.join(",")})`
        : "0",
  };
  solidFill(gtVal, "FFF0F0F0");
  gtVal.numFmt = "#,##0.00";
  gtVal.alignment = { horizontal: "right", vertical: "middle" };
  gtVal.border = allBorder(HDR_BORDER);
  currentRow++;

  // VAT row
  const vatRow = currentRow;
  sheet.getRow(currentRow).height = 17;
  sheet.mergeCells(`E${currentRow}:G${currentRow}`);
  const vatLbl = sheet.getCell(`E${currentRow}`);
  vatLbl.value = `Add: ${quotation.vat_percent}% VAT`;
  solidFill(vatLbl, "FFF0F0F0");
  vatLbl.alignment = { horizontal: "right", vertical: "middle" };
  vatLbl.border = allBorder(HDR_BORDER);
  const vatVal = sheet.getCell(`H${currentRow}`);
  vatVal.value = { formula: `H${grandTotalRow}*${quotation.vat_percent}/100` };
  solidFill(vatVal, "FFF0F0F0");
  vatVal.numFmt = "#,##0.00";
  vatVal.alignment = { horizontal: "right", vertical: "middle" };
  vatVal.border = allBorder(HDR_BORDER);
  currentRow++;

  // Net Total with VAT
  sheet.getRow(currentRow).height = 19;
  sheet.mergeCells(`E${currentRow}:G${currentRow}`);
  const nvLbl = sheet.getCell(`E${currentRow}`);
  nvLbl.value = "Net Total with VAT";
  solidFill(nvLbl, DARK, WHITE);
  nvLbl.font = { bold: true, color: { argb: WHITE }, size: 11 };
  nvLbl.alignment = { horizontal: "right", vertical: "middle" };
  const nvVal = sheet.getCell(`H${currentRow}`);
  nvVal.value = { formula: `H${grandTotalRow}+H${vatRow}` };
  solidFill(nvVal, DARK, WHITE);
  nvVal.font = { bold: true, color: { argb: WHITE }, size: 11 };
  nvVal.numFmt = '"AED "#,##0.00';
  nvVal.alignment = { horizontal: "right", vertical: "middle" };
  currentRow++;

  // ── Terms block ───────────────────────────────────────────────────────────────
  currentRow += 2;
  const terms: [string, string | null | undefined][] = [
    ["PAYMENT", quotation.payment_terms],
    ["VALIDITY", quotation.validity],
    ["WARRANTY", quotation.warranty_terms],
    ["DELIVERY", quotation.delivery_terms],
  ];
  for (const [label, value] of terms) {
    if (!value) continue;
    sheet.getRow(currentRow).height = 15;
    const lc = sheet.getCell(`A${currentRow}`);
    lc.value = label;
    lc.font = { bold: true, size: 9 };
    sheet.mergeCells(`C${currentRow}:H${currentRow}`);
    const vc = sheet.getCell(`C${currentRow}`);
    vc.value = value;
    vc.font = { size: 9 };
    currentRow++;
  }

  // ── Closing block ─────────────────────────────────────────────────────────────
  currentRow += 1;
  sheet.mergeCells(`B${currentRow}:H${currentRow}`);
  const trnCell = sheet.getCell(`B${currentRow}`);
  trnCell.value = `NOA Office Solutions LLC  Tax Registration Number ${companyProfile.trn ?? ""}`;
  trnCell.font = { italic: true, color: { argb: "FF777777" }, size: 8 };
  currentRow += 2;

  sheet.mergeCells(`A${currentRow}:H${currentRow}`);
  const cour1 = sheet.getCell(`A${currentRow}`);
  cour1.value = "Assuring you of our best cooperation we remain,";
  cour1.font = { italic: true, size: 9 };
  currentRow++;

  sheet.mergeCells(`A${currentRow}:H${currentRow}`);
  const cour2 = sheet.getCell(`A${currentRow}`);
  cour2.value = "Yours faithfully,";
  cour2.font = { italic: true, size: 9 };
  currentRow += 2;

  const sigB = sheet.getCell(`B${currentRow}`);
  sigB.value = "NOA OFFICE SOLUTIONS";
  sigB.font = { bold: true, size: 10 };
  const sigG = sheet.getCell(`G${currentRow}`);
  sigG.value = "FOR APPROVAL";
  sigG.font = { bold: true, size: 10 };
  sigG.alignment = { horizontal: "right" };
  currentRow++;

  // ── Print area ────────────────────────────────────────────────────────────────
  sheet.pageSetup.printArea = `A1:H${currentRow}`;

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
