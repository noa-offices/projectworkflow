// Dashboard Attention Drill-Down: expandable affected-record lists. Real execution against a
// fake supabase client + fake loadProcurementSummary() for the two data-layer functions in
// lib/dashboard/actions.ts (getDashboardStats' pendingQuotations group, and
// getDashboardProcurementAttention), plus source-text checks for app/dashboard/page.tsx (role
// gating/active-order scope reuse) and components/dashboard/erp-dashboard.tsx (collapsed-by-
// default, expand-on-click, no-navigate header, zero-row omission, HR/Project-Value rows intact)
// - both are "use client"/Server Component files with "@/..." aliases not resolvable by Node's
// plain ESM resolver outside the Next.js build, matching the convention already used throughout
// this codebase's *-safety.test.mts files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

// ── Fixtures / mocks ─────────────────────────────────────────────────────────────────────────

let summaryFixture: {
  openPoCount: number;
  vendorCount: number;
  awaitingConfirmationCount: number;
  inTransitCount: number;
  receiving: { pending: number; partial: number; received: number };
  missingEtaCount: number;
  missingEtdCount: number;
  deliveredNotReceivedCount: number;
  awaitingConfirmationItems: Array<{ orderNo: string; vendorKey: string }>;
  missingEtaItems: Array<{ orderNo: string; vendorKey: string }>;
  missingEtdItems: Array<{ orderNo: string; vendorKey: string }>;
  deliveredNotReceivedItems: Array<{ orderNo: string; vendorKey: string }>;
};
function emptySummary() {
  return {
    openPoCount: 0,
    vendorCount: 0,
    awaitingConfirmationCount: 0,
    inTransitCount: 0,
    receiving: { pending: 0, partial: 0, received: 0 },
    missingEtaCount: 0,
    missingEtdCount: 0,
    deliveredNotReceivedCount: 0,
    awaitingConfirmationItems: [] as Array<{ orderNo: string; vendorKey: string }>,
    missingEtaItems: [] as Array<{ orderNo: string; vendorKey: string }>,
    missingEtdItems: [] as Array<{ orderNo: string; vendorKey: string }>,
    deliveredNotReceivedItems: [] as Array<{ orderNo: string; vendorKey: string }>,
  };
}
summaryFixture = emptySummary();
const summaryCalls: string[][] = [];

let quotationsFixture: Array<{
  id: string;
  project_id: string | null;
  quotation_no: string | null;
  quotation_date: string;
  status: string;
  is_active: boolean;
  approved_salesperson_id: string | null;
  layout_settings: unknown;
}> = [];
const quotationsQueryCalls: string[] = [];

mock.module("server-only", { defaultExport: {} });
mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => ({ user: { id: "user-1" }, profile: { role: "procurement_manager" } }),
} });
mock.module("@/lib/supabase/server", { namedExports: {
  createClient: async () => ({
    from: (table: string) => {
      quotationsQueryCalls.push(table);
      assert.equal(table, "quotations");
      const builder = {
        select: () => builder,
        returns: () => builder,
        then: (resolve: (v: unknown) => void) => resolve({ data: quotationsFixture, error: null }),
      };
      return builder;
    },
  }),
} });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => ({ error: null, client: {} }) } });
mock.module("@/lib/notifications/actions", { namedExports: { sendNotificationToRole: async () => {} } });
mock.module("@/lib/procurement/procurement-summary", { namedExports: {
  loadProcurementSummary: async (orderNos: string[]) => { summaryCalls.push(orderNos); return summaryFixture; },
} });

const { getDashboardProcurementAttention, getDashboardStats } = await import("./actions");

function reset() {
  summaryFixture = emptySummary();
  summaryCalls.length = 0;
  quotationsFixture = [];
  quotationsQueryCalls.length = 0;
}

function project(orderNo: string, reference = "Ref", clientName = "Client", createdAt = "2026-01-01T00:00:00Z") {
  return { orderNo, clientName, reference, createdAt };
}

// ── getDashboardProcurementAttention: counts + bounded items ──────────────────────────────────

test("1. zero Procurement issues -> all-zero groups with empty item lists", async () => {
  reset();
  const result = await getDashboardProcurementAttention([project("CO-0001")]);
  assert.deepEqual(result, {
    awaitingSupplierConfirmation: { count: 0, items: [] },
    missingEta: { count: 0, items: [] },
    missingEtd: { count: 0, items: [] },
    deliveredNotReceived: { count: 0, items: [] },
  });
});

test("8. awaiting-confirmation item list is enriched with exact href + order/vendor display", async () => {
  reset();
  summaryFixture.awaitingConfirmationCount = 1;
  summaryFixture.awaitingConfirmationItems = [{ orderNo: "CO-0002-003", vendorKey: "las-mobili" }];
  const result = await getDashboardProcurementAttention([project("CO-0002-003", "Office Fit-out")]);
  assert.deepEqual(result.awaitingSupplierConfirmation, {
    count: 1,
    items: [{ id: "CO-0002-003:las-mobili", primary: "CO-0002-003", secondary: "Office Fit-out · las-mobili", href: "/procurement/orders/CO-0002-003" }],
  });
});

test("9. missing-ETA item list is enriched the same way", async () => {
  reset();
  summaryFixture.missingEtaCount = 1;
  summaryFixture.missingEtaItems = [{ orderNo: "CO-0003-001", vendorKey: "acme" }];
  const result = await getDashboardProcurementAttention([project("CO-0003-001", "HQ Fit-out")]);
  assert.deepEqual(result.missingEta.items[0], { id: "CO-0003-001:acme", primary: "CO-0003-001", secondary: "HQ Fit-out · acme", href: "/procurement/orders/CO-0003-001" });
});

test("10. missing-ETD item list is enriched the same way", async () => {
  reset();
  summaryFixture.missingEtdCount = 1;
  summaryFixture.missingEtdItems = [{ orderNo: "CO-0004-002", vendorKey: "interstuhl" }];
  const result = await getDashboardProcurementAttention([project("CO-0004-002", "Showroom")]);
  assert.deepEqual(result.missingEtd.items[0], { id: "CO-0004-002:interstuhl", primary: "CO-0004-002", secondary: "Showroom · interstuhl", href: "/procurement/orders/CO-0004-002" });
});

test("11. delivered-not-received item list is enriched the same way", async () => {
  reset();
  summaryFixture.deliveredNotReceivedCount = 1;
  summaryFixture.deliveredNotReceivedItems = [{ orderNo: "CO-0005-001", vendorKey: "interstuhl" }];
  const result = await getDashboardProcurementAttention([project("CO-0005-001", "Lobby")]);
  assert.deepEqual(result.deliveredNotReceived.items[0], { id: "CO-0005-001:interstuhl", primary: "CO-0005-001", secondary: "Lobby · interstuhl", href: "/procurement/orders/CO-0005-001" });
});

test("5/6. full count is preserved even though the item list is already pre-bounded upstream (max 5)", async () => {
  reset();
  summaryFixture.awaitingConfirmationCount = 12;
  summaryFixture.awaitingConfirmationItems = Array.from({ length: 5 }, (_, i) => ({ orderNo: `CO-000${i}`, vendorKey: "v" }));
  const result = await getDashboardProcurementAttention([project("CO-0000")]);
  assert.equal(result.awaitingSupplierConfirmation.count, 12);
  assert.equal(result.awaitingSupplierConfirmation.items.length, 5);
});

test("4. a project not present in the active-order list still gets a usable fallback label", async () => {
  reset();
  summaryFixture.missingEtaCount = 1;
  summaryFixture.missingEtaItems = [{ orderNo: "CO-9999-000", vendorKey: "unknown-vendor" }];
  const result = await getDashboardProcurementAttention([]);
  assert.deepEqual(result.missingEta.items[0], { id: "CO-9999-000:unknown-vendor", primary: "CO-9999-000", secondary: "unknown-vendor", href: "/procurement/orders/CO-9999-000" });
});

test("16. exactly one delegated loadProcurementSummary() call - no per-order loop", async () => {
  reset();
  await getDashboardProcurementAttention([project("CO-0001"), project("CO-0002")]);
  assert.deepEqual(summaryCalls, [["CO-0001", "CO-0002"]]);
  assert.equal(summaryCalls.length, 1);
});

// ── getDashboardStats: pendingQuotations becomes a bounded group ─────────────────────────────

test("13. zero pending quotations -> count 0, empty items", async () => {
  reset();
  quotationsFixture = [];
  const stats = await getDashboardStats();
  assert.deepEqual(stats.pendingQuotations, { count: 0, items: [] });
});

test("15. the existing pending-quotation status definition is unchanged - draft/ready_to_send/etc. still count", async () => {
  reset();
  quotationsFixture = [
    { id: "q1", project_id: null, quotation_no: "QN-0001-001", quotation_date: "2026-01-01", status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null },
    { id: "q2", project_id: null, quotation_no: "QN-0002-001", quotation_date: "2026-01-02", status: "sent_to_client", is_active: true, approved_salesperson_id: null, layout_settings: null },
    { id: "q3", project_id: null, quotation_no: "QN-0003-001", quotation_date: "2026-01-03", status: "client_confirmed", is_active: true, approved_salesperson_id: "u1", layout_settings: null },
  ];
  const stats = await getDashboardStats();
  // q3 is client_confirmed with no project file and a salesperson - quotationApprovalDisplay()
  // classifies it as "project_file_pending" (unchanged existing rule), so all three are pending.
  assert.equal(stats.pendingQuotations.count, 3);
});

test("7. quotation folder dedup is preserved - two revisions of the same folder (QN-0001-001 and its -R1 revision) count once", async () => {
  reset();
  quotationsFixture = [
    { id: "q1", project_id: null, quotation_no: "QN-0001-001", quotation_date: "2026-01-01", status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null },
    { id: "q2", project_id: null, quotation_no: "QN-0001-001-R1", quotation_date: "2026-01-02", status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null },
  ];
  const stats = await getDashboardStats();
  assert.equal(stats.pendingQuotations.count, 1);
  assert.equal(stats.pendingQuotations.items.length, 1);
  // The later revision (q2) is kept as the folder's representative row - same untouched logic
  // as the existing active/completed-project aggregation loop above it.
  assert.equal(stats.pendingQuotations.items[0].id, "q2");
});

test("4/6. pending-quotation items are bounded to 5 while count stays the full tally", async () => {
  reset();
  quotationsFixture = Array.from({ length: 8 }, (_, i) => ({
    id: `q${i}`,
    project_id: `p${i}`,
    quotation_no: `QN-000${i}-001`,
    quotation_date: "2026-01-01",
    status: "draft",
    is_active: true,
    approved_salesperson_id: null,
    layout_settings: null,
  }));
  const stats = await getDashboardStats();
  assert.equal(stats.pendingQuotations.count, 8);
  assert.equal(stats.pendingQuotations.items.length, 5);
});

test("4. a pending-quotation item links to its exact quotation page", async () => {
  reset();
  quotationsFixture = [
    { id: "q-abc", project_id: null, quotation_no: "QN-0003-001", quotation_date: "2026-01-01", status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null },
  ];
  const stats = await getDashboardStats();
  assert.deepEqual(stats.pendingQuotations.items[0], { id: "q-abc", primary: "QN-0003-001", href: "/quotations/q-abc" });
});

test("16b. getDashboardStats issues exactly one quotations query, independent of how many pending items exist", async () => {
  reset();
  quotationsFixture = Array.from({ length: 8 }, (_, i) => ({
    id: `q${i}`, project_id: `p${i}`, quotation_no: `QN-000${i}`, quotation_date: "2026-01-01",
    status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null,
  }));
  await getDashboardStats();
  assert.deepEqual(quotationsQueryCalls, ["quotations"]);
});

// ── Source-level checks: page wiring, role gating, component interaction ──────────────────────

const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const actionsSource = normalize(readFileSync("lib/dashboard/actions.ts", "utf8"));
const pageSource = normalize(readFileSync("app/dashboard/page.tsx", "utf8"));
const dashboardComponentSource = normalize(readFileSync("components/dashboard/erp-dashboard.tsx", "utf8"));

test("the dashboard page derives procurementAttention from the full active-projects list getActiveProjects() already returns (no re-derivation)", () => {
  const projectsCallIndex = pageSource.indexOf("getActiveProjects(),");
  const attentionCallIndex = pageSource.indexOf("getDashboardProcurementAttention(projects)");
  assert.ok(projectsCallIndex !== -1 && attentionCallIndex !== -1 && projectsCallIndex < attentionCallIndex);
  const fnStart = actionsSource.indexOf("export async function getDashboardProcurementAttention(");
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n}", fnStart));
  assert.ok(!fnBody.includes('.from("quotations")'));
  assert.ok(fnBody.includes("loadProcurementSummary(activeOrderNos)"));
});

test("12. Procurement attention is only fetched when canAccessProcurement() allows it - no new role logic", () => {
  assert.ok(pageSource.includes("const canSeeProcurementAttention = canAccessProcurement(profile?.role);"));
  assert.ok(pageSource.includes("canSeeProcurementAttention\n    ? await getDashboardProcurementAttention"));
  assert.ok(pageSource.includes(": null;"));
  assert.ok(!/function\s+canSeeProcurementAttention/.test(pageSource));
  // A null procurementAttention contributes zero drill-down categories - unauthorized roles never
  // see Procurement rows or their child records.
  assert.ok(dashboardComponentSource.includes("const procurementAttentionCategories: AttentionCategory[] = procurementAttention"));
});

test("1/2/3. categories collapse by default, expand on click via a non-navigating button, with aria-expanded", () => {
  const rowStart = dashboardComponentSource.indexOf("function AttentionCategoryRow(");
  const rowBody = dashboardComponentSource.slice(rowStart, dashboardComponentSource.indexOf("\n}\n", rowStart));
  assert.ok(rowBody.includes('<button\n        type="button"\n        aria-expanded={isExpanded}\n        onClick={onToggle}'));
  assert.ok(rowBody.includes("{isExpanded && ("));
  assert.ok(dashboardComponentSource.includes("const [expandedAttentionKey, setExpandedAttentionKey] = useState<string | null>(null);"));
  // One category open at a time (Part 9) - toggling a key clears any other expanded category.
  assert.ok(dashboardComponentSource.includes("setExpandedAttentionKey((prev) => (prev === category.key ? null : category.key))"));
});

test("chevron rotates when expanded, and no modal/drawer markup was introduced", () => {
  assert.ok(dashboardComponentSource.includes('isExpanded ? "rotate-90" : ""'));
  assert.ok(!/role="dialog"|<dialog|Modal|Drawer/.test(dashboardComponentSource));
});

test("4. each child record renders its own exact link, never the category's broad destination", () => {
  const rowStart = dashboardComponentSource.indexOf("function AttentionCategoryRow(");
  const rowBody = dashboardComponentSource.slice(rowStart, dashboardComponentSource.indexOf("\n}\n", rowStart));
  assert.ok(rowBody.includes("href={item.href}"));
});

test("6. 'View all N' only renders when more records exist than are shown, linking to the existing broad destination", () => {
  const rowStart = dashboardComponentSource.indexOf("function AttentionCategoryRow(");
  const rowBody = dashboardComponentSource.slice(rowStart, dashboardComponentSource.indexOf("\n}\n", rowStart));
  assert.ok(rowBody.includes("const hasMore = category.count > category.items.length;"));
  assert.ok(rowBody.includes("href={category.fallbackHref}"));
  assert.ok(rowBody.includes("View all {category.count}"));
});

test("13b. zero-count categories are omitted entirely from the category list", () => {
  assert.ok(dashboardComponentSource.includes("procurementAttention.awaitingSupplierConfirmation.count > 0"));
  assert.ok(dashboardComponentSource.includes("procurementAttention.missingEta.count > 0"));
  assert.ok(dashboardComponentSource.includes("procurementAttention.missingEtd.count > 0"));
  assert.ok(dashboardComponentSource.includes("procurementAttention.deliveredNotReceived.count > 0"));
  assert.ok(dashboardComponentSource.includes("stats.pendingQuotations.count > 0"));
});

test("11b. count>0 with an empty item list shows a safe 'Details unavailable' fallback, never a crash", () => {
  const rowStart = dashboardComponentSource.indexOf("function AttentionCategoryRow(");
  const rowBody = dashboardComponentSource.slice(rowStart, dashboardComponentSource.indexOf("\n}\n", rowStart));
  assert.ok(rowBody.includes("Details unavailable."));
});

test("14. the existing HR alerts row keeps its prior simple navigate-on-click behavior, unchanged", () => {
  assert.ok(dashboardComponentSource.includes('label: "HR and worker documents nearing expiry", count: hrAlerts.length, href: "/hr"'));
  assert.ok(dashboardComponentSource.includes("hrAttentionItem && ("));
});

test("the top Attention Items KPI total is unchanged by this task (Option A, carried from the prior dashboard task)", () => {
  assert.ok(dashboardComponentSource.includes(
    "const attentionCount = stats.pendingQuotations.count + (hrAlerts?.length ?? 0);",
  ));
});

test("17. the existing Active/Completed Project Value KPIs are untouched by this task", () => {
  assert.ok(dashboardComponentSource.includes('label: "Active Project Value",'));
  assert.ok(dashboardComponentSource.includes("value: formatAED(stats.activeProjectValue),"));
  assert.ok(dashboardComponentSource.includes('label: "Completed Project Value",'));
  assert.ok(dashboardComponentSource.includes("value: formatAED(stats.completedProjectValue),"));
});
