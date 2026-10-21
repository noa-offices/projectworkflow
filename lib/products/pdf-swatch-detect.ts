// Finds swatch pictures and their labels on one PDF page (no React, no pdf.js import: the caller passes plain data).
// All positions are in page units with the origin at the TOP-LEFT of the page.

export type TextItem = { h: number; str: string; w: number; x: number; y: number; fontSize?: number; bold?: boolean };
export type TextLine = TextItem & { fontSize: number; bold: boolean };
export type ImageRect = { h: number; w: number; x: number; y: number };
export type DetectInput = { images: ImageRect[]; pageHeight: number; pageWidth: number; text: TextItem[] };
export type DetectedSwatch = {
  box: { h: number; w: number; x: number; y: number }; // fractions of the page, like the crop box
  code: string;
  collection: string;
  confidence: number;
  grade: string;
  nameEnglish: string;
  nameOther: string;
  namePrimary: string;
  altCode?: string; nameMain?: string; rawLines?: TextLine[]; bandId?: string;
  sourceBox?: ImageRect;
  roundInset?: boolean;
};

export const labelStyles = [
  { id: "code-then-name", name: "Code then name", example: "ER01 / jet black" },
  { id: "code-name-one-line", name: "Code and name on one line", example: "TN 9404 Tomato red" },
  { id: "name-then-code", name: "Name then code", example: "White Carrara / OPP1" },
  { id: "name-and-number", name: "Name and number", example: "Burgen 01" },
  { id: "code-english-other", name: "Code / English / other", example: "BI / White / Bianco" },
] as const;
export type LabelStyleId = typeof labelStyles[number]["id"];
export type LabelOptions = { altCodeMode: "append" | "ignore" | "use-as-code"; tidyNames: "capitalise-first" | "title-case" | "as-written"; roundInset: boolean };
export const defaultLabelOptions: LabelOptions = { altCodeMode: "ignore", tidyNames: "capitalise-first", roundInset: false };
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const ignore = /^(code|codice|colour|color|name)$/i;
const codePattern = "(?:[A-Za-z]{1,4}[ -]?\\d{1,5}[A-Za-z]?|\\d{1,5}[A-Za-z]?|[A-Z]{1,3}\\d?)";
const wholeCode = new RegExp(`^${codePattern}$`);
const codeName = new RegExp(`^(${codePattern})\\s+(.+)$`);
const dashedName = new RegExp(`^(${codePattern})\\s+[-–—]\\s*(.+)$`);
const gradePattern = /^(cat(egory)?\.?\s*[A-Za-z0-9]+|(fabric\s+)?group\s*\d+|grade\s*\w+)$/i;
const gradeText = (value: string) => clean(value.replace(/\s*[([].*$/, ""));
// 2c. spec lines (composition, weight, wear tests) are never titles or names; the digits-only form is for headings only.
const specText = /%|g\/r?m|gr\/m|martindale/i;
const specHeading = /%|g\/r?m|gr\/m|martindale|^[\d.,\s]+(?:gr?|kg|cm|mm|m)?$|polyester.*\d|\d.*polyester/i;
export function tidyLabelName(value: string, mode: LabelOptions["tidyNames"]) {
  if (mode === "as-written") return value;
  const lowered = value.replace(/\p{L}+/gu, (word) => mode === "title-case" || word === word.toUpperCase() ? word.toLowerCase() : word);
  return mode === "title-case" ? lowered.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) : lowered.replace(/\p{L}/u, (letter) => letter.toUpperCase());
}
export function parseLabel(lines: TextLine[], styleId: LabelStyleId, options: Partial<LabelOptions> = {}) {
  const opts = { ...defaultLabelOptions, ...options };
  const text = lines.map((line) => clean(line.str)).filter((s) => s && !ignore.test(s) && !specText.test(s) && !/^(PANTONE|RAL)\b/i.test(s));
  const altCode = text.find((s) => /^\([^)]+\)$/.test(s))?.slice(1, -1).trim() || "";
  const useful = text.filter((s) => !/^\([^)]+\)$/.test(s));
  let code = "", main = "", english = "", other = "";
  if (styleId === "code-then-name") {
    const at = useful.findIndex((s) => wholeCode.test(s) || dashedName.test(s));
    const remaining = [...useful];
    if (at >= 0) { const match = dashedName.exec(useful[at]); code = match?.[1] || useful[at]; remaining.splice(at, 1, ...(match ? [match[2]] : [])); }
    const names = remaining.filter((s) => !s.includes("|"));
    main = names.join(" ");
    const translated = remaining.find((s) => s.includes("|"))?.split("|").map(clean);
    english = translated?.[0] || ""; other = translated?.slice(1).join(" | ") || "";
  } else if (styleId === "code-name-one-line") {
    const match = codeName.exec(useful[0] || "");
    if (match) { code = match[1]; main = [match[2].replace(/^[-–—]\s*/, ""), ...useful.slice(1)].join(" "); }
  } else if (styleId === "name-then-code") {
    const at = useful.findLastIndex((s) => wholeCode.test(s));
    if (at > 0) { code = useful[at]; main = useful.slice(0, at).join(" "); }
  } else if (styleId === "name-and-number") {
    code = /\s(\d{1,5}[A-Za-z]?)$/.exec(useful[0] || "")?.[1] || "";
    if (code) main = useful.join(" ");
  } else if (wholeCode.test(useful[0] || "")) { code = useful[0]; english = useful[1] || ""; other = useful.slice(2).join(" "); main = english; }
  const name = (value: string) => value ? `${tidyLabelName(value, opts.tidyNames)}${opts.altCodeMode === "append" && altCode ? ` (${altCode})` : ""}` : "";
  return { code: opts.altCodeMode === "use-as-code" && altCode ? altCode : code, altCode, nameMain: name(main), nameEnglish: name(english), nameOther: name(other), rawLines: lines };
}

// Join baseline items inside one picture column; headings split only at wide gaps.
function assignedLines(input: DetectInput, images: ImageRect[]) {
  const groups: Array<{ owner: number; items: TextItem[] }> = [];
  for (const item of [...input.text].sort((a, b) => a.y + a.h - b.y - b.h || a.x - b.x)) {
    const choices = images.map((image, owner) => ({ image, owner })).filter(({ image }) => {
      const bottom = image.y + image.h, cx = item.x + item.w / 2;
      const next = images.filter((other) => other !== image && other.y >= bottom && Math.min(other.x + other.w, image.x + image.w) > Math.max(other.x, image.x)).reduce((y, other) => Math.min(y, other.y), Infinity);
      return cx >= image.x - 0.15 * image.w && cx <= image.x + 1.15 * image.w && item.y >= bottom - 1 && item.y < next && item.y - bottom <= 1.2 * image.h;
    }).sort((a, b) => b.image.y + b.image.h - a.image.y - a.image.h || Math.abs(item.x + item.w / 2 - a.image.x - a.image.w / 2) - Math.abs(item.x + item.w / 2 - b.image.x - b.image.w / 2));
    const owner = choices[0]?.owner ?? -1;
    const group = groups.findLast((g) => g.owner === owner && Math.abs(g.items[0].y + g.items[0].h - item.y - item.h) <= 0.35 * Math.max(item.h, g.items[0].h) && (owner >= 0 || item.x - Math.max(...g.items.map((i) => i.x + i.w)) < 1.5 * item.h));
    if (group) group.items.push(item); else groups.push({ owner, items: [item] });
  }
  return groups.map(({ owner, items }) => {
    const x = Math.min(...items.map((i) => i.x)), y = Math.min(...items.map((i) => i.y));
    const line: TextLine = { x, y, w: Math.max(...items.map((i) => i.x + i.w)) - x, h: Math.max(...items.map((i) => i.y + i.h)) - y,
      str: items.sort((a, b) => a.x - b.x).map((i) => clean(i.str)).join(" "), fontSize: Math.max(...items.map((i) => i.fontSize || i.h)), bold: items.some((i) => i.bold) };
    return { owner, line };
  });
}

function usableImages(input: DetectInput) {
  const kept: ImageRect[] = [];
  for (const image of input.images) {
    const wide = image.w / input.pageWidth;
    const high = image.h / input.pageWidth;
    const ratio = image.w / Math.max(image.h, 0.0001);
    if (wide < 0.03 || high < 0.03) continue; // too small, or a thin line
    if (wide > 0.6 || image.h / input.pageHeight > 0.45) continue; // too large (background, banner)
    if (ratio < 0.2 || ratio > 6) continue;
    const cx = image.x + image.w / 2;
    const cy = image.y + image.h / 2;
    // The same picture painted twice counts once.
    if (kept.some((other) => Math.abs(other.x + other.w / 2 - cx) < 0.01 * input.pageWidth && Math.abs(other.y + other.h / 2 - cy) < 0.01 * input.pageHeight)) continue;
    kept.push(image);
  }
  return kept;
}

export function insetSwatchBox(box: ImageRect) {
  return { x: box.x + box.w * 0.146, y: box.y + box.h * 0.146, w: box.w * 0.708, h: box.h * 0.708 };
}
export function detectSwatchPage(input: DetectInput, style: LabelStyleId | "auto" = "auto", options: Partial<LabelOptions> = {}) {
  const images = usableImages(input);
  const assigned = assignedLines(input, images);
  const labels = images.map((_, owner) => assigned.filter((entry) => entry.owner === owner).map((entry) => entry.line));
  const scores = labelStyles.map(({ id }) => {
    const parsed = labels.map((lines) => parseLabel(lines, id, options));
    return { id, score: (parsed.filter((p) => p.code && (p.nameMain || p.nameEnglish)).length + new Set(parsed.map((p) => p.code.toLowerCase()).filter(Boolean)).size) / Math.max(1, images.length) };
  });
  const styleId = style === "auto" ? scores.reduce((best, candidate) => candidate.score > best.score ? candidate : best).id : style;
  const labelFont = labels.flat().reduce((sum, line) => sum + line.fontSize, 0) / Math.max(1, labels.flat().length);
  const headings = assigned.filter((entry) => entry.owner < 0).map((entry) => entry.line).filter((line) => !ignore.test(line.str) && line.str.length >= 2 && !specHeading.test(line.str));
  const grades = headings.filter((line) => gradePattern.test(gradeText(line.str))).map((line) => ({ ...line, str: gradeText(line.str) }));
  const titles = headings.filter((line) => !gradePattern.test(gradeText(line.str)) && (line.bold || line.fontSize > labelFont || !headings.some((above) => above !== line && above.y < line.y && line.y - above.y < 2 * line.h && Math.min(above.x + above.w, line.x + line.w) > Math.max(above.x, line.x))));
  type Band = { top: number; bottom: number; left: number; side: number; owners: number[]; collection: string };
  const bands: Band[] = [];
  for (const side of [0, 1]) for (const { image, owner } of images.map((image, owner) => ({ image, owner })).filter(({ image }) => Number(image.x + image.w / 2 >= input.pageWidth / 2) === side).sort((a, b) => a.image.y - b.image.y || a.image.x - b.image.x)) {
    const previous = bands.findLast((band) => band.side === side);
    const headingBetween = headings.some((line) => line.y > (previous?.bottom ?? Infinity) && line.y + line.h <= image.y && Number(line.x + line.w / 2 >= input.pageWidth / 2) === side);
    if (previous && image.y - previous.bottom <= 1.5 * image.h && !headingBetween) { previous.owners.push(owner); previous.bottom = Math.max(previous.bottom, image.y + image.h); previous.left = Math.min(previous.left, image.x); }
    else bands.push({ top: image.y, bottom: image.y + image.h, left: image.x, side, owners: [owner], collection: "" });
  }
  bands.sort((a, b) => a.top - b.top || a.side - b.side);
  for (const band of bands) {
    const sameSide = titles.filter((line) => Number(line.x + line.w / 2 >= input.pageWidth / 2) === band.side);
    const above = sameSide.filter((line) => line.y + line.h <= band.top).sort((a, b) => b.y - a.y || a.x - b.x)[0];
    const left = sameSide.filter((line) => line.x + line.w <= band.left && line.y >= band.top && line.y <= band.bottom).sort((a, b) => b.x - a.x)[0];
    band.collection = (left || above)?.str.split(" / ")[0] || "";
  }
  for (const [index, band] of bands.entries()) if (!band.collection) band.collection = bands.find((other) => other !== band && other.side !== band.side && other.top <= band.bottom && other.bottom >= band.top && other.collection)?.collection || bands[index - 1]?.collection || "";
  const found = images.map((image, owner) => {
    const band = bands.find((band) => band.owners.includes(owner))!;
    const grade = grades.filter((line) => line.y + line.h <= image.y).sort((a, b) => b.y - a.y)[0]?.str || "";
    const parsed = parseLabel(labels[owner], styleId, options);
    const sourceBox = { x: image.x / input.pageWidth, y: image.y / input.pageHeight, w: image.w / input.pageWidth, h: image.h / input.pageHeight };
    return { image, band, swatch: { ...parsed, box: options.roundInset ? insetSwatchBox(sourceBox) : sourceBox, sourceBox, roundInset: Boolean(options.roundInset),
      collection: band.collection, grade: grade.replace(/^cat\.\s*/i, "CAT "), confidence: parsed.code && parsed.nameMain ? 1 : 0.4, namePrimary: parsed.nameMain, bandId: `${band.side}:${band.top}` } satisfies DetectedSwatch };
  }).sort((a, b) => a.band.top - b.band.top || a.image.y - b.image.y || a.image.x - b.image.x);
  const ordered: typeof found = [];
  for (let at = 0; at < found.length;) { const start = found[at]; let end = at + 1; while (end < found.length && found[end].band.top === start.band.top && Math.abs(found[end].image.y - start.image.y) <= 0.4 * start.image.h) end++; ordered.push(...found.slice(at, end).sort((a, b) => a.image.x - b.image.x)); at = end; }
  return { swatches: ordered.map((entry) => entry.swatch), styleId, scores };
}
export function detectSwatches(input: DetectInput): DetectedSwatch[] { return detectSwatchPage(input).swatches; }

// ---- Picture rectangles from a pdf.js operator list ------------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];

// Applies `inner` first, then `outer` (PDF matrices: x' = a*x + c*y + e, y' = b*x + d*y + f).
const multiply = (outer: Matrix, inner: Matrix): Matrix => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
];

const asMatrix = (value: unknown): Matrix | null =>
  Array.isArray(value) && value.length >= 6 && value.slice(0, 6).every((entry) => typeof entry === "number") ? (value.slice(0, 6) as Matrix) : null;

export function imageRectsFromOps(
  list: { argsArray: unknown[]; fnArray: number[] },
  ops: Record<string, number>,
  view: number[],
): ImageRect[] {
  const viewMatrix = asMatrix(view) ?? [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const rects: ImageRect[] = [];
  const images = new Set([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageXObjectRepeat].filter((value) => value !== undefined));

  list.fnArray.forEach((fn, index) => {
    const args = list.argsArray[index];
    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === ops.transform) {
      const matrix = asMatrix(args);
      if (matrix) ctm = multiply(ctm, matrix);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = Array.isArray(args) ? asMatrix(args[0]) : null;
      if (matrix) ctm = multiply(ctm, matrix);
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm;
    } else if (images.has(fn)) {
      // The unit square (the picture) mapped through the current transform, then through the page view transform.
      const total = multiply(viewMatrix, ctm);
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [px, py] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        xs.push(total[0] * px + total[2] * py + total[4]);
        ys.push(total[1] * px + total[3] * py + total[5]);
      }
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      rects.push({ h: Math.max(...ys) - y, w: Math.max(...xs) - x, x, y });
    }
  });
  return rects;
}

// Text items from page.getTextContent() converted to top-left page units (pages without rotation; others fail soft).
export function normalizeTextItems(
  items: Array<{ height?: number; str?: string; transform?: number[]; width?: number; fontName?: string; bold?: boolean }>,
  view: number[],
): TextItem[] {
  const v = asMatrix(view) ?? [1, 0, 0, 1, 0, 0];
  const result: TextItem[] = [];
  for (const item of items) {
    if (typeof item.str !== "string" || !item.str.trim() || !item.transform) continue;
    const x = v[0] * item.transform[4] + v[2] * item.transform[5] + v[4];
    const baseline = v[1] * item.transform[4] + v[3] * item.transform[5] + v[5];
    const h = Math.max(1, (item.height ?? Math.hypot(item.transform[2], item.transform[3])) * Math.abs(v[3]));
    result.push({ h, str: item.str, w: Math.abs((item.width ?? 0) * v[0]), x, y: baseline - h, fontSize: h, bold: item.bold || /bold|black|heavy/i.test(item.fontName || "") });
  }
  return result;
}
