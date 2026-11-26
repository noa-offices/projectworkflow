import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { linkedAccessoryRow } from "../../lib/products/linked-accessory-rules";
import { productTemplateRowReferenceKey, selectedRowReferencePreview, type ProductTemplateRowReferencePreview } from "../../lib/products/product-template-row-references";

const selector = readFileSync(new URL("./product-library-selector.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("selector.tsx", selector, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test("linked screen thumbnails follow the selected Base/Model or matrix row", () => {
  const component = source.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "LinkedScreenDiagram",
  );
  assert.ok(component);
  const { outputText } = ts.transpileModule(component.getText(source), {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  });
  const render = new Function("React", "selectedRowReferencePreview", `${outputText}\nreturn LinkedScreenDiagram;`)(
    { createElement }, selectedRowReferencePreview,
  );
  // Rebuilt Universal Screen families, row IDs and URLs. No live images or signed URLs.
  const refs: ProductTemplateRowReferencePreview[] = [
    { id: "a", pricingType: "base_model", groupId: "s1", rowId: "first", previewUrl: "/fixtures/s1-first.webp", caption: null },
    { id: "b", pricingType: "base_model", groupId: "s1", rowId: "second", previewUrl: "/fixtures/s1-second.webp", caption: null },
    { id: "c", pricingType: "finish_category", groupId: "s2", rowId: "first", previewUrl: "/fixtures/s2-first.webp", caption: null },
    { id: "d", pricingType: "finish_category", groupId: "s2", rowId: "second", previewUrl: "/fixtures/s2-second.webp", caption: null },
  ];
  const references = Object.fromEntries(refs.map((ref) => [productTemplateRowReferenceKey(ref.pricingType, ref.groupId, ref.rowId), ref]));
  const base = (id: string) => linkedAccessoryRow({ childVariantRow: { id }, childVariantGroups: [{ id: "s1", items: [{ id }] }] });
  const matrix = (id: string) => linkedAccessoryRow({ childCategoryRow: { id }, selectedChildCategoryGroup: { id: "s2" }, childVariantGroups: [] });
  const markup = (row: ReturnType<typeof linkedAccessoryRow>) =>
    renderToStaticMarkup(createElement(render, { row, references, onView: assert.fail }));
  for (const [row, filename] of [[base("first"), "s1-first"], [base("second"), "s1-second"], [matrix("first"), "s2-first"], [matrix("second"), "s2-second"]] as const) {
    assert.ok(markup(row).includes(`src="/fixtures/${filename}.webp"`));
    assert.match(markup(row), />View larger<\/button>/);
  }
  assert.equal(markup(matrix("missing")), "");
  assert.equal(markup(null), "");
});

test("the linked screen and accessory popup consume the same child cache and preview", () => {
  assert.match(selector, /linkedRowReferenceRequests = useRef\(new Map/);
  assert.match(selector, /references=\{linkedRowReferencesByTemplate\[line\.childTemplate\.id\]\?\.images\}/);
  assert.match(selector, /const loadedLinkedRowReferences = linkedRowReferencesByTemplate\[line\.childTemplate\.id\]/);
  assert.match(selector, /label: "Product diagram",\s+templateId: line\.childTemplate\.id,\s+linkedInstanceKey: line\.instanceKey,\s+linkedPanel: true,/);
  assert.match(selector, /<ProductImagePreviewDialog aboveLinkedPopup=\{linkedDiagramPreviewActive\}[^\n]+onClose=\{\(\) => setDiagramPreview\(null\)\}/);
});
