import assert from "node:assert/strict";
import test from "node:test";
import { revealSmartSetupGroup, smartRouteElementId, smartSetupBlockingIssues } from "./smart-product-review-issues.js";

const routes = [{ key: "option:top", sourceName: "COMBY Finishing Top" }, { key: "option:kit", sourceName: "Master Key Kit" }, { key: "option:kit2", sourceName: "Master Key Kit 2" }];

test("blocking issues are counted, deduplicated and attributed to a group only when unambiguous", () => {
  const issues = smartSetupBlockingIssues({ routes, routingErrors: ["COMBY Finishing Top references a row.", "COMBY Finishing Top references a row.", "Master Key Kit 2 x", "Unknown thing"], currencyBlocked: true, accessoryReviewMessage: "Resolve accessories" });
  assert.deepEqual(issues.map((i) => i.routeKey), ["option:top", "option:kit2", null, null, null]);
  assert.equal(issues.length, 5);
});

test("no issues when nothing blocks Apply, and a needs_review blocker still counts", () => {
  assert.equal(smartSetupBlockingIssues({ routes, routingErrors: [], currencyBlocked: false, accessoryReviewMessage: null }).length, 0);
  assert.equal(smartSetupBlockingIssues({ routes, routingErrors: [], currencyBlocked: false, accessoryReviewMessage: "needs review" }).length, 1);
});

test("Go to group expands ancestors and the group, scrolls and highlights; unknown group is a no-op", () => {
  const mk = (tagName: string, parentElement: unknown = null) => ({ tagName, open: false, parentElement, classes: new Set<string>(), scrolled: false, inner: null as unknown, querySelector() { return this.inner; }, scrollIntoView() { this.scrolled = true; }, classList: { add() {}, remove() {} } });
  const section = mk("DETAILS");
  const article = mk("ARTICLE", section);
  const own = mk("DETAILS", article);
  article.inner = own;
  let timer: (() => void) | null = null;
  const doc = { getElementById: (id: string) => id === smartRouteElementId("option:top") ? article : null };
  assert.equal(revealSmartSetupGroup(doc, "option:top", (cb) => { timer = cb; }), true);
  assert.equal(section.open, true); assert.equal(own.open, true); assert.equal(article.scrolled, true); assert.ok(timer);
  assert.equal(revealSmartSetupGroup(doc, "nope"), false);
});
