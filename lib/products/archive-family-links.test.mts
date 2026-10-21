import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ArchiveFamilyLinksPanel } from "../../components/products/archive-family-links-panel";
import { archiveLinksForTemplate, canRemoveArchiveLinks, requestArchiveLinkRemoval, type ArchiveLinkDisplay } from "./archive-family-links";
import { computeDeleteEligibilityPreview } from "./product-management-bulk-lifecycle";

const inactive: ArchiveLinkDisplay = { id: "link1", parent_template_id: "parent", linked_template_id: "child", is_active: false,
  parentName: "Desk", linkedName: "Pedestal", parentBrand: "Brand A", linkedBrand: "Brand B" };
const active = { ...inactive, id: "link2", is_active: true };
const render = (links: ArchiveLinkDisplay[], canRemove = true, templateId = "parent", loadError = false) => renderToStaticMarkup(React.createElement(ArchiveFamilyLinksPanel, {
  templateId, templateName: "Archived desk", links, canRemove, loadError,
  removeAction: async () => { assert.fail("Rendering must never mutate"); }, refresh: () => { assert.fail("Rendering must never refresh"); },
}));

test("zero, single and multiple links render counts and only inactive removal controls", () => {
  assert.match(render([]), /0 relationships/);
  assert.match(render([]), /No linked-family relationships/);
  assert.doesNotMatch(render([]), /Remove permanently/);
  assert.match(render([inactive]), /1 relationship/);
  assert.equal((render([inactive, { ...inactive, id: "third" }]).match(/Remove permanently/g) ?? []).length, 2);
  const html = render([inactive, active]);
  assert.match(html, /2 relationships/);
  assert.match(html, /Active — deactivate in product setup/);
  assert.equal((html.match(/Remove permanently/g) ?? []).length, 1);
});

test("both endpoints and cross-brand names are displayed; unrelated links excluded", () => {
  for (const id of ["parent", "child"]) assert.deepEqual(archiveLinksForTemplate(id, [inactive, active]), [inactive, active]);
  assert.deepEqual(archiveLinksForTemplate("unrelated", [inactive]), []);
  assert.match(render([inactive]), /Selected template is the parent/);
  assert.match(render([inactive], true, "child"), /Selected template is the linked product/);
  for (const name of ["Desk", "Pedestal", "Brand A", "Brand B"]) assert.ok(render([inactive]).includes(name));
});

test("actual DB roles only; disabled accounts and failed reads offer no removal", () => {
  for (const role of ["system_owner", "admin_manager", "sales_designer", "sales_coordinator"]) assert.equal(canRemoveArchiveLinks(role, "active"), true);
  for (const role of ["designer", "procurement", "viewer", null]) assert.equal(canRemoveArchiveLinks(role, "active"), false);
  assert.equal(canRemoveArchiveLinks("system_owner", "disabled"), false);
  assert.doesNotMatch(render([inactive], false), /Remove permanently/);
  assert.match(render([inactive], false), /Your role cannot/);
  assert.doesNotMatch(render([inactive], true, "parent", true), /Remove permanently/);
  assert.match(render([], true, "parent", true), /Could not load all relationships/);
  assert.doesNotMatch(render([], true, "parent", true), /No linked-family relationships/);
});

test("confirmed action refreshes; failures stay failures and also refresh stale data", async () => {
  const input = { templateId: "parent", relationshipId: "link1" };
  let calls = 0, refreshes = 0;
  for (const code of ["deleted", "forbidden", "stale", "active_link", "not_archived", "not_found", "unavailable", "unconfirmed"]) {
    const outcome = { ok: code === "deleted", code, message: code };
    assert.deepEqual(await requestArchiveLinkRemoval(input, async (actual) => { calls++; assert.deepEqual(actual, input); return outcome; }, () => { refreshes++; }), outcome);
  }
  assert.equal(calls, 8); assert.equal(refreshes, 8);
  const lost = await requestArchiveLinkRemoval(input, async () => { throw Error("Network failure"); }, () => { refreshes++; });
  assert.equal(lost.ok, false); assert.equal(lost.code, "unconfirmed"); assert.equal(refreshes, 9);
});

test("last-link eligibility follows refreshed data and historical warnings remain", () => {
  const template = { id: "parent", brandName: "Brand A", code: null, lifecycleStatus: "archived" as const, name: "Desk", linked: true, usedInQuotations: true };
  assert.equal(computeDeleteEligibilityPreview(new Set(["parent"]), [template]).eligibleCount, 0);
  const refreshed = { ...template, linked: false };
  assert.deepEqual(computeDeleteEligibilityPreview(new Set(["parent"]), [refreshed]), { eligibleCount: 1, historicalCount: 1, linkedBlockedCount: 0 });
});

test("UI wiring uses Phase A only, explicit confirmation and no automatic template deletion", () => {
  const panel = readFileSync(new URL("../../components/products/archive-family-links-panel.tsx", import.meta.url), "utf8");
  const archive = readFileSync(new URL("../../components/products/product-management-archive-results.tsx", import.meta.url), "utf8");
  assert.match(panel, /window\.confirm/);
  assert.doesNotMatch(panel, /permanentlyDeleteProductTemplate|supabase|\.delete\(/);
  assert.match(archive, /removeAction=\{removeArchivedProductFamilyLink\}/);
  assert.match(archive, /refresh=\{\(\) => router\.refresh\(\)\}/);
  assert.match(archive, /form action=\{permanentlyDeleteProductTemplate\}/);
  assert.match(archive, /template\.linked \? \(/);
});
