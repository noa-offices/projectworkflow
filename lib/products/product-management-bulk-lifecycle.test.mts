import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildBulkDeleteConfirmationMessage,
  bulkDeleteResultMessage,
  bulkLifecycleResultMessage,
  computeDeleteEligibilityPreview,
  pruneSelectionToVisibleIds,
  type ArchivedTemplateResult,
} from "./product-management-bulk-lifecycle.js";

function template(overrides: Partial<ArchivedTemplateResult> & { id: string }): ArchivedTemplateResult {
  return {
    brandName: "Brand",
    code: "CODE-1",
    lifecycleStatus: "archived",
    linked: false,
    name: "Template",
    usedInQuotations: false,
    ...overrides,
  };
}

// A. Selection pruning ------------------------------------------------------

test("pruneSelectionToVisibleIds keeps only ids still present in the visible list", () => {
  const selected = new Set(["a", "b", "c"]);
  const pruned = pruneSelectionToVisibleIds(selected, ["a", "c"]);
  assert.deepEqual(Array.from(pruned).sort(), ["a", "c"]);
});

test("pruneSelectionToVisibleIds returns an empty set when every selected id is now invisible", () => {
  const selected = new Set(["a", "b"]);
  const pruned = pruneSelectionToVisibleIds(selected, ["x", "y"]);
  assert.equal(pruned.size, 0);
});

test("pruneSelectionToVisibleIds preserves the selection when every selected id is still visible", () => {
  const selected = new Set(["a", "b"]);
  const pruned = pruneSelectionToVisibleIds(selected, ["a", "b", "c"]);
  assert.deepEqual(Array.from(pruned).sort(), ["a", "b"]);
});

// B. Delete preview -----------------------------------------------------------

test("delete preview counts unused, historical, and linked templates correctly; historical usage does not reduce eligibility", () => {
  const templates = [
    template({ id: "unused", linked: false, usedInQuotations: false }),
    template({ id: "historical", linked: false, usedInQuotations: true }),
    template({ id: "linked", linked: true, usedInQuotations: false }),
  ];
  const selected = new Set(["unused", "historical", "linked"]);

  const preview = computeDeleteEligibilityPreview(selected, templates);

  assert.equal(selected.size, 3);
  assert.equal(preview.eligibleCount, 2);
  assert.equal(preview.historicalCount, 1);
  assert.equal(preview.linkedBlockedCount, 1);
});

test("delete preview: only linked templates selected -> eligibleCount is 0", () => {
  const templates = [
    template({ id: "linked-1", linked: true }),
    template({ id: "linked-2", linked: true }),
  ];
  const preview = computeDeleteEligibilityPreview(new Set(["linked-1", "linked-2"]), templates);

  assert.equal(preview.eligibleCount, 0);
  assert.equal(preview.linkedBlockedCount, 2);
});

test("delete preview: only historical-quotation templates selected -> all remain eligible", () => {
  const templates = [
    template({ id: "hist-1", linked: false, usedInQuotations: true }),
    template({ id: "hist-2", linked: false, usedInQuotations: true }),
  ];
  const preview = computeDeleteEligibilityPreview(new Set(["hist-1", "hist-2"]), templates);

  assert.equal(preview.eligibleCount, 2);
  assert.equal(preview.historicalCount, 2);
  assert.equal(preview.linkedBlockedCount, 0);
});

// C. Delete confirmation -------------------------------------------------------

test("delete confirmation with eligible templates only states the permanent-delete count", () => {
  const message = buildBulkDeleteConfirmationMessage({ eligibleCount: 5, historicalCount: 0, linkedBlockedCount: 0 });
  assert.equal(message, "Delete 5 selected templates permanently?");
});

test("delete confirmation with historical quotation items includes the snapshot/history preservation warning", () => {
  const message = buildBulkDeleteConfirmationMessage({ eligibleCount: 3, historicalCount: 2, linkedBlockedCount: 0 });
  assert.match(message, /2 are used in historical quotations/);
  assert.match(message, /snapshots and history will remain/);
});

test("delete confirmation with linked items states linked templates will be skipped", () => {
  const message = buildBulkDeleteConfirmationMessage({ eligibleCount: 4, historicalCount: 0, linkedBlockedCount: 1 });
  assert.match(message, /1 linked template will be skipped\./);
});

test("delete confirmation with historical + linked mixed includes both warning clauses", () => {
  const message = buildBulkDeleteConfirmationMessage({ eligibleCount: 2, historicalCount: 1, linkedBlockedCount: 1 });
  assert.match(message, /Delete 2 selected templates permanently\?/);
  assert.match(message, /1 is used in historical quotations/);
  assert.match(message, /1 linked template will be skipped\./);
});

// D. Bulk lifecycle result messages --------------------------------------------

test("bulk lifecycle result message: all succeed", () => {
  assert.equal(bulkLifecycleResultMessage("Archived", 6, 0, "archived"), "Archived 6 templates.");
  assert.equal(bulkLifecycleResultMessage("Restored", 4, 0, "restored"), "Restored 4 templates.");
});

test("bulk lifecycle result message: partial failure", () => {
  assert.equal(bulkLifecycleResultMessage("Archived", 5, 1, "archived"), "Archived 5 templates. 1 could not be archived.");
  assert.equal(bulkLifecycleResultMessage("Restored", 3, 1, "restored"), "Restored 3 templates. 1 could not be restored.");
});

test("bulk lifecycle result message: singular/plural wording", () => {
  assert.equal(bulkLifecycleResultMessage("Archived", 1, 0, "archived"), "Archived 1 template.");
  assert.equal(bulkLifecycleResultMessage("Archived", 0, 1, "archived"), "Archived 0 templates. 1 could not be archived.");
});

// E. Bulk delete result messages -------------------------------------------------

test("bulk delete result message: all deleted", () => {
  assert.equal(
    bulkDeleteResultMessage({ blockedActiveCount: 0, blockedLinkedCount: 0, deletedCount: 7, failedCount: 0 }),
    "Permanently deleted 7 templates.",
  );
});

test("bulk delete result message: linked skipped", () => {
  assert.equal(
    bulkDeleteResultMessage({ blockedActiveCount: 0, blockedLinkedCount: 1, deletedCount: 6, failedCount: 0 }),
    "Permanently deleted 6 templates. 1 linked template skipped.",
  );
});

test("bulk delete result message: active skipped", () => {
  assert.equal(
    bulkDeleteResultMessage({ blockedActiveCount: 1, blockedLinkedCount: 0, deletedCount: 6, failedCount: 0 }),
    "Permanently deleted 6 templates. 1 active template skipped.",
  );
});

test("bulk delete result message: failed", () => {
  assert.equal(
    bulkDeleteResultMessage({ blockedActiveCount: 0, blockedLinkedCount: 0, deletedCount: 6, failedCount: 1 }),
    "Permanently deleted 6 templates. 1 template failed.",
  );
});

test("bulk delete result message: mixed linked + active + failed, no mention of historical quotation usage", () => {
  const message = bulkDeleteResultMessage({ blockedActiveCount: 1, blockedLinkedCount: 1, deletedCount: 5, failedCount: 1 });
  assert.equal(message, "Permanently deleted 5 templates. 1 linked template skipped. 1 active template skipped. 1 template failed.");
  assert.doesNotMatch(message, /quotation/i);
  assert.doesNotMatch(message, /historical/i);
});

// Source-wiring assertions -----------------------------------------------------

test("product-management-template-results.tsx imports pruneSelectionToVisibleIds from the shared helper module", () => {
  const source = readFileSync("components/products/product-management-template-results.tsx", "utf8");
  assert.match(source, /import\s*\{\s*pruneSelectionToVisibleIds\s*\}\s*from\s*"@\/lib\/products\/product-management-bulk-lifecycle"/);
});

test("product-management-archive-results.tsx imports the preview/confirmation helpers from the shared helper module", () => {
  const source = readFileSync("components/products/product-management-archive-results.tsx", "utf8");
  assert.match(source, /from\s*"@\/lib\/products\/product-management-bulk-lifecycle"/);
  assert.ok(source.includes("buildBulkDeleteConfirmationMessage"));
  assert.ok(source.includes("computeDeleteEligibilityPreview"));
});

test("actions.ts imports the bulk message helpers from the shared helper module", () => {
  const source = readFileSync("app/products/templates/actions.ts", "utf8");
  assert.match(source, /import\s*\{\s*bulkDeleteResultMessage,\s*bulkLifecycleResultMessage\s*\}\s*from\s*"@\/lib\/products\/product-management-bulk-lifecycle"/);
});
