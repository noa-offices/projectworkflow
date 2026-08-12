import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { manufacturerFinishGuidanceFromForm, mergeManufacturerFinishGuidance, normalizeManufacturerFinishGuidance } from "./manufacturer-finish-guidance.js";

const top = { id: "top", label: "Top Finishes", notes: "103 Bali Walnut, 155 Slate", supplierCodes: ["103"], referenceCodes: ["TOP"] };

test("migration adds only a nullable template guidance JSONB column", () => {
  const migration = readFileSync("supabase/migrations/099_product_template_material_suggestions.sql", "utf8");
  assert.match(migration, /alter table public\.product_templates/); assert.match(migration, /material_suggestions jsonb;/); assert.doesNotMatch(migration, /not null/i);
});

test("guidance normalizes nullable persisted JSON and preserves source order", () => {
  assert.deepEqual(normalizeManufacturerFinishGuidance(null), []);
  assert.deepEqual(normalizeManufacturerFinishGuidance([top, { id: "metal", label: "Metal Structure", notes: "Black, Rust", supplierCodes: [], referenceCodes: [] }]), [top, { id: "metal", label: "Metal Structure", notes: "Black, Rust", supplierCodes: [], referenceCodes: [] }]);
});

test("form guidance preserves labels, notes, and source references", () => {
  const form = new FormData(); form.set("material_suggestions", JSON.stringify([top]));
  assert.deepEqual(manufacturerFinishGuidanceFromForm(form.get("material_suggestions")), [top]);
  assert.deepEqual(manufacturerFinishGuidanceFromForm("not-json"), []);
});

test("incremental guidance adds only new groups and never replaces existing edits", () => {
  const current = [{ ...top, notes: "Edited manually" }];
  const incoming = [top, { id: "ceramic", label: "Ceramic Top", notes: "White Calacatta", supplierCodes: ["140"], referenceCodes: [] }];
  assert.deepEqual(mergeManufacturerFinishGuidance(current, incoming), [...current, incoming[1]]);
});
