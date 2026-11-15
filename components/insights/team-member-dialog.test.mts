import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { memberInitials, teamMemberNeighbours } from "../../lib/insights/team-member-dialog.js";
import { TeamMemberEmptyState, TeamMemberSkeleton } from "./team-member-states.js";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const page = read("app/insights/sales-report/page.tsx");
const dialog = read("components/insights/team-member-dialog.tsx");
const selector = read("components/insights/date-range-selector.tsx");

test("Prev / Next move to the neighbour member and stop at the ends", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(teamMemberNeighbours(ids, "b"), { index: 1, total: 3, prevId: "a", nextId: "c" });
  assert.equal(teamMemberNeighbours(ids, "a").prevId, null);
  assert.equal(teamMemberNeighbours(ids, "c").nextId, null);
  assert.deepEqual(teamMemberNeighbours(ids, "zzz"), { index: -1, total: 3, prevId: null, nextId: null });
});

test("avatar initials", () => {
  assert.equal(memberInitials("Ayesha Khan"), "AK");
  assert.equal(memberInitials("  "), "?");
});

test("empty and loading states render", () => {
  assert.ok(renderToStaticMarkup(createElement(TeamMemberEmptyState)).includes("No data in this period"));
  const skeleton = renderToStaticMarkup(createElement(TeamMemberSkeleton));
  assert.ok(skeleton.includes('role="status"') && skeleton.includes("animate-pulse"));
});

test("popup: Close, Esc and background click all go to the close href (no user); focus and scroll handled", () => {
  assert.ok(dialog.includes("showModal()"));
  assert.ok(/onCancel=\{\(event\) => \{ event\.preventDefault\(\); go\(closeHref\); \}\}/.test(dialog), "Esc");
  assert.ok(/onBackdropClick[\s\S]*go\(closeHref\)/.test(dialog), "background click");
  assert.ok(/data-panel-close[^>]*onClick=\{\(\) => go\(closeHref\)\}/.test(dialog), "close button");
  assert.ok(dialog.includes("trigger.focus"), "focus returns to the clicked row");
  assert.ok(dialog.includes('node.style.overflow = "hidden"'), "page scroll lock");
  assert.ok(dialog.includes("prefers-reduced-motion: reduce"));
  assert.ok(dialog.includes("ArrowLeft") && dialog.includes("ArrowRight"));
  assert.ok(dialog.includes("<TeamMemberSkeleton />"));
});

test("page: closeHref drops user, row hrefs keep user, popup date change goes through the page range URL", () => {
  assert.ok(/closeHref=\{reportHref\(\)\}/.test(page));
  assert.ok(/const rowHref = reportHref\(\{ user: member\.userId \}\);/.test(page));
  // reportHref() starts from baseReportParams (range, teamView, from/to) and never includes user.
  assert.ok(!/baseReportParams\.set\("user"/.test(page));
  // The popup reuses the page DateRangeSelector, which sets `range` on the URL and keeps `user`.
  assert.ok(dialog.includes("<DateRangeSelector"));
  assert.ok(selector.includes('params.set("range", range)'));
  assert.ok(selector.includes("new URLSearchParams(searchParams.toString())"));
  assert.ok(!/params\.delete\("user"\)/.test(selector));
});

test("the inline profile section is no longer rendered", () => {
  assert.ok(!page.includes('className="border-t border-emerald-200 bg-emerald-50/30 p-5"'));
  assert.ok(!page.includes("Close ×"));
  assert.ok(page.includes("<TeamMemberDialog"));
});

test("permissions are unchanged: only a system_owner sees a member that is in the loaded team stats", () => {
  assert.ok(page.includes('profile?.role === "system_owner"\n      ? loadTeamStats(teamDateRange)'));
  assert.ok(
    page.includes(`    rawUser &&
    UUID_RE.test(rawUser) &&
    profile?.role === "system_owner" &&
    teamStats != null &&
    teamStats.some((m) => m.userId === rawUser)
      ? rawUser
      : null;`),
  );
  assert.ok(page.includes("selectedUserStats && selectedUserInfo ? (\n              <TeamMemberDialog"));
  assert.ok(page.includes('{profile?.role === "system_owner" && teamStats && teamStats.length > 0 ? ('));
});
