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

// ── Upcoming Deliveries Client context (Part 5) - kept compact, combined on one line ──────────

test("Upcoming Delivery rows show Client without adding a row (combined on the existing Project line)", () => {
  const cardStart = dashboardSource.indexOf("Upcoming Deliveries");
  const cardBlock = dashboardSource.slice(cardStart, cardStart + 2000);
  assert.ok(cardBlock.includes("delivery.clientName &&"));
  assert.ok(cardBlock.includes("` · ${delivery.clientName}`"));
});

// ── Recent Work (Part 6): already shows Client - left unchanged ───────────────────────────────

test("10. Recent Work already surfaces Client (clientName) on every row - untouched by this task", () => {
  const recentWorkStart = dashboardSource.indexOf("Active Project Pipeline");
  const recentWorkBlock = dashboardSource.slice(recentWorkStart, recentWorkStart + 8000);
  assert.equal((recentWorkBlock.match(/project\.clientName/g) ?? []).length, 2); // mobile row + desktop row
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

test("9/12/13. Recent Work is inside the wide column of the SAME grid as the right rail - both start together, no artificial top gap", () => {
  // `items-start` is explicit (CSS Grid's default `align-items: stretch` would otherwise force
  // the shorter column to grow to match the taller one, which is what produced the trailing void -
  // this is a structural grid property, never a spacer/fixed-height/margin hack).
  assert.ok(dashboardSource.includes('<section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">'));
  assert.ok(!dashboardSource.includes("2xl:grid-cols-[minmax(0,1fr)_360px]"));
  const mainGridStart = dashboardSource.indexOf('<section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">');
  const leftColumnStart = dashboardSource.indexOf('<div className="grid gap-5">', mainGridStart);
  const asideStart = dashboardSource.indexOf("<aside", mainGridStart);
  const quickActionsIndex = dashboardSource.indexOf("Quick Actions", mainGridStart);
  const recentWorkIndex = dashboardSource.indexOf("Active Project Pipeline", mainGridStart);
  // Quick Actions and Recent Work are both inside the one left-column `div`, which in turn is a
  // direct child of the main grid `section` (not a separate row above/outside it) - and `aside`
  // (the right rail) is that same grid's other direct child, not nested inside the left column.
  assert.ok(leftColumnStart !== -1 && leftColumnStart < quickActionsIndex);
  assert.ok(quickActionsIndex < recentWorkIndex && recentWorkIndex < asideStart);
  // Recent Work is the direct next sibling after Quick Actions in the wide column - no spacer
  // element, fixed height, or extra margin was introduced between them.
  const between = dashboardSource.slice(quickActionsIndex, recentWorkIndex);
  assert.ok(!/style=\{\{/.test(between)); // no inline fixed-height/spacer styling
  assert.ok(!/<div className="h-\d/.test(between)); // no spacer div
  // The right rail (sidebar) is still present with all four of its existing cards (10/11/12/13).
  assert.ok(dashboardSource.includes("Procurement Workspace"));
  assert.ok(dashboardSource.includes("Upcoming Deliveries"));
  assert.ok(dashboardSource.includes("Yearly Turnover"));
  assert.ok(dashboardSource.includes("Sales Performance"));
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
