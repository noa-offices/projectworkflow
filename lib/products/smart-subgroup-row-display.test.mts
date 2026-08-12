import assert from "node:assert/strict";
import test from "node:test";
import { smartSubgroupRowLabel } from "./smart-subgroup-row-display.js";

const row = (overrides: Partial<Parameters<typeof smartSubgroupRowLabel>[0]> = {}) => ({ displayName: "Executive Desk", label: "Executive Desk", supplierCodes: [], referenceCodes: [], ...overrides });

test("Smart Setup subgroup labels use the primary supplier code, then reference code, without placeholders", () => {
  assert.equal(smartSubgroupRowLabel(row({ supplierCodes: ["1AF 001", "1AF ALT"] })), "1AF 001 — Executive Desk");
  assert.equal(smartSubgroupRowLabel(row({ referenceCodes: ["REF 001"] })), "REF 001 — Executive Desk");
  assert.equal(smartSubgroupRowLabel(row({ supplierCodes: [], referenceCodes: [] })), "Executive Desk");
  assert.equal(smartSubgroupRowLabel(row({ displayName: null, label: "1AF 001" })), "1AF 001");
});
