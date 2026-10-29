import assert from "node:assert/strict";
import test from "node:test";
import { detectSwatches, detectSwatchPage, insetSwatchBox, parseLabel, imageRectsFromOps, type TextItem, type TextLine, type LabelStyleId } from "./pdf-swatch-detect";

const text = (str: string, x: number, y: number, h = 10, w = str.length * 5): TextItem => ({ h, str, w, x, y });

// A fake page 600 x 800 shaped like the fabric catalogue: two sections ("Cat. C" + TIME above, "Cat. D" + ONE below),
// pictures in a row, and under each picture "CODE - Italian" (line 1) and "English | French" (line 2).
const page = {
  images: [
    { h: 80, w: 80, x: 120, y: 60 }, // second picture of the first row (given first on purpose: order must not depend on input order)
    { h: 80, w: 80, x: 20, y: 60 },
    { h: 80, w: 80, x: 20, y: 340 },
    { h: 700, w: 590, x: 5, y: 5 }, // background: ignored (too large)
    { h: 2, w: 300, x: 20, y: 150 }, // thin line: ignored
  ],
  pageHeight: 800,
  pageWidth: 600,
  text: [
    text("Cat. C", 20, 20, 12), text("TIME", 90, 20, 12),
    text("composition 100% wool", 20, 44, 8), // small description above a column: not a label
    text("C01 - Grigio", 20, 150), text("Grey | Gris", 20, 164, 8),
    text("C02 - Nero", 120, 150), text("Black | Noir", 120, 164, 8),
    text("Cat. D", 20, 300, 12), text("ONE", 90, 300, 12),
    text("D10 - Rosso", 20, 430), text("Red | Rouge", 20, 444, 8),
  ],
};

test("detects codes, names, grade, collection, sections and reading order", () => {
  const found = detectSwatches(page);
  assert.equal(found.length, 3);

  assert.deepEqual(found.map((item) => item.code), ["C01", "C02", "D10"]); // reading order, whatever the input order

  const [first, second, lower] = found;
  assert.equal(first.namePrimary, "Grigio"); // Italian: line 1 after the dash
  assert.equal(first.nameEnglish, "Grey"); // line 2 before |
  assert.equal(first.nameOther, "Gris"); // line 2 after |
  assert.equal(first.grade, "CAT C");
  assert.equal(first.collection, "TIME");
  assert.equal(second.namePrimary, "Nero");

  // The picture under the lower heading takes the lower section's grade and collection.
  assert.equal(lower.grade, "CAT D");
  assert.equal(lower.collection, "ONE");
  assert.equal(lower.nameEnglish, "Red");

  // The box is a fraction of the page.
  assert.ok(Math.abs(first.box.x - 20 / 600) < 1e-9 && Math.abs(first.box.y - 60 / 800) < 1e-9);
});

test("picture rectangles come from the operator list (save, restore, transform, image)", () => {
  const ops = { paintImageXObject: 85, restore: 11, save: 10, transform: 12 };
  // A 100 x 50 picture at (30, 700) in PDF space (origin bottom-left) on an 800-high page: view flips y.
  const rects = imageRectsFromOps(
    { argsArray: [[], [100, 0, 0, 50, 30, 700], ["img", 10, 10], []], fnArray: [ops.save, ops.transform, ops.paintImageXObject, ops.restore] },
    ops,
    [1, 0, 0, -1, 0, 800],
  );
  assert.equal(rects.length, 1);
  assert.deepEqual(rects[0], { h: 50, w: 100, x: 30, y: 50 });
});

const lines = (values: string[]): TextLine[] => values.map((str, i) => ({ ...text(str, 100, 170 + i * 13), fontSize: 10, bold: false }));
const fixtures: Array<{ title: string; style: LabelStyleId; auto: LabelStyleId; lines: string[]; code: string; name: string }> = [
  { title: "Interstuhl", style: "code-then-name", auto: "code-then-name", lines: ["ER01", "(CSE14)", "jet black"], code: "ER01", name: "Jet black" },
  { title: "Round fabrics", style: "code-then-name", auto: "code-then-name", lines: ["CSE30", "TRANSITION"], code: "CSE30", name: "Transition" },
  { title: "Finishes", style: "code-english-other", auto: "code-then-name", lines: ["BI", "White", "Bianco", "PANTONE 400 U"], code: "BI", name: "White" },
  { title: "One line", style: "code-name-one-line", auto: "code-name-one-line", lines: ["TN 9404 Tomato red"], code: "TN 9404", name: "Tomato red" },
  { title: "Table", style: "name-then-code", auto: "code-then-name", lines: ["White Carrara", "marble", "OPP1"], code: "OPP1", name: "White Carrara marble" },
  { title: "Number", style: "name-and-number", auto: "name-and-number", lines: ["Burgen 01"], code: "01", name: "Burgen 01" },
  { title: "MFC", style: "code-name-one-line", auto: "code-name-one-line", lines: ["CL-0926 Embossed natural oak"], code: "CL-0926", name: "Embossed natural oak" },
  { title: "MFC wrapped", style: "code-name-one-line", auto: "code-name-one-line", lines: ["CL-9061 Synchronized", "natural walnut"], code: "CL-9061", name: "Synchronized natural walnut" },
  { title: "Marelli", style: "code-then-name", auto: "code-then-name", lines: ["C01 - Grigio", "Grey | Gris"], code: "C01", name: "Grigio" },
];
for (const fixture of fixtures) test(`${fixture.title}: label and page-wide Auto score`, () => {
  const parsed = parseLabel(lines(fixture.lines), fixture.style);
  assert.equal(parsed.code, fixture.code); assert.equal(parsed.nameMain, fixture.name);
  const data = { pageWidth: 1000, pageHeight: 800, images: [{ x: 100, y: 100, w: 120, h: 60 }, { x: 400, y: 100, w: 120, h: 60 }],
    text: [100, 400].flatMap((x, i) => lines(fixture.lines).map((line, j) => ({ ...line, x, w: 110, str: j === 0 ? line.str.replace(fixture.code, i ? fixture.code.replace(/\d+/, "99") : fixture.code) : line.str }))) };
  const result = detectSwatchPage(data);
  assert.equal(result.styleId, fixture.auto); assert.equal(result.swatches.length, 2);
  assert.equal(result.scores.length, 5);
});
test("second codes, translations and tidy options", () => {
  const raw = lines(["ER01", "(CSE14)", "JET BLACK"]);
  assert.equal(parseLabel(raw, "code-then-name").altCode, "CSE14");
  assert.equal(parseLabel(raw, "code-then-name", { altCodeMode: "ignore" }).nameMain, "Jet black");
  assert.equal(parseLabel(raw, "code-then-name", { altCodeMode: "use-as-code" }).code, "CSE14");
  assert.equal(parseLabel(raw, "code-then-name", { altCodeMode: "append", tidyNames: "title-case" }).nameMain, "Jet Black (CSE14)");
  assert.equal(parseLabel(raw, "code-then-name", { altCodeMode: "append", tidyNames: "as-written" }).nameMain, "JET BLACK (CSE14)");
  assert.equal(parseLabel(raw, "code-then-name").nameMain, "Jet black"); // default: the second code is dropped from the name
  const finish = parseLabel(lines(["BI", "White", "Bianco", "RAL 9001"]), "code-english-other");
  assert.equal(finish.nameEnglish, "White"); assert.equal(finish.nameOther, "Bianco");
  const marelli = parseLabel(lines(["C01 - Grigio", "Grey | Gris"]), "code-then-name");
  assert.equal(marelli.nameEnglish, "Grey"); assert.equal(marelli.nameOther, "Gris");
});
test("split text items join in one column; ignore Code heading", () => {
  const result = detectSwatchPage({ pageWidth: 600, pageHeight: 800, images: [{ x: 100, y: 100, w: 180, h: 80 }], text: [text("Code", 10, 100), text("TN 9404", 100, 190, 10, 45), text("Tomato red", 170, 190, 10, 60)] }, "code-name-one-line");
  assert.equal(result.swatches[0].code, "TN 9404"); assert.equal(result.swatches[0].nameMain, "Tomato red");
  assert.equal(result.swatches[0].collection, ""); assert.equal(result.swatches[0].rawLines?.length, 1);
});
test("Interstuhl bands: left title, spread inheritance, later title and persistent grade", () => {
  const result = detectSwatches({ pageWidth: 1000, pageHeight: 800,
    images: [{ x: 150, y: 100, w: 80, h: 60 }, { x: 650, y: 100, w: 80, h: 60 }, { x: 150, y: 450, w: 80, h: 60 }],
    text: [text("Fabric group 1", 10, 10, 14), text("Era", 20, 110, 14), text("Manhattan / Fabric", 150, 410, 14),
      ...[150, 650].flatMap((x, i) => [text(`ER0${i + 1}`, x, 170), text("jet black", x, 184)]), text("MN01", 150, 520), text("navy", 150, 534)] });
  assert.deepEqual(result.map((item) => item.collection), ["Era", "Era", "Manhattan"]);
  assert.ok(result.every((item) => item.grade === "Fabric group 1"));
});
test("round inset and enlarged picture limits; no labels shared between pictures", () => {
  assert.deepEqual(insetSwatchBox({ x: 0, y: 0, w: 100, h: 100 }), { x: 14.6, y: 14.6, w: 70.8, h: 70.8 });
  const data = { pageWidth: 600, pageHeight: 800, images: [{ x: 0, y: 20, w: 350, h: 350 }, { x: 450, y: 20, w: 80, h: 80 }], text: [text("BI", 450, 110), text("WHITE", 450, 124)] };
  const result = detectSwatchPage(data, "auto", { roundInset: true });
  assert.equal(result.swatches.length, 2); assert.equal(result.swatches.filter((item) => item.code === "BI").length, 1);
  assert.ok(result.swatches.every((item) => item.box.w < item.sourceBox!.w));
});
test("grade with a bracket note, left collection title, spec lines ignored (Fame page)", () => {
  const result = detectSwatches({ pageWidth: 1000, pageHeight: 800,
    images: [{ x: 150, y: 100, w: 80, h: 60 }, { x: 300, y: 100, w: 80, h: 60 }],
    text: [text("Fabric group 3 (further on the next page)", 10, 10, 14), text("Fame", 20, 108, 14), text("95% New wool", 20, 124, 8), text("5% Polyamid", 20, 134, 8), text("630 g/rm", 20, 144, 8),
      text("FA01", 150, 170), text("(60999)", 150, 184), text("jet black", 150, 198), text("FA13", 300, 170), text("(64089)", 300, 184), text("signal red", 300, 198)] });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.code), ["FA01", "FA13"]);
  assert.deepEqual(result.map((item) => item.namePrimary), ["Jet black", "Signal red"]);
  assert.ok(result.every((item) => item.grade === "Fabric group 3" && item.collection === "Fame"));
});
test("spec lines are not names", () => {
  const raw = [text("FA01", 0, 0), text("630 g/rm", 0, 12), text("448 g/m²", 0, 24), text("jet black", 0, 36)].map((item) => ({ ...item, fontSize: 10, bold: false }));
  assert.equal(parseLabel(raw, "code-then-name").nameMain, "Jet black");
});
test("spread page: left titles split the whole page into strips (Era / Manhattan / Strick)", () => {
  const images = [95, 195, 295].flatMap((y) => [150, 250, 650, 750].map((x) => ({ x, y, w: 80, h: 60 })))
    .concat([150, 250, 650, 750].map((x) => ({ x, y: 445, w: 80, h: 60 })), [150, 650].map((x) => ({ x, y: 595, w: 80, h: 60 })));
  const labels = images.flatMap((image, i) => [text(`E${100 + i}`, image.x, image.y + 70), text("jet black", image.x, image.y + 84)]);
  const result = detectSwatches({ pageWidth: 1000, pageHeight: 800, images,
    text: [text("Fabric group 1", 10, 10, 14), text("Era", 20, 100, 14), text("95% New wool", 20, 116, 8), text("Manhattan", 20, 440, 14), text("630 g/rm", 20, 456, 8), text("Strick", 20, 600, 14), text("5% Polyamid", 20, 616, 8), ...labels] });
  assert.equal(result.length, images.length);
  const byRow = (item: (typeof result)[number]) => item.box.y * 800;
  assert.ok(result.filter((item) => byRow(item) < 400).every((item) => item.collection === "Era"));
  assert.equal(result.filter((item) => byRow(item) < 400).length, 12);
  assert.ok(result.filter((item) => byRow(item) >= 400 && byRow(item) < 560).every((item) => item.collection === "Manhattan"));
  assert.ok(result.filter((item) => byRow(item) >= 560).every((item) => item.collection === "Strick"));
  assert.ok(result.every((item) => item.grade === "Fabric group 1"));
  assert.ok(result.filter((item) => byRow(item) < 400 && item.box.x > 0.5).length === 6); // both halves of the spread
});

// Supplier finish labels ("COD. 07 NOCE CLASSICO / CLASSIC WALNUT"): code and English name per swatch.
const supplier = (values: string[], style: LabelStyleId, tidyNames: "title-case" | "capitalise-first" = "title-case") => parseLabel(lines(values), style, { tidyNames });
const cases: Array<[string[], LabelStyleId, string, string]> = [
  [["COD. 07 NOCE CLASSICO / CLASSIC WALNUT"], "code-name-one-line", "07", "Classic Walnut"],
  [["COD. 12 OLMO GREY / GREY ELM"], "code-name-one-line", "12", "Grey Elm"],
  [["COD. 10 NERO / BLACK"], "code-name-one-line", "10", "Black"],
  [["COD. AR 02 ARGENTO / SILVER"], "code-name-one-line", "AR 02", "Silver"],
  [["COD. CP 01 CIPRIA / POWDER PINK"], "code-name-one-line", "CP 01", "Powder Pink"],
  [["COD. RS 02 ROSSO GRANATO / GARNET RED"], "code-name-one-line", "RS 02", "Garnet Red"],
  [["522 GRIGIO PERLA / LIGHT GREY"], "code-name-one-line", "522", "Light Grey"],
  [["522 - Grigio perla / Light grey"], "code-name-one-line", "522", "Light Grey"],
  [["522 - Grigio perla / Light grey"], "code-then-name", "522", "Light Grey"],
  [["COD. 07", "NOCE CLASSICO / CLASSIC WALNUT"], "code-then-name", "07", "Classic Walnut"],
  [["COD. AR 02", "ARGENTO / SILVER"], "code-then-name", "AR 02", "Silver"],
  [["COD. 07 NOCE CLASSICO /", "CLASSIC WALNUT"], "code-name-one-line", "07", "Classic Walnut"],
];
for (const [values, style, code, english] of cases) test(`supplier label ${style}: ${values.join(" | ")}`, () => {
  const parsed = supplier(values, style);
  assert.equal(parsed.code, code); assert.equal(parsed.nameEnglish, english);
});
test("supplier label: Italian name kept as primary, default tidy, leading zeros and case preserved", () => {
  const parsed = supplier(["COD. 07 NOCE CLASSICO / CLASSIC WALNUT"], "code-name-one-line", "capitalise-first");
  assert.equal(parsed.code, "07"); assert.equal(parsed.nameMain, "Noce classico"); assert.equal(parsed.nameEnglish, "Classic walnut");
  assert.equal(supplier(["cod. ab 02 argento / silver"], "code-name-one-line").code, "ab 02");
});
test("supplier label: English-only name has no invented English split; missing code or name stays empty", () => {
  const english = supplier(["COD. 12 GREY ELM"], "code-name-one-line");
  assert.equal(english.code, "12"); assert.equal(english.nameMain, "Grey Elm"); assert.equal(english.nameEnglish, "");
  const noCode = supplier(["NOCE CLASSICO / CLASSIC WALNUT"], "code-name-one-line");
  assert.equal(noCode.code, ""); assert.equal(noCode.nameEnglish, "");
  const noName = supplier(["COD. 07"], "code-name-one-line");
  assert.equal(noName.code, ""); assert.equal(noName.nameMain, "");
  const threeParts = supplier(["COD. 07 A / B / C"], "code-name-one-line");
  assert.equal(threeParts.nameEnglish, ""); // ambiguous: not split
});
test("supplier label: applicability and spec text never become names", () => {
  const parsed = supplier(["COD. 07 NOCE CLASSICO / CLASSIC WALNUT", "Per cassetti e ante", "For drawers and doors", "Use with Collection X"], "code-name-one-line");
  assert.equal(parsed.code, "07"); assert.equal(parsed.nameEnglish, "Classic Walnut"); assert.equal(parsed.nameMain, "Noce Classico");
  const split = supplier(["COD. 07", "NOCE CLASSICO / CLASSIC WALNUT", "Solo per top", "Note: see catalogue"], "code-then-name");
  assert.equal(split.code, "07"); assert.equal(split.nameEnglish, "Classic Walnut");
});
test("supplier labels: each swatch on a page keeps its own code and name, auto style, missing label stays empty", () => {
  const labelsAt = (x: number, values: string[]) => values.map((str, j) => text(str, x, 170 + j * 13, 10, 150));
  const result = detectSwatchPage({ pageWidth: 1000, pageHeight: 800,
    images: [100, 300, 500, 700].map((x) => ({ x, y: 100, w: 120, h: 60 })),
    text: [...labelsAt(100, ["COD. 07 NOCE CLASSICO / CLASSIC WALNUT"]), ...labelsAt(300, ["COD. AR 02 ARGENTO / SILVER", "Per collezione Alfa"]), ...labelsAt(700, ["COD. 10 NERO / BLACK"])] }, "auto", { tidyNames: "title-case" });
  assert.deepEqual(result.swatches.map((item) => item.code), ["07", "AR 02", "", "10"]);
  assert.deepEqual(result.swatches.map((item) => item.nameEnglish), ["Classic Walnut", "Silver", "", "Black"]);
});
