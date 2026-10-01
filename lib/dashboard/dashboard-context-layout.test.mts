// Dashboard Context + Layout Polish: Client-context typographic hierarchy on Attention/Upcoming-
// Delivery rows, and the main-content grid breakpoint fix that removes the dead space below
// Quick Actions. Source-text checks only - erp-dashboard.tsx is a "use client" component with
// "@/..." aliases not resolvable by Node's plain ESM resolver outside the Next.js build, matching
// the convention already used throughout this codebase's *-safety.test.mts files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const dashboardSource = normalize(readFileSync("components/dashboard/erp-dashboard.tsx", "utf8"));
const actionsSource = normalize(readFileSync("lib/dashboard/actions.ts", "utf8"));

// ── Typographic hierarchy (Part 12) ────────────────────────────────────────────────────────

test("Attention rows render Client as its own muted line, between Project/reference and the vendor list", () => {
  const rowStart = dashboardSource.indexOf("function AttentionCategoryRow(");
  const rowBody = dashboardSource.slice(rowStart, dashboardSource.indexOf("\n}\n", rowStart));
  const secondaryIndex = rowBody.indexOf("item.secondary &&");
  const clientIndex = rowBody.indexOf("item.clientName &&");
  const tertiaryIndex = rowBody.indexOf("item.tertiary &&");
  assert.ok(secondaryIndex !== -1 && clientIndex !== -1 && tertiaryIndex !== -1);
  // Hierarchy order: secondary (Project/reference) -> clientName (Client) -> tertiary (vendors).
  assert.ok(secondaryIndex < clientIndex && clientIndex < tertiaryIndex);
  // Client sits between secondary's and tertiary's text sizes, per Part 12's "smaller muted" tier.
  assert.ok(rowBody.includes('text-[11px] text-zinc-500">{item.secondary}'));
  assert.ok(rowBody.includes('text-[11px] text-zinc-400">{item.clientName}'));
  assert.ok(rowBody.includes('text-[10px] text-zinc-400">{item.tertiary}'));
});

test("Client fallback (Part 13): no placeholder text is ever rendered for a missing Client", () => {
  assert.ok(!/Unknown Client|No Client|N\/A/.test(dashboardSource));
});

// ── Upcoming Deliveries Client context - Recent Work + Upcoming Deliveries Context Polish gave
// Client its own dedicated muted line (previously combined with Project on one line) ───────────

test("Upcoming Delivery rows show Client on its own dedicated, safely-omittable line", () => {
  const cardStart = dashboardSource.indexOf("Upcoming Deliveries");
  const cardBlock = dashboardSource.slice(cardStart, cardStart + 2000);
  assert.ok(cardBlock.includes("delivery.clientName && ("));
  assert.ok(cardBlock.includes("{delivery.clientName}</span>"));
  assert.ok(!cardBlock.includes("` · ${delivery.clientName}`")); // no longer combined onto the Project line
});

// ── Recent Work: Client shown on its own line, safely omitted when absent ──────────────────────

test("10. Recent Work surfaces Client (clientName) on every row, guarded for safe omission", () => {
  const recentWorkStart = dashboardSource.indexOf("Active Project Pipeline");
  const recentWorkBlock = dashboardSource.slice(recentWorkStart, recentWorkStart + 8000);
  // Each of the 2 rows (mobile + desktop) guards clientName with `project.clientName && (...)`,
  // so the identifier appears twice per row (condition + interpolation) = 4 total.
  assert.equal((recentWorkBlock.match(/project\.clientName/g) ?? []).length, 4);
});

// ── No per-row Client query (Part 14 / Part 16 #4/#11) ──────────────────────────────────────

test("4/11. Procurement/Upcoming-Delivery Client context is still propagated entirely from data already in memory - no clients/projects query there", () => {
  assert.ok(!actionsSource.includes('.from("projects")'));
  // clientName for grouped Procurement items and Upcoming Deliveries both read from the existing
  // DashboardProject map only - no query at all for those two paths.
  assert.ok(actionsSource.includes("clientName: project?.clientName"));
});

test("4. the one Client fallback query that does exist (quotations without a Project File snapshot) is bounded to distinct client_ids, never per-row", () => {
  const fnStart = actionsSource.indexOf("export async function getDashboardStats(");
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\nexport async function getActiveProjects", fnStart));
  assert.ok(fnBody.includes('.from("clients")'));
  assert.ok(fnBody.includes('.in("id", missingClientIds)'));
  // Only ONE .from("clients") call site in the whole function - never inside the per-quotation loop.
  assert.equal((fnBody.match(/\.from\("clients"\)/g) ?? []).length, 1);
});

// ── Layout: main content grid starts together at `lg`, removing the dead space (Part 7-9) ──────

// ── Executive composition (Dashboard Executive UI Composition Pass) ─────────────────────────

const headingIndex = (text: string) => dashboardSource.indexOf(`>${text}</p>`);

test("executive hierarchy: KPIs -> Project Value -> Commercial -> Attention/Workflow -> Quick Actions -> Workspace", () => {
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
  assert.ok(order.every((i) => i !== -1), `missing section: ${JSON.stringify(order)}`);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `out of order at ${i}`);
});

test("1/2/3. Sales Performance and Yearly Turnover share one commercial row, rendered before Attention Required", () => {
  const commercialStart = headingIndex("Commercial Performance");
  const attention = headingIndex("Attention Required");
  const sales = dashboardSource.indexOf(">Sales Performance</p>");
  const turnover = dashboardSource.indexOf("Yearly Turnover ({new Date().getFullYear()})");
  assert.ok(commercialStart < sales && sales < turnover && turnover < attention);
  // Sales Performance takes 2/3 and Turnover 1/3 at `lg`, stacking below it.
  const commercialBlock = dashboardSource.slice(commercialStart, attention);
  assert.ok(commercialBlock.includes('<div className="grid gap-4 lg:grid-cols-3">'));
  assert.ok(commercialBlock.includes('<DashboardCard className="overflow-hidden lg:col-span-2">'));
  // Each commercial widget appears exactly once - moved, not duplicated.
  assert.equal((dashboardSource.match(/>Sales Performance<\/p>/g) ?? []).length, 1);
  assert.equal((dashboardSource.match(/Yearly Turnover \(\{new Date\(\)\.getFullYear\(\)\}\)/g) ?? []).length, 1);
});

test("10. commercial widgets still read the same unchanged data contract (no metric prop changed)", () => {
  assert.ok(dashboardSource.includes("{formatAED(salesData.yearlyTurnover)}"));
  assert.ok(dashboardSource.includes('<MonthlyBarChart data={monthlyData} color="#10b981" />'));
  assert.ok(dashboardSource.includes("salesData.salesByPerson.map((person) =>"));
  assert.ok(dashboardSource.includes("const barPct = maxTotal > 0 ? (person.total / maxTotal) * 100 : 0;"));
});

test("9/12/13. Workspace grid: Recent Work and the (now short) operational rail start together; Quick Actions is its own row above it", () => {
  // `items-start` keeps each column at its own content height (CSS Grid's default `stretch` would
  // force the shorter column to match the taller one) - a structural grid property, not a hack.
  const gridTag = '<section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">';
  assert.ok(dashboardSource.includes(gridTag));
  assert.ok(!dashboardSource.includes("2xl:grid-cols-[minmax(0,1fr)_360px]"));
  const gridStart = dashboardSource.indexOf(gridTag);
  assert.ok(headingIndex("Quick Actions") < gridStart); // standalone row, not inside the grid
  const asideStart = dashboardSource.indexOf("<aside", gridStart);
  const asideEnd = dashboardSource.indexOf("</aside>", asideStart);
  const recentWork = headingIndex("Recent Work");
  assert.ok(gridStart < recentWork && recentWork < asideStart);
  // The rail now holds only the two operational cards - no tall commercial stack.
  const rail = dashboardSource.slice(asideStart, asideEnd);
  assert.ok(rail.includes("Procurement Workspace"));
  assert.ok(rail.includes("Upcoming Deliveries"));
  assert.ok(!rail.includes("Sales Performance"));
  assert.ok(!rail.includes("Yearly Turnover"));
  // No spacer/fixed-height element between Quick Actions and Recent Work.
  const between = dashboardSource.slice(headingIndex("Quick Actions"), recentWork);
  assert.ok(!/style=\{\{/.test(between));
  assert.ok(!/<div className="h-\d/.test(between));
});

test("14. no fixed-height/negative-margin/absolute-position layout hack was introduced, and responsive stacking is a valid standard Tailwind pattern", () => {
  assert.ok(dashboardSource.includes('<aside className="grid gap-4">'));
  // The main content grid declares its column split only via `items-start` + `lg:grid-cols-[...]`
  // Tailwind classes (no separate inline style on that section) - the 360px right-rail width is
  // pre-existing and unchanged, only the breakpoint moved. (The pre-existing Sales Performance
  // progress-bar inline width is unrelated per-row data styling, not a layout hack, untouched.)
  const mainGridStart = dashboardSource.indexOf('<section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">');
  const mainGridTag = dashboardSource.slice(mainGridStart, mainGridStart + 200);
  assert.ok(!mainGridTag.includes("style={{"));
  assert.ok(!/-m[trblxy]?-\d|margin:\s*-/.test(dashboardSource.slice(mainGridStart, mainGridStart + 4000))); // no negative margin near the grid
  assert.ok(!/absolute|fixed\s+inset|min-h-screen|100vh/.test(dashboardSource));
});

test("Attention Required / Quotation Workflow top row also starts together at the same `lg` breakpoint, consistent with the main grid", () => {
  assert.ok(dashboardSource.includes('className="scroll-mt-5 grid gap-4 rounded-lg outline-none transition target:ring-2 target:ring-amber-400 target:ring-offset-2 lg:grid-cols-2"'));
});

// ── 15. all existing dashboard widgets preserved ────────────────────────────────────────────

test("15. all existing dashboard widgets are still present - no widget added or removed", () => {
  for (const label of [
    "Active Projects",
    "Pending Quotations",
    "Confirmed Value",
    "Attention Items",
    "Active Project Value",
    "Completed Project Value",
    "Attention Required",
    "Quotation Workflow",
    "Quick Actions",
    "Recent Work",
    "Procurement Workspace",
    "Upcoming Deliveries",
    "Yearly Turnover",
    "Sales Performance",
  ]) {
    assert.ok(dashboardSource.includes(label), `missing widget: ${label}`);
  }
});

// ── 16/17. existing business logic/metrics unchanged ────────────────────────────────────────

test("16. Project Value KPIs unchanged", () => {
  assert.ok(dashboardSource.includes('label: "Active Project Value",'));
  assert.ok(dashboardSource.includes("value: formatAED(stats.activeProjectValue),"));
  assert.ok(dashboardSource.includes('label: "Completed Project Value",'));
  assert.ok(dashboardSource.includes("value: formatAED(stats.completedProjectValue),"));
});

test("17. Attention expand/collapse interaction is unchanged", () => {
  assert.ok(dashboardSource.includes("const [expandedAttentionKey, setExpandedAttentionKey] = useState<string | null>(null);"));
  assert.ok(dashboardSource.includes('aria-expanded={isExpanded}'));
  assert.ok(dashboardSource.includes('isExpanded ? "rotate-90" : ""'));
});

// ── 8/9. Attention issue counts/grouping unchanged ──────────────────────────────────────────

test("8/9. Attention issue counts and grouping semantics are unchanged by this task", () => {
  assert.ok(actionsSource.includes("count,\n    totalCount: groupCount,"));
  assert.ok(actionsSource.includes("if (!vendors.includes(row.vendorKey)) vendors.push(row.vendorKey);"));
});
