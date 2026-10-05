import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const controlsSource = readFileSync(new URL("./supplier-price-workspace-controls.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../app/products/price-updates/supplier-sources/page.tsx", import.meta.url), "utf8");

// Render only this UI module, without loading server actions or database clients.
function loadControls(scope = "complete") {
  let stateIndex = 0;
  const messages: string[] = [];
  const calls: string[] = [];
  type UiComponent = (props: Record<string, unknown>) => React.ReactElement;
  const sandboxModule = { exports: {} as { SupplierAdvancedImportSettings: UiComponent; SupplierStartReview: UiComponent; SupplierReviewControls: UiComponent } };
  const code = ts.transpileModule(controlsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, {
    module: sandboxModule, exports: sandboxModule.exports,
    FormData: class { constructor(form: FormData) { return form; } },
    require: (name: string) => {
      if (name === "react") return { ...React, useState: (initial: unknown) => { const index = stateIndex++; return [initial === "complete" ? scope : initial, (value: unknown) => { if (index === 1) messages.push(String(value)); }]; } };
      if (name === "react/jsx-runtime") return require(name);
      if (name === "next/navigation") return { useRouter: () => ({ refresh() {}, push() {} }) };
      if (name === "@/components/products/supplier-coverage") return { SupplierSourceField: () => null }; // covered by supplier-coverage.test.mts
      return new Proxy({}, { get: (_, action: string) => () => { calls.push(action); return Promise.resolve({ id: "batch" }); } });
    },
  });
  return { ...sandboxModule.exports, messages, calls };
}

const sourceProps = { brandId: "brand", brandName: "LAS MOBILI", basis: "list", profiles: [], approver: true, sourceId: "source", templates: [{ id: "template", template_name: "Screen" }] };

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}

test("LAS editable profile example uses verified structured headers and current basis", () => {
  const ui = loadControls().SupplierAdvancedImportSettings(sourceProps);
  const textarea = elements(ui).find((element) => element.props.name === "config")!;
  const example = JSON.parse(String(textarea.props.defaultValue));
  assert.equal(example.full_code_column, "CODICE_ARTICOLO");
  assert.equal(example.article_code_column, "NOME_FILE");
  assert.equal(example.article_length, 6);
  assert.equal(example.finish_length, 3);
  assert.equal(example.category_column, "CATEGORIA_TESSUTO");
  assert.equal(example.price_columns[0].column, "PREZZO_UNITARIO");
  assert.equal(example.currency, "EUR");
  assert.equal(example.basis, sourceProps.basis);
  const generic = elements(loadControls().SupplierAdvancedImportSettings({ ...sourceProps, brandName: "Other" })).find((element) => element.props.name === "config")!;
  assert.equal(JSON.parse(String(generic.props.defaultValue)).full_code_column, "SET_EXACT_CODE_HEADER");
});

test("Start Review defaults to Complete Brand and shows the Family chooser only for Selected Families", () => {
  for (const scope of ["partial", "complete", "selected_templates"]) {
    const ui = loadControls(scope).SupplierStartReview(sourceProps);
    const select = elements(ui).find((element) => element.props.name === "templates");
    const html = renderToStaticMarkup(ui);
    assert.equal(Boolean(select), scope === "selected_templates");
    if (select) assert.equal(select.props.required, true);
    assert.match(html, /Complete Brand \(recommended\)/); assert.match(html, /Review the full active Product range for this Brand\./);
    assert.doesNotMatch(html, /declaration only; no activation/);
    assert.ok(elements(ui).filter((element) => element.props.name === "scope").every((radio) => radio.props.checked === (radio.props.value === scope)), scope);
  }
});

test("empty Selected Families submission stops before creating a review batch", () => {
  const controls = loadControls("selected_templates");
  const ui = controls.SupplierStartReview(sourceProps);
  const form = elements(ui).find((element) => element.type === "form" && elements(element).some((child) => child.props.name === "scope"))!;
  const formData = new FormData();
  formData.set("scope", "selected_templates");
  let prevented = false;
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault() { prevented = true; }, currentTarget: formData });
  assert.equal(prevented, true);
  assert.match(controls.messages.at(-1)!, /Choose at least one Family/);
  assert.deepEqual(controls.calls, []);
});

test("Clear filters preserves brand/source/batch and resets only comparison filters", () => {
  const hrefLine = pageSource.split("\n").find((line) => line.includes("const href ="))!;
  const clearLine = pageSource.split("\n").find((line) => line.includes("const clearFiltersHref ="))!;
  const result = runInNewContext(`${ts.transpileModule(hrefLine + clearLine, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; clearFiltersHref;`, {
    URLSearchParams, base: "/products/price-updates/supplier-sources", text: (value: string) => value ?? "", brand: { id: "brand" }, source: { id: "source" }, batch: { id: "batch" },
    params: { brand: "brand", source: "source", batch: "batch", template: "template", status: "shared", code: "103801", offset: "50", sourceOffset: "20", batchOffset: "20", unitOffset: "50" },
  });
  const query = new URL(String(result), "https://example.test").searchParams;
  for (const [key, value] of Object.entries({ brand: "brand", source: "source", batch: "batch", template: "", status: "", code: "", offset: "0", sourceOffset: "20", batchOffset: "20", unitOffset: "50" })) assert.equal(query.get(key), value);
  assert.match(pageSource, /href=\{clearFiltersHref\}>Clear filters/);
});

test("empty comparisons render an explicit message and leave shared confirmation available", () => {
  const html = renderToStaticMarkup(loadControls().SupplierReviewControls({ batchId: "batch", brandId: "brand", matches: [], approver: true }));
  assert.match(html, /No comparison rows match these filters\./);
  assert.match(html, /Confirm selected as shared/);
});

test("review rendering retains prices, actions, expandable finishes and missing-source meaning", () => {
  const target = { key: "target", code: "103801", template_name: "UNIVERSAL SCREEN", label: "Screen", dimension: "melamine", currency: "EUR", price: 92 };
  const source = { code: "103801", dimension: "melamine", currency: "EUR", price: 81, finishes: Array.from({ length: 12 }, (_, index) => String(170 + index)), row_keys: ["row"], issues: ["Check source evidence"] };
  const html = renderToStaticMarkup(loadControls().SupplierReviewControls({ batchId: "batch", brandId: "brand", approver: false, matches: [{ key: "decreased", classification: "decreased", decision: "reviewed", source, targets: [target] }, { key: "missing", classification: "target_not_represented", targets: [target] }] }));
  for (const text of ["EUR 92", "EUR 81", "Decreased", "-11.00", "Validation: Check source evidence", "12 total", "181", "Explicit mapping", "Not represented in source; not discontinued"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /No comparison rows match/);
});
