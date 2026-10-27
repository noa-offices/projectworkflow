import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-level checks, matching the other noa-phase-ua*-safety tests: the capability file uses
// "@/..." aliases and server-only imports that plain Node cannot resolve.
const source = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");

function block(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, endMarker);
  return source.slice(start, end);
}

test("ActivityCategory includes inventory and keeps every existing category", () => {
  const type = source.match(/type ActivityCategory =([^;]+);/)?.[1] ?? "";
  for (const name of ["inventory", "other", "procurement", "product_template", "project", "quotation"]) {
    assert.ok(type.includes(`"${name}"`), name);
  }
});

test("activityCategory maps inventory_* to inventory and leaves the others as they were", () => {
  const body = block("function activityCategory(", "const CATEGORY_LABEL");
  assert.match(body, /entityType\.startsWith\("inventory"\)\) return "inventory"/);
  assert.match(body, /entityType\.startsWith\("quotation"\)\) return "quotation"/);
  assert.match(body, /entityType === "product_template"\) return "product_template"/);
  assert.match(body, /entityType === "procurement_vendor"\) return "procurement"/);
  assert.match(body, /entityType === "project_activity"\) return "project"/);
  assert.match(body, /return "other"/);
});

test("the inventory label exists, and existing labels are unchanged", () => {
  const labels = block("const CATEGORY_LABEL", "};");
  assert.match(labels, /inventory: "inventory"/);
  assert.match(labels, /other: "other"/);
  assert.match(labels, /procurement: "procurement"/);
  assert.match(labels, /product_template: "product template"/);
  assert.match(labels, /project: "project"/);
  assert.match(labels, /quotation: "quotation"/);
});

test("summary text reads naturally for inventory", () => {
  // summaryAnswer: "<n> inventory-related recorded activities"; team summary: "<n> inventory activities".
  assert.match(source, /\$\{CATEGORY_LABEL\[category\]\}-related recorded activit/);
  assert.match(source, /\$\{CATEGORY_LABEL\[category as ActivityCategory\]\} activit/);
});

test("catch-up (event list) functions are not changed and do not know about inventory", () => {
  const catchUp = block("function catchUpIdentifierFromRow(", "async function quotationActivityAnswer(");
  assert.doesNotMatch(catchUp, /inventory|activityCategory|CATEGORY_LABEL/);
});
