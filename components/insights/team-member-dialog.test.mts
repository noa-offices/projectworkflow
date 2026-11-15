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

// ── Amount toggle (millions / full AED) and chart scale ──────────────────────
import { amountModeQuery, formatSalesReportAED, formatSalesReportAEDMillions, parseAmountMode } from "../../lib/insights/sales-report-money.js";
import { formatAxisMoney, niceAxisScale } from "../../lib/insights/sales-report-chart-scale.js";

test("money format: millions is unchanged, full AED is whole numbers with commas", () => {
  assert.equal(formatSalesReportAED(97350, "millions"), "AED 0.097M");
  assert.equal(formatSalesReportAED(97350, "millions"), formatSalesReportAEDMillions(97350));
  assert.equal(formatSalesReportAED(97350, "full"), "AED 97,350");
  assert.equal(formatSalesReportAED(0, "millions"), "AED 0.000M");
  assert.equal(formatSalesReportAED(0, "full"), "AED 0");
  assert.equal(formatSalesReportAED(0.4, "full"), "AED 0");
  assert.equal(formatSalesReportAED(1_200_000, "millions"), "AED 1.20M");
  assert.equal(formatSalesReportAED(1_200_000, "full"), "AED 1,200,000");
  assert.equal(formatSalesReportAED(-97350, "full"), "AED -97,350");
  assert.equal(formatSalesReportAED(-97350, "millions"), "AED -0.097M");
  assert.equal(formatSalesReportAED(Number.NaN, "full"), "AED 0");
  assert.equal(formatSalesReportAED(97350, "full", { includeCurrency: false }), "97,350");
});

test("amount param: full only when exactly amount=full; toggling keeps every other param", () => {
  assert.equal(parseAmountMode("full"), "full");
  assert.equal(parseAmountMode(undefined), "millions");
  assert.equal(parseAmountMode("FULL"), "millions");
  const open = "range=6m&teamView=contribution&user=abc";
  assert.equal(amountModeQuery(open, "full"), `${open}&amount=full`);
  assert.equal(amountModeQuery(`${open}&amount=full`, "millions"), open);
  // date range change and popup close keep amount: they start from the existing query / reportHref
  assert.equal(new URLSearchParams(amountModeQuery("range=ytd&amount=full", "full")).get("range"), "ytd");
  assert.ok(selector.includes("new URLSearchParams(searchParams.toString())"));
  assert.ok(/if \(amountMode === "full"\) baseReportParams\.set\("amount", "full"\);/.test(page), "closeHref/prev/next/rows keep amount");
});

test("toggle sits on the page bar and in the popup header", () => {
  assert.ok(page.includes("<AmountModeToggle />"));
  assert.ok(dialog.includes("<AmountModeToggle preserveScroll />"));
  const toggle = read("components/insights/amount-mode-toggle.tsx");
  assert.ok(toggle.includes("useSearchParams") && toggle.includes("amountModeQuery"));
});

test("with amount=full no component on this page still prints the millions format", () => {
  assert.ok(!page.includes("formatSalesReportAEDMillions"), "page");
  const charts = read("components/insights/sales-performance-charts.tsx");
  assert.ok(!charts.includes("formatSalesReportAEDMillions"), "charts");
  assert.ok(charts.includes("formatAxisMoney(value, amountMode)") && charts.includes("formatSalesReportAED("));
  assert.equal(
    (page.match(/amountMode=\{amountMode\}/g) ?? []).length >= 5, true,
    "every money component gets the mode",
  );
});

test("chart scale: a zero month is not a full bar, axis labels differ, full mode labels are short", () => {
  const zero = niceAxisScale(0);
  assert.ok(zero.max > 0 && new Set(zero.ticks).size === zero.ticks.length);
  const counts = niceAxisScale(1, { integer: true });
  assert.ok(counts.max >= 1 && counts.ticks.every(Number.isInteger) && new Set(counts.ticks).size === counts.ticks.length);
  assert.equal(counts.ticks[0], 0);
  const money = niceAxisScale(97350);
  assert.ok(money.max >= 97350 && money.ticks[0] === 0);
  assert.deepEqual(niceAxisScale(97350).ticks.map((tick) => formatAxisMoney(tick, "full")), ["0", "25K", "50K", "75K", "100K"]);
  assert.equal(formatAxisMoney(1_500_000, "full"), "1.5M");
  assert.equal(formatAxisMoney(25_000, "millions"), "0.025M");
  assert.equal(new Set(money.ticks.map((tick) => formatAxisMoney(tick, "millions"))).size, money.ticks.length);
});

test("popup chart plots counts, not AED, and the layout no longer uses the sticky 2xl aside", () => {
  assert.ok(page.includes('valueKind="count"') && page.includes("showRepChart={false}"));
  assert.ok(!page.includes("2xl:sticky"));
  assert.ok(page.includes("xl:grid-cols-[minmax(0,1fr)_320px]"));
  assert.ok(page.includes("sm:grid-cols-2 xl:grid-cols-4"));
});
