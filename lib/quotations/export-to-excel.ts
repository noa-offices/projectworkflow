"use client";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ExportQuotationData = {
  quotationNo: string | null;
  quotationDate: string;
  title: string;
  currency: string;
  subtotal: number;
  discountTotal: number;
  vatPercent: number;
  vatAmount: number;
  grandTotal: number;
  paymentTerms?: string | null;
  validityText?: string | null;
  warrantyText?: string | null;
  deliveryText?: string | null;
  clientName: string | null;
  projectName: string | null;
  attentionTo?: string | null;
  attentionMobile?: string | null;
  attentionEmail?: string | null;
  poBox?: string | null;
  companyDisplayName?: string | null;
  companyTrn?: string | null;
  preparedByName?: string | null;
  sections: Array<{
    id: string;
    section_title: string;
    section_kind: "main" | "sub";
    parent_section_id?: string | null;
  }>;
  items: Array<{
    id: string;
    section_id: string | null;
    item_type: string;
    line_style: string;
    is_active: boolean;
    item_name_snapshot: string | null;
    brand_name_snapshot?: string | null;
    origin_snapshot?: string | null;
    size_snapshot?: string | null;
    finish_snapshot?: string | null;
    specification_snapshot?: string | null;
    supplier_name_snapshot?: string | null;
    qty: number;
    unit_label: string;
    unit_price: number;
    net_total: number;
    is_optional: boolean;
    include_in_total?: boolean;
    is_rate_only: boolean;
  }>;
};

// ── Utilities ──────────────────────────────────────────────────────────────────

function esc(v: string | null | undefined): string {
  return (v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(v: number): string {
  return v.toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

function isExportableItem(
  item: ExportQuotationData["items"][number],
): boolean {
  if (!item.is_active) return false;
  if (["note", "blank", "subtotal"].includes(item.item_type)) return false;
  if (["heading", "note", "no_quote"].includes(item.line_style)) return false;
  return true;
}

// ── HTML row builders ──────────────────────────────────────────────────────────

const BASE = "font-family:Arial,sans-serif; font-size:9pt; padding:4px 8px;";

function td(content: string, style = "", colspan = 1): string {
  const cs = colspan > 1 ? ` colspan="${colspan}"` : "";
  return `<td${cs} style="${BASE}${style}">${content}</td>`;
}

function blankRow(): string {
  return `<tr>${td("", "", 8)}</tr>`;
}

function sectionRow(title: string, isMain: boolean): string {
  const bg = isMain ? "#595959" : "#D9D9D9";
  const fg = isMain ? "#FFFFFF" : "#000000";
  return `<tr>${td(
    esc(title),
    `background-color:${bg}; color:${fg}; font-weight:bold; font-size:10pt; border:1px solid #888888;`,
    8,
  )}</tr>`;
}

function itemRow(
  item: ExportQuotationData["items"][number],
  serial: number,
  isEven: boolean,
): string {
  const rowBg = isEven ? "#F5F5F5" : "#FFFFFF";
  const cell = `border:1px solid #CCCCCC; background-color:${rowBg}; vertical-align:top;`;
  const right = `${cell} text-align:right;`;

  const specParts: string[] = [];
  if (item.item_name_snapshot) specParts.push(esc(item.item_name_snapshot));
  const brandOrigin = [item.brand_name_snapshot, item.origin_snapshot]
    .filter(Boolean)
    .map(esc)
    .join(" / ");
  if (brandOrigin) specParts.push(`Brand / Origin: ${brandOrigin}`);
  if (item.specification_snapshot) specParts.push(esc(item.specification_snapshot));
  if (item.size_snapshot) specParts.push(esc(item.size_snapshot));
  const specHtml = specParts.join("<br/>");

  const included =
    !item.is_rate_only &&
    (item.is_optional ? (item.include_in_total ?? true) : true);
  const effectiveNet = included ? item.net_total : 0;
  const discPerUnit =
    !item.is_rate_only && item.qty > 0
      ? Math.max(0, item.unit_price - item.net_total / item.qty)
      : 0;
  const netPricePerUnit = item.unit_price - discPerUnit;
  const netTotalDisplay = item.is_rate_only
    ? `<span style="color:#0070C0; font-style:italic; font-size:8pt;">RATE ONLY</span>`
    : fmt(effectiveNet);

  return `<tr>
  ${td(String(serial).padStart(2, "0"), `${cell} text-align:center; font-weight:bold;`)}
  ${td("—", `${cell} color:#BBBBBB; font-style:italic; text-align:center; font-size:8pt; vertical-align:middle;`)}
  ${td(specHtml, `${cell} white-space:pre-wrap; text-align:left; min-width:280px;`)}
  ${td(String(item.qty), `${cell} text-align:center;`)}
  ${td(fmt(item.unit_price), right)}
  ${td(fmt(discPerUnit), right)}
  ${td(fmt(netPricePerUnit), right)}
  ${td(netTotalDisplay, right)}
</tr>`;
}

function totalRow(label: string, value: string, style: string): string {
  return `<tr>
  ${td("", style, 6)}
  ${td(label, `${style} text-align:right;`)}
  ${td(value, `${style} text-align:right; font-weight:bold;`)}
</tr>`;
}

function termsRow(label: string, value: string): string {
  return `<tr>
  ${td(label, "font-weight:bold;")}
  ${td(esc(value), "", 7)}
</tr>`;
}

// ── HTML builder ───────────────────────────────────────────────────────────────

function buildHtml(data: ExportQuotationData): string {
  const rows: string[] = [];
  const company = esc(data.companyDisplayName ?? "NOA OFFICE SOLUTIONS LLC");

  // ── Header ────────────────────────────────────────────────────────────────
  rows.push(`<tr>
  <td colspan="7" style="font-weight:bold; color:#CC0000; font-size:13pt; font-family:Arial; padding:6px 8px;">${company}</td>
  <td style="font-size:9pt; text-align:right; padding:6px 8px; font-family:Arial;">REF.NO: ${esc(data.quotationNo ?? "")}</td>
</tr>`);

  rows.push(`<tr>
  <td colspan="7"></td>
  <td style="font-size:9pt; text-align:right; padding:2px 8px; font-family:Arial;">${esc(fmtDate(data.quotationDate))}</td>
</tr>`);

  rows.push(blankRow());

  rows.push(`<tr>
  <td colspan="8" style="font-weight:bold; font-size:13pt; font-family:Arial; padding:6px 8px;">OFFICE FURNITURE - COMMERCIAL PROPOSAL</td>
</tr>`);

  rows.push(blankRow());

  // ── Client block ──────────────────────────────────────────────────────────
  const clientBlock: [string, string | null | undefined][] = [
    ["M/S :", data.clientName],
    ["PROJECT :", data.projectName],
    ["ATTN :", data.attentionTo],
    ["P.O. BOX :", data.poBox],
    ["TEL :", data.attentionMobile],
  ];
  for (const [label, value] of clientBlock) {
    rows.push(`<tr>
  <td style="font-weight:bold; font-size:10pt; padding:3px 8px; font-family:Arial;">${esc(label)}</td>
  <td colspan="7" style="font-size:10pt; padding:3px 8px; font-family:Arial;">${esc(value ?? "")}</td>
</tr>`);
  }

  rows.push(blankRow());

  // ── Column headers ────────────────────────────────────────────────────────
  const hdrStyle =
    "background-color:#2D2D2D; color:#FFFFFF; font-weight:bold; font-size:10pt;" +
    " text-align:center; border:1px solid #888888; padding:6px 4px; font-family:Arial;";
  const COL_WIDTHS = ["50px", "80px", "320px", "45px", "90px", "90px", "90px", "100px"];
  const hdr1 = ["S.No", "—", "Specification", "Qty", "U.Price", "Discount", "Net Price", "Net Total"];
  const hdr2 = ["", "", "", "AED/Pc", "AED/Pc", "AED/Pc", "AED/Pc", "AED"];
  rows.push(`<tr>${hdr1.map((h, i) => `<td style="${hdrStyle} width:${COL_WIDTHS[i]};">${h}</td>`).join("")}</tr>`);
  rows.push(`<tr>${hdr2.map((h, i) => `<td style="${hdrStyle} width:${COL_WIDTHS[i]};">${h}</td>`).join("")}</tr>`);

  // ── Items ─────────────────────────────────────────────────────────────────
  const exportable = data.items.filter(isExportableItem);
  const bySection = new Map<string, typeof exportable>();
  for (const item of exportable) {
    const key = item.section_id ?? "unsectioned";
    bySection.set(key, [...(bySection.get(key) ?? []), item]);
  }

  const allSections = [
    ...data.sections,
    ...(bySection.has("unsectioned")
      ? [{ id: "unsectioned", section_title: "General Items", section_kind: "sub" as const, parent_section_id: null }]
      : []),
  ];

  let serial = 0;
  let altIdx = 0;
  let itemGrandTotal = 0;

  for (const section of allSections) {
    const sItems = bySection.get(section.id);
    if (!sItems?.length) continue;

    const isMain = section.section_kind === "main" || !section.parent_section_id;
    rows.push(sectionRow(section.section_title, isMain));

    for (const item of sItems) {
      serial++;
      rows.push(itemRow(item, serial, altIdx % 2 === 0));
      altIdx++;
      if (!item.is_rate_only && (item.is_optional ? (item.include_in_total ?? true) : true)) {
        itemGrandTotal += item.net_total;
      }
    }
  }

  rows.push(blankRow());

  // ── Totals ────────────────────────────────────────────────────────────────
  const vatAmt = itemGrandTotal * data.vatPercent / 100;
  const totalWithVat = itemGrandTotal + vatAmt;

  rows.push(totalRow(
    "Grand Total",
    fmt(itemGrandTotal),
    "background-color:#F0F0F0; font-weight:bold; border-top:2px solid #888888; border:1px solid #DDDDDD;",
  ));
  rows.push(totalRow(
    `Add: ${data.vatPercent}% VAT`,
    fmt(vatAmt),
    "background-color:#F0F0F0; border:1px solid #DDDDDD;",
  ));
  rows.push(totalRow(
    "Net Total with VAT",
    fmt(totalWithVat),
    "background-color:#2D2D2D; color:#FFFFFF; font-weight:bold; font-size:11pt;",
  ));

  rows.push(blankRow());

  // ── Terms ─────────────────────────────────────────────────────────────────
  const terms: [string, string | null | undefined][] = [
    ["PAYMENT", data.paymentTerms],
    ["VALIDITY", data.validityText],
    ["WARRANTY", data.warrantyText],
    ["DELIVERY", data.deliveryText],
  ];
  for (const [label, value] of terms) {
    if (value) rows.push(termsRow(label, value));
  }

  rows.push(blankRow());

  // ── Closing ───────────────────────────────────────────────────────────────
  if (data.companyTrn) {
    rows.push(`<tr><td colspan="8" style="${BASE}">${esc(`TRN: ${data.companyTrn}`)}</td></tr>`);
  }
  rows.push(`<tr><td colspan="8" style="${BASE} font-style:italic;">Assuring you of our best cooperation we remain,</td></tr>`);
  rows.push(`<tr><td colspan="8" style="${BASE} font-style:italic;">Yours faithfully,</td></tr>`);
  rows.push(blankRow());
  rows.push(`<tr>
  <td colspan="4" style="${BASE} font-weight:bold;">${esc(data.preparedByName ?? "NOA OFFICE SOLUTIONS")}</td>
  <td colspan="4" style="${BASE} font-weight:bold; text-align:right;">FOR APPROVAL</td>
</tr>`);

  // ── Assemble ──────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<!--[if gte mso 9]><xml>
  <x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
    <x:Name>QUOTATION</x:Name>
    <x:WorksheetOptions>
      <x:Print>
        <x:FitWidth>1</x:FitWidth>
        <x:ValidPrinterInfo/>
        <x:Scale>85</x:Scale>
      </x:Print>
    </x:WorksheetOptions>
  </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>
</xml><![endif]-->
</head>
<body>
<table style="border-collapse:collapse; font-family:Arial,sans-serif;">
<colgroup>
  <col style="width:50px"/>
  <col style="width:80px"/>
  <col style="width:320px"/>
  <col style="width:45px"/>
  <col style="width:90px"/>
  <col style="width:90px"/>
  <col style="width:90px"/>
  <col style="width:100px"/>
</colgroup>
${rows.join("\n")}
</table>
</body>
</html>`;
}

// ── Export function ────────────────────────────────────────────────────────────

export function exportQuotationToExcel(data: ExportQuotationData): void {
  const html = buildHtml(data);
  const blob = new Blob(["﻿", html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const qno = (data.quotationNo ?? "Draft").replace(/[^a-zA-Z0-9\-]/g, "_");
  const client = (data.clientName ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();
  a.download = `Quotation-${qno}-${client}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
