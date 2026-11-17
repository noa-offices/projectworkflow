import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import * as batch from "../../lib/products/specification-enrichment-batch.js";
import * as reviewState from "../../lib/products/batch-specification-review-state.js";
import { productTemplateFormSmartWorkspace } from "../../lib/products/product-template-form-smart-workspace.js";

const source = readFileSync(new URL("./batch-specification-enrichment-control.tsx", import.meta.url), "utf8");
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element as ReactElement<Record<string, unknown>>, ...elements(element.props.children)];
}
const label = (node: ReactNode): string => Array.isArray(node) ? node.map(label).join("") : node && typeof node === "object" && "props" in node ? label((node as ReactElement<{ children?: ReactNode }>).props.children) : typeof node === "string" ? node : "";
function harness(editMode: boolean, originalImportedJsonSources: Array<{ id: string; rawJson: string }> = []) {
  const draft = productTemplateFormSmartWorkspace({ currency: "EUR", desking_size_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: "[]", variant_pricing: JSON.stringify([{ id: "legacy-base-model-main", pricing_type: "base_model_group", group_name: "Base", is_active: true, sort_order: 0, items: [{ id: "desk", variant_name: "Desk", specification: "Steel desk." }] }]) }).draft;
  let cursor = 0;
  const state: unknown[] = [], applied: unknown[] = [], requests: Array<Record<string, unknown>> = [];
  const ast = ts.createSourceFile("control.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const subject = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "BatchSpecificationEnrichmentControl")!;
  const exports: { subject?: (props: unknown) => ReactNode } = {};
  runInNewContext(ts.transpileModule(subject.getText(ast) + "\nexports.subject = BatchSpecificationEnrichmentControl;", { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, React: { createElement }, ...batch, ...reviewState, SPEC_ENRICHMENT_SPECIFICATION_MAX: 1000,
    useState(value: unknown) { const at = cursor++; if (!(at in state)) state[at] = value; return [state[at], (next: unknown) => { state[at] = typeof next === "function" ? next(state[at]) : next; }]; },
    useMemo(fn: () => unknown) { return fn(); },
    async runBatchSpecificationEnrichment(request: Record<string, unknown>) { requests.push(request); return { ok: true, results: [{ targetId: "baseModel:desk", specificationSuggestion: "Steel frame." }], skippedTargetIds: [] }; },
  });
  const render = () => { cursor = 0; return exports.subject!({ draft, originalImportedJsonSources, editMode, onApply: (next: unknown) => applied.push(next) }); };
  const button = (text: string) => elements(render()).find((element) => element.type === "button" && label(element.props.children as ReactNode) === text)!;
  const click = (text: string) => (button(text).props.onClick as () => void)();
  const generate = async () => { click("Improve All Specifications with AI"); await Promise.resolve(); await Promise.resolve(); };
  return { draft, applied, requests, render, button, click, generate };
}

test("disclosure and saved source mode are edit-only; import request stays unchanged", async () => {
  const disclosure = "Uses saved product data only. Does not check the supplier catalogue.";
  assert.ok(source.includes('const disclosure = editMode ? <p'));
  for (const editMode of [false, true]) {
    const h = harness(editMode);
    assert.equal(label(h.render()).includes(disclosure), editMode);
    await h.generate();
    assert.equal(h.requests[0].sourceMode, editMode ? "saved_data" : undefined);
    assert.equal(label(h.render()).includes(disclosure), editMode);
    assert.equal(h.requests[0].draft, h.draft, "send original draft; server alone constructs validation copy");
    assert.equal("sourceFragment" in h.requests[0], false);
  }
  const withAddedJson = harness(true, [{ id: "additional", rawJson: "{}" }]);
  await withAddedJson.generate();
  assert.equal(withAddedJson.requests[0].sourceMode, "saved_data");
  assert.equal("originalImportedJsonSources" in withAddedJson.requests[0], false, "saved mode never sends originals, including after Add More JSON");
});

test("accept patches original specification only; Cancel, exclusion and stale results do not apply", async () => {
  const accepted = harness(true); await accepted.generate(); accepted.click("Apply All Safe Suggestions");
  const next = accepted.applied[0] as typeof accepted.draft;
  assert.equal(next.pricing.baseModelRows[0].specification, "Steel frame.");
  assert.equal(next.pricing.baseModelRows[0].groupId, "legacy-base-model-main");
  assert.equal(accepted.draft.pricing.baseModelRows[0].specification, "Steel desk.");
  const cancelled = harness(true); await cancelled.generate(); cancelled.click("Cancel"); assert.equal(cancelled.applied.length, 0);
  const excluded = harness(true); await excluded.generate(); excluded.click("Review Changes"); excluded.click("Keep Current"); excluded.click("Apply All Safe Suggestions"); assert.equal(excluded.applied.length, 0);
  const stale = harness(true); await stale.generate(); stale.draft.pricing.baseModelRows[0].specification = "Manual edit.";
  assert.equal(stale.button("Apply All Safe Suggestions").props.disabled, true);
  stale.click("Apply All Safe Suggestions"); assert.equal(stale.applied.length, 0);
});
