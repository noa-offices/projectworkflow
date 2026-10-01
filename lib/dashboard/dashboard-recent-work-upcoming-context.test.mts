// Dashboard Recent Work + Upcoming Deliveries Context Polish. Source-text checks only -
// erp-dashboard.tsx is a "use client" component with "@/..." aliases not resolvable by Node's
// plain ESM resolver outside the Next.js build, matching the convention already used throughout
// this codebase's *-safety.test.mts files. No data-layer changes were needed for this task -
// DashboardProject already carried `reference`/`clientName`, and UpcomingDelivery already carried
// `clientName` (confirmed by inspecting lib/dashboard/actions.ts before editing) - so these are
// purely structural/JSX assertions against the one changed production file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const dashboardSource = normalize(readFileSync("components/dashboard/erp-dashboard.tsx", "utf8"));
const actionsSource = normalize(readFileSync("lib/dashboard/actions.ts", "utf8"));

function recentWorkBlock() {
  const start = dashboardSource.indexOf(">Recent Work</p>");
  const end = dashboardSource.indexOf("{expandedOrderNo && (", start);
  return dashboardSource.slice(start, end);
}

// ── 1. Type column removed ──────────────────────────────────────────────────────────────────

test("1. Recent Work no longer renders the empty Type column", () => {
  const block = recentWorkBlock();
  assert.ok(!block.includes(">Type<"));
  assert.ok(!/<td[^>]*>\s*—\s*<\/td>/.test(block)); // the old always-dash cell is gone
  assert.ok(block.includes(">Project<"));
  assert.ok(block.includes(">Status<"));
});

// ── 2/3. Project number + Project name displayed ───────────────────────────────────────────

test("2/3. Recent Work displays both the Project/order number and the Project name (reference)", () => {
  const block = recentWorkBlock();
  // Desktop row.
  assert.ok(block.includes("<p className=\"font-semibold text-zinc-950\">{project.orderNo}</p>"));
  assert.ok(block.includes("{project.reference && ("));
  assert.ok(block.includes("{project.reference}</p>"));
  // Mobile row.
  assert.ok(block.includes('text-sm font-semibold text-zinc-950">{project.orderNo}</span>'));
  assert.ok(block.includes("{project.reference}</span>"));
});

// ── 4/5. Client shown when available, safely omitted when absent ──────────────────────────────

test("4/5. Recent Work shows Client when available and safely omits the line when absent (no placeholder)", () => {
  const block = recentWorkBlock();
  assert.ok(block.includes("{project.clientName && ("));
  assert.ok(block.includes("{project.clientName}</p>"));
  assert.ok(block.includes("{project.clientName}</span>"));
  assert.ok(!/Unknown Client|No Client|N\/A/.test(block));
});

// ── 6. Status preserved ─────────────────────────────────────────────────────────────────────

test("6. Recent Work Status badge is preserved, aligned in its own column", () => {
  const block = recentWorkBlock();
  assert.equal((block.match(/className="[^"]*rounded-full bg-emerald-50 px-2\.5 py-0\.5 text-xs font-semibold text-emerald-800"/g) ?? []).length, 2); // mobile + desktop
  assert.equal((block.match(/>\s*Active\s*</g) ?? []).length, 2);
});

// ── 7. activity expansion preserved ─────────────────────────────────────────────────────────

test("7. Recent Work row click / activity expansion behavior is unchanged", () => {
  assert.ok(dashboardSource.includes("async function handleRowClick(orderNo: string) {"));
  assert.ok(dashboardSource.includes("onClick={() => handleRowClick(project.orderNo)}"));
  assert.ok(dashboardSource.includes("const activity = await getProjectRecentActivity(orderNo);"));
  assert.ok(dashboardSource.includes("{expandedOrderNo && ("));
  // Filter/search input is untouched.
  assert.ok(dashboardSource.includes('placeholder="Filter orders…"'));
  assert.ok(dashboardSource.includes("onChange={(e) => setSearchQuery(e.target.value)}"));
});

// ── 8/9/10/11/12. Upcoming Delivery hierarchy ───────────────────────────────────────────────

function upcomingBlock() {
  const start = dashboardSource.indexOf("Upcoming Deliveries");
  const end = dashboardSource.indexOf("{/* Yearly Turnover", start); // bounded past the card
  return dashboardSource.slice(start, end === -1 ? start + 2500 : end);
}

test("8/9. Upcoming Delivery displays ETA and Vendor prominently", () => {
  const block = upcomingBlock();
  assert.ok(block.includes("{formatEtaDate(delivery.eta)}"));
  assert.ok(block.includes("{delivery.vendorLabel}</span>"));
});

test("10/11/12. Upcoming Delivery shows Project name, then Client on its own line when available, and still renders safely when Client is missing", () => {
  const block = upcomingBlock();
  assert.ok(block.includes("{delivery.projectName}</span>"));
  assert.ok(block.includes("{delivery.clientName && ("));
  assert.ok(block.includes("{delivery.clientName}</span>"));
  // Client line text size is the most muted tier, distinct from the Project line above it.
  const projectLineIndex = block.indexOf("{delivery.projectName}</span>");
  const clientLineIndex = block.indexOf("{delivery.clientName}</span>");
  assert.ok(projectLineIndex < clientLineIndex);
});

// ── 13. no per-row Client query ─────────────────────────────────────────────────────────────

test("13. no per-row Client query was introduced for either widget - clientName still comes entirely from already-fetched data", () => {
  assert.ok(!actionsSource.includes('.from("clients")') || actionsSource.includes('.in("id", missingClientIds)')); // the one pre-existing bounded fallback query, if present, is still bounded
  assert.ok(actionsSource.includes("clientName: pf.clientName, reference: pf.reference")); // DashboardProject source
  assert.ok(actionsSource.includes("clientName: project?.clientName")); // UpcomingDelivery source
  // getDashboardUpcomingDeliveries still issues exactly one bounded procurement_vendor_progress
  // query - no new query was added for this task.
  const fnStart = actionsSource.indexOf("export async function getDashboardUpcomingDeliveries(");
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n}", fnStart));
  assert.equal((fnBody.match(/\.from\(/g) ?? []).length, 1);
});

// ── 14. exact delivery href unchanged ───────────────────────────────────────────────────────

test("14. the exact Upcoming Delivery href is unchanged", () => {
  assert.ok(actionsSource.includes('href: `/procurement/orders/${encodeURIComponent(row.order_no)}`'));
});

// ── 15. ETA filtering/sorting unchanged ─────────────────────────────────────────────────────

test("15. ETA filtering, sorting and limit are unchanged", () => {
  const fnStart = actionsSource.indexOf("export async function getDashboardUpcomingDeliveries(");
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n}", fnStart));
  assert.ok(fnBody.includes('.not("eta", "is", null)'));
  assert.ok(fnBody.includes('.gte("eta", today)'));
  assert.ok(fnBody.includes('.order("eta", { ascending: true })'));
  assert.ok(fnBody.includes(".limit(MAX_UPCOMING_DELIVERIES)"));
});

// ── 16/17. previous layout + other widgets unchanged ────────────────────────────────────────

test("16. the previous executive layout composition is unchanged", () => {
  const headingIndex = (text: string) => dashboardSource.indexOf(`>${text}</p>`);
  const order = [
    dashboardSource.indexOf("{/* ── KPI Row"),
    headingIndex("Project Value"),
    headingIndex("Commercial Performance"),
    headingIndex("Attention Required"),
    headingIndex("Quotation Workflow"),
    headingIndex("Quick Actions"),
    headingIndex("Recent Work"),
    headingIndex("Procurement Workspace"),
    headingIndex("Upcoming Deliveries"),
  ];
  assert.ok(order.every((i) => i !== -1));
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i]);
});

test("17. Attention / Sales Performance / Project Value widgets are untouched", () => {
  assert.ok(dashboardSource.includes("const procurementAttentionCategories: AttentionCategory[] = procurementAttention"));
  assert.ok(dashboardSource.includes("salesData.salesByPerson.map((person) =>"));
  assert.ok(dashboardSource.includes('label: "Active Project Value",'));
  assert.ok(dashboardSource.includes('label: "Completed Project Value",'));
});
