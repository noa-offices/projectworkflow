import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("quotation server validates the authoritative workstation target and snapshots its ID", () => {
  const source = readFileSync("app/quotations/actions.ts", "utf8");
  [
    'redirectWithMessage(redirectPath, "The selected workstation row is no longer available.")',
    'kind: "workstation" as const',
    "selectedWorkstationGroup.id",
    'textValue(formData, "workstation_pricing_group_id")',
    "evaluateProductAccessorySelection({",
    "workstation_row_id: selectedSizePricing?.id",
    "importantRequirements: selectedSizePricing?.importantRequirements",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected workstation server wiring: ${expected}`));
});

test("reprice resolves new snapshots by workstation row ID with label-only legacy fallback", () => {
  const actions = readFileSync("app/quotations/actions.ts", "utf8");
  const builder = readFileSync("app/quotations/[id]/builder/page.tsx", "utf8");
  for (const source of [actions, builder]) {
    assert.ok(source.includes("findWorkstationPricingRow"));
    assert.ok(source.includes("rowId: workstationRowId"));
    assert.ok(source.includes("legacyLabel: workstationRowId ? null : deskingLabel"));
  }
});
