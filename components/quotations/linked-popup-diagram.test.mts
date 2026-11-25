import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { productTemplateRowReferenceKey, type ProductTemplateRowReferencePreview } from "../../lib/products/product-template-row-references";

const selector = readFileSync(new URL("./product-library-selector.tsx", import.meta.url), "utf8");

test("the linked popup reads child references and scopes the shared preview to the open instance", () => {
  assert.match(selector, /listProductTemplateRowReferences\(linkedAccessoryTemplateId\)/);
  assert.match(selector, /rowReferences=\{loadedLinkedRowReferences\?\.templateId === line\.childTemplate\.id \? loadedLinkedRowReferences\.images : \{\}\}/);
  assert.match(selector, /onViewDiagram=\{\(item, url\) => setDiagramPreview\(\{\s+label: "Accessory diagram",\s+templateId: line\.childTemplate\.id,\s+linkedInstanceKey: line\.instanceKey,/);
  assert.match(selector, /diagramPreview\.linkedInstanceKey === linkedAccessoryPopupKey\s+&& diagramPreview\.templateId === linkedAccessoryTemplateId/);
  assert.match(selector, /<ProductImagePreviewDialog aboveLinkedPopup=\{linkedDiagramPreviewActive\}[^\n]+onClose=\{\(\) => setDiagramPreview\(null\)\}/);
});

test("shared accessory fields expose View diagram only when the indexed row has a preview URL", () => {
  const source = ts.createSourceFile("selector.tsx", selector, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "AccessoryItemMetadata",
  );
  assert.ok(component);
  const { outputText } = ts.transpileModule(component.getText(source), {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  });
  const render = new Function("React", "productTemplateRowReferenceKey", `${outputText}\nreturn AccessoryItemMetadata;`)(
    { createElement, Fragment: Symbol.for("react.fragment") }, productTemplateRowReferenceKey,
  );
  // Rebuilt child reference and accessory IDs. The fixture uses no signed URL or database.
  const reference: ProductTemplateRowReferencePreview = {
    id: "diagram", pricingType: "accessory", groupId: "stirrups", rowId: "883",
    previewUrl: "/fixture-diagram.webp", caption: null,
  };
  const key = productTemplateRowReferenceKey(reference.pricingType, reference.groupId, reference.rowId);
  const markup = (id: string, rowReferences: Record<string, ProductTemplateRowReferencePreview>) =>
    renderToStaticMarkup(createElement(render, {
      groupId: reference.groupId, item: { id, item_name: `Stirrup ${id}` }, rowReferences, onViewDiagram: assert.fail,
    }));
  assert.match(markup("883", { [key]: reference }), /<button type="button"[^>]*>View diagram<\/button>/);
  assert.doesNotMatch(markup("880", { [key]: reference }), /View diagram/);
  assert.doesNotMatch(markup("883", { [key]: { ...reference, previewUrl: null } }), /View diagram/);
});
