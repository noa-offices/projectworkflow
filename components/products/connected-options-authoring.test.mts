import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectedOptionQuantityNotice, ConnectedOptionsPicker } from "./connected-options-authoring.js";
import type { ConnectedOptionChoice } from "../../lib/products/smart-product-connected-options.js";

test("Exactly One conflict renders a clear explanation and the explicit selection remedy", () => {
  for (const scaled of [true, false]) {
    const html = renderToStaticMarkup(createElement(ConnectedOptionQuantityNotice, {
      accessory: { role: "companion", selection: "required_exactly_one", rules: [{ target: { kind: "option_item", group_id: "panels", row_id: "one" }, required: true, fixedQuantity: scaled ? 1 : 2, scaleWithTargetQuantity: scaled }] },
      onUseAtLeastOne() {},
    }));
    assert.match(html, /role="alert"/);
    assert.match(html, scaled ? /cannot follow the number/ : /total quantity of 1/);
    assert.match(html, /Use At least one/);
  }
  assert.equal(renderToStaticMarkup(createElement(ConnectedOptionQuantityNotice, { accessory: { role: "accessory", selection: "optional_multiple", rules: [] }, onUseAtLeastOne() {} })), "");
});

test("option picker shows grouped names, supplier codes, search and group selection with disabled exclusions", () => {
  const choices: ConnectedOptionChoice[] = [
    { key: "one", groupName: "Panels", label: "Wide panel", code: "P100", target: { kind: "option_item", group_id: "panels", row_id: "one" }, disabledReason: null },
    { key: "self", groupName: "Kits", label: "Kit", code: "", target: { kind: "option_item", group_id: "kits", row_id: "self" }, disabledReason: "A group cannot connect to itself." },
  ];
  const html = renderToStaticMarkup(createElement(ConnectedOptionsPicker, { choices, pending: new Set(["one"]), search: "", onSearch() {}, onPending() {}, onCancel() {}, onSave() {} }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /Search options/);
  assert.match(html, /Select all in Panels/);
  assert.match(html, /Wide panel/);
  assert.match(html, /P100/);
  assert.match(html, /cannot connect to itself/);
  assert.match(html, /disabled=""/);
  assert.match(html, /checked=""/);
});
