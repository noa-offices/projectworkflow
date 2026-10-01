// Dashboard Attention Drill-Down refinement: Project/reference names always shown, vendor issues
// grouped by Project. Real execution against a fake supabase client + fake loadProcurementSummary()
// for the two data-layer functions in lib/dashboard/actions.ts (getDashboardStats'
// pendingQuotations group, and getDashboardProcurementAttention), plus source-text checks for
// app/dashboard/page.tsx (role gating/active-order scope reuse) and
// components/dashboard/erp-dashboard.tsx (collapsed-by-default, expand-on-click, no-navigate
// header, grouped-row rendering) - both are "use client"/Server Component files with "@/..."
// aliases not resolvable by Node's plain ESM resolver outside the Next.js build, matching the
// convention already used throughout this codebase's *-safety.test.mts files.
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
  awaitingConfirmationGroupCount: number;
  missingEtaItems: Array<{ orderNo: string; vendorKey: string }>;
  missingEtaGroupCount: number;
  missingEtdItems: Array<{ orderNo: string; vendorKey: string }>;
  missingEtdGroupCount: number;
  deliveredNotReceivedItems: Array<{ orderNo: string; vendorKey: string }>;
  deliveredNotReceivedGroupCount: number;
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
    awaitingConfirmationGroupCount: 0,
    missingEtaItems: [] as Array<{ orderNo: string; vendorKey: string }>,
    missingEtaGroupCount: 0,
    missingEtdItems: [] as Array<{ orderNo: string; vendorKey: string }>,
    missingEtdGroupCount: 0,
    deliveredNotReceivedItems: [] as Array<{ orderNo: string; vendorKey: string }>,
    deliveredNotReceivedGroupCount: 0,
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
  title?: string | null;
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

// ── getDashboardProcurementAttention: grouped by Project (orderNo) ─────────────────────────────

test("1. zero Procurement issues -> all-zero groups with empty item lists", async () => {
  reset();
  const result = await getDashboardProcurementAttention([project("CO-0001")]);
  assert.deepEqual(result, {
    awaitingSupplierConfirmation: { count: 0, totalCount: 0, items: [] },
    missingEta: { count: 0, totalCount: 0, items: [] },
    missingEtd: { count: 0, totalCount: 0, items: [] },
    deliveredNotReceived: { count: 0, totalCount: 0, items: [] },
  });
});

test("3/4. two affected vendors on the same Project render as one grouped row with both vendor labels", async () => {
  reset();
  summaryFixture.awaitingConfirmationCount = 2;
  summaryFixture.awaitingConfirmationGroupCount = 1;
  summaryFixture.awaitingConfirmationItems = [
    { orderNo: "CO-0003-001", vendorKey: "LAS MOBILI" },
    { orderNo: "CO-0003-001", vendorKey: "INTERSTUHL" },
  ];
  const result = await getDashboardProcurementAttention([project("CO-0003-001", "Galleria Mall Boutique Refurbishment")]);
  assert.equal(result.awaitingSupplierConfirmation.items.length, 1);
  assert.deepEqual(result.awaitingSupplierConfirmation.items[0], {
    id: "CO-0003-001",
    primary: "CO-0003-001",
    secondary: "Galleria Mall Boutique Refurbishment",
    tertiary: "LAS MOBILI · INTERSTUHL",
    href: "/procurement/orders/CO-0003-001",
  });
});

test("5. a duplicate vendor label on the same Project is deduped, preserving first-seen order", async () => {
  reset();
  summaryFixture.missingEtaCount = 3;
  summaryFixture.missingEtaGroupCount = 1;
  summaryFixture.missingEtaItems = [
    { orderNo: "CO-0003-001", vendorKey: "LAS MOBILI" },
    { orderNo: "CO-0003-001", vendorKey: "INTERSTUHL" },
    { orderNo: "CO-0003-001", vendorKey: "LAS MOBILI" },
  ];
  const result = await getDashboardProcurementAttention([project("CO-0003-001", "Showroom")]);
  assert.equal(result.missingEta.items.length, 1);
  assert.equal(result.missingEta.items[0].tertiary, "LAS MOBILI · INTERSTUHL");
});

test("6. two different Projects render as two groups, each with its own vendor list", async () => {
  reset();
  summaryFixture.missingEtdCount = 3;
  summaryFixture.missingEtdGroupCount = 2;
  summaryFixture.missingEtdItems = [
    { orderNo: "CO-0003-001", vendorKey: "LAS MOBILI" },
    { orderNo: "CO-0003-001", vendorKey: "INTERSTUHL" },
    { orderNo: "CO-0005-001", vendorKey: "INTERSTUHL" },
  ];
  const result = await getDashboardProcurementAttention([
    project("CO-0003-001", "Galleria Mall Boutique Refurbishment"),
    project("CO-0005-001", "HQ Office Server Room Fit-out"),
  ]);
  assert.equal(result.missingEtd.items.length, 2);
  assert.deepEqual(result.missingEtd.items.map((item) => item.primary), ["CO-0003-001", "CO-0005-001"]);
  assert.equal(result.missingEtd.items[0].tertiary, "LAS MOBILI · INTERSTUHL");
  assert.equal(result.missingEtd.items[1].tertiary, "INTERSTUHL");
});

test("7. badge count stays the full vendor-issue count, not the Project-group count", async () => {
  reset();
  summaryFixture.missingEtaCount = 3; // 2 vendors on Project A + 1 on Project B
  summaryFixture.missingEtaGroupCount = 2;
  summaryFixture.missingEtaItems = [
    { orderNo: "CO-A", vendorKey: "LAS" },
    { orderNo: "CO-A", vendorKey: "INTERSTUHL" },
    { orderNo: "CO-B", vendorKey: "LAS" },
  ];
  const result = await getDashboardProcurementAttention([project("CO-A"), project("CO-B")]);
  assert.equal(result.missingEta.count, 3);
  assert.equal(result.missingEta.items.length, 2);
});

test("8. a grouped Project row links to /procurement/orders/[orderNo] - one link per Project, never per vendor", async () => {
  reset();
  summaryFixture.deliveredNotReceivedCount = 2;
  summaryFixture.deliveredNotReceivedGroupCount = 1;
  summaryFixture.deliveredNotReceivedItems = [
    { orderNo: "CO-0005-001", vendorKey: "las-mobili" },
    { orderNo: "CO-0005-001", vendorKey: "interstuhl" },
  ];
  const result = await getDashboardProcurementAttention([project("CO-0005-001")]);
  assert.equal(result.deliveredNotReceived.items.length, 1);
  assert.equal(result.deliveredNotReceived.items[0].href, "/procurement/orders/CO-0005-001");
});

test("9. max visible groups remains bounded - totalCount tracks the true distinct-Project total", async () => {
  reset();
  summaryFixture.awaitingConfirmationCount = 12;
  summaryFixture.awaitingConfirmationGroupCount = 8; // upstream already bounds items to 5 distinct orders
  summaryFixture.awaitingConfirmationItems = Array.from({ length: 5 }, (_, i) => ({ orderNo: `CO-000${i}`, vendorKey: "v" }));
  const result = await getDashboardProcurementAttention([project("CO-0000")]);
  assert.equal(result.awaitingSupplierConfirmation.count, 12);
  assert.equal(result.awaitingSupplierConfirmation.totalCount, 8);
  assert.equal(result.awaitingSupplierConfirmation.items.length, 5);
});

test("10. Project/reference-name fallback is safe when the Project isn't in the active list - orderNo only, no crash", async () => {
  reset();
  summaryFixture.missingEtaCount = 1;
  summaryFixture.missingEtaGroupCount = 1;
  summaryFixture.missingEtaItems = [{ orderNo: "CO-9999-000", vendorKey: "unknown-vendor" }];
  const result = await getDashboardProcurementAttention([]);
  assert.deepEqual(result.missingEta.items[0], {
    id: "CO-9999-000",
    primary: "CO-9999-000",
    secondary: undefined,
    tertiary: "unknown-vendor",
    href: "/procurement/orders/CO-9999-000",
  });
});

test("14. exactly one delegated loadProcurementSummary() call - no per-Project/vendor query loop", async () => {
  reset();
  await getDashboardProcurementAttention([project("CO-0001"), project("CO-0002")]);
  assert.deepEqual(summaryCalls, [["CO-0001", "CO-0002"]]);
  assert.equal(summaryCalls.length, 1);
});

// ── getDashboardStats: pendingQuotations always shows reference/project + client when available ─

test("zero pending quotations -> count 0, empty items", async () => {
  reset();
  quotationsFixture = [];
  const stats = await getDashboardStats();
  assert.deepEqual(stats.pendingQuotations, { count: 0, totalCount: 0, items: [] });
});

test("1/2. a pending-quotation row falls back to the `title` column (an existing column, zero new query) when no Project File/approval-draft snapshot exists yet", async () => {
  reset();
  quotationsFixture = [
    { id: "q-abc", project_id: null, quotation_no: "QN-0005-001", quotation_date: "2026-01-01", status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null, title: "HQ Office Server Room Fit-out" },
  ];
  const stats = await getDashboardStats();
  assert.deepEqual(stats.pendingQuotations.items[0], {
    id: "q-abc",
    primary: "QN-0005-001",
    secondary: "HQ Office Server Room Fit-out",
    tertiary: undefined,
    href: "/quotations/q-abc",
  });
});

test("10b. when neither a Project File snapshot nor a title exists, the row safely falls back to the order number only", async () => {
  reset();
  quotationsFixture = [
    { id: "q-abc", project_id: null, quotation_no: "QN-0005-001", quotation_date: "2026-01-01", status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null, title: null },
  ];
  const stats = await getDashboardStats();
  assert.equal(stats.pendingQuotations.items[0].primary, "QN-0005-001");
  assert.equal(stats.pendingQuotations.items[0].secondary, undefined);
});

test("13. the existing pending-quotation status definition is unchanged - draft/ready_to_send/etc. still count", async () => {
  reset();
  quotationsFixture = [
    { id: "q1", project_id: null, quotation_no: "QN-0001-001", quotation_date: "2026-01-01", status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null, title: null },
    { id: "q2", project_id: null, quotation_no: "QN-0002-001", quotation_date: "2026-01-02", status: "sent_to_client", is_active: true, approved_salesperson_id: null, layout_settings: null, title: null },
    { id: "q3", project_id: null, quotation_no: "QN-0003-001", quotation_date: "2026-01-03", status: "client_confirmed", is_active: true, approved_salesperson_id: "u1", layout_settings: null, title: null },
  ];
  const stats = await getDashboardStats();
  // q3 is client_confirmed with no project file and a salesperson - quotationApprovalDisplay()
  // classifies it as "project_file_pending" (unchanged existing rule), so all three are pending.
  assert.equal(stats.pendingQuotations.count, 3);
});

test("quotation folder dedup is preserved - two revisions of the same folder (QN-0001-001 and its -R1 revision) count once", async () => {
  reset();
  quotationsFixture = [
    { id: "q1", project_id: null, quotation_no: "QN-0001-001", quotation_date: "2026-01-01", status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null, title: null },
    { id: "q2", project_id: null, quotation_no: "QN-0001-001-R1", quotation_date: "2026-01-02", status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null, title: null },
  ];
  const stats = await getDashboardStats();
  assert.equal(stats.pendingQuotations.count, 1);
  assert.equal(stats.pendingQuotations.items.length, 1);
  assert.equal(stats.pendingQuotations.items[0].id, "q2");
});

test("9b. pending-quotation items are bounded to 5 while count/totalCount stay the full tally", async () => {
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
    title: null,
  }));
  const stats = await getDashboardStats();
  assert.equal(stats.pendingQuotations.count, 8);
  assert.equal(stats.pendingQuotations.totalCount, 8);
  assert.equal(stats.pendingQuotations.items.length, 5);
});

test("a pending-quotation item links to its exact quotation page", async () => {
  reset();
  quotationsFixture = [
    { id: "q-abc", project_id: null, quotation_no: "QN-0003-001", quotation_date: "2026-01-01", status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null, title: null },
  ];
  const stats = await getDashboardStats();
  assert.equal(stats.pendingQuotations.items[0].href, "/quotations/q-abc");
});

test("14b. getDashboardStats issues exactly one quotations query, independent of how many pending items exist", async () => {
  reset();
  quotationsFixture = Array.from({ length: 8 }, (_, i) => ({
    id: `q${i}`, project_id: `p${i}`, quotation_no: `QN-000${i}`, quotation_date: "2026-01-01",
    status: "draft", is_active: true, approved_salesperson_id: null, layout_settings: null, title: null,
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

test("11. Procurement attention is only fetched when canAccessProcurement() allows it - no new role logic", () => {
  assert.ok(pageSource.includes("const canSeeProcurementAttention = canAccessProcurement(profile?.role);"));
  assert.ok(pageSource.includes("canSeeProcurementAttention\n    ? await getDashboardProcurementAttention"));
  assert.ok(pageSource.includes(": null;"));
  assert.ok(!/function\s+canSeeProcurementAttention/.test(pageSource));
  // A null procurementAttention contributes zero drill-down categories - unauthorized roles never
  // see Procurement rows, Project groupings, or vendor labels.
  assert.ok(dashboardComponentSource.includes("const procurementAttentionCategories: AttentionCategory[] = procurementAttention"));
});

test("12. category expand/collapse behavior is unchanged by this refinement", () => {
  const rowStart = dashboardComponentSource.indexOf("function AttentionCategoryRow(");
  const rowBody = dashboardComponentSource.slice(rowStart, dashboardComponentSource.indexOf("\n}\n", rowStart));
  assert.ok(rowBody.includes('<button\n        type="button"\n        aria-expanded={isExpanded}\n        onClick={onToggle}'));
  assert.ok(rowBody.includes("{isExpanded && ("));
  assert.ok(rowBody.includes('isExpanded ? "rotate-90" : ""'));
  assert.ok(dashboardComponentSource.includes("const [expandedAttentionKey, setExpandedAttentionKey] = useState<string | null>(null);"));
  assert.ok(dashboardComponentSource.includes("setExpandedAttentionKey((prev) => (prev === category.key ? null : category.key))"));
  assert.ok(!/role="dialog"|<dialog|Modal|Drawer/.test(dashboardComponentSource));
});

test("each grouped child row renders its own exact link, never one link per vendor", () => {
  const rowStart = dashboardComponentSource.indexOf("function AttentionCategoryRow(");
  const rowBody = dashboardComponentSource.slice(rowStart, dashboardComponentSource.indexOf("\n}\n", rowStart));
  assert.ok(rowBody.includes("href={item.href}"));
  assert.ok(!/vendors\.map/.test(rowBody));
});

test("9c. 'View all' uses totalCount (distinct Projects shown), not the raw vendor-issue badge count", () => {
  const rowStart = dashboardComponentSource.indexOf("function AttentionCategoryRow(");
  const rowBody = dashboardComponentSource.slice(rowStart, dashboardComponentSource.indexOf("\n}\n", rowStart));
  assert.ok(rowBody.includes("const hasMore = category.totalCount > category.items.length;"));
  assert.ok(rowBody.includes("href={category.fallbackHref}"));
  assert.ok(rowBody.includes("View all {category.totalCount}"));
});

test("the third (tertiary) line renders when present - vendor list for Procurement rows, client name for quotation rows", () => {
  const rowStart = dashboardComponentSource.indexOf("function AttentionCategoryRow(");
  const rowBody = dashboardComponentSource.slice(rowStart, dashboardComponentSource.indexOf("\n}\n", rowStart));
  assert.ok(rowBody.includes("item.tertiary"));
});

test("zero-count categories are omitted entirely from the category list", () => {
  assert.ok(dashboardComponentSource.includes("procurementAttention.awaitingSupplierConfirmation.count > 0"));
  assert.ok(dashboardComponentSource.includes("procurementAttention.missingEta.count > 0"));
  assert.ok(dashboardComponentSource.includes("procurementAttention.missingEtd.count > 0"));
  assert.ok(dashboardComponentSource.includes("procurementAttention.deliveredNotReceived.count > 0"));
  assert.ok(dashboardComponentSource.includes("stats.pendingQuotations.count > 0"));
});

test("count>0 with an empty item list still shows a safe 'Details unavailable' fallback, never a crash", () => {
  const rowStart = dashboardComponentSource.indexOf("function AttentionCategoryRow(");
  const rowBody = dashboardComponentSource.slice(rowStart, dashboardComponentSource.indexOf("\n}\n", rowStart));
  assert.ok(rowBody.includes("Details unavailable."));
});

test("the existing HR alerts row keeps its prior simple navigate-on-click behavior, unchanged", () => {
  assert.ok(dashboardComponentSource.includes('label: "HR and worker documents nearing expiry", count: hrAlerts.length, href: "/hr"'));
  assert.ok(dashboardComponentSource.includes("hrAttentionItem && ("));
});

test("13b. existing Attention conditions (top KPI total) are unchanged by this refinement", () => {
  assert.ok(dashboardComponentSource.includes(
    "const attentionCount = stats.pendingQuotations.count + (hrAlerts?.length ?? 0);",
  ));
});

test("13c. existing Active/Completed Project Value KPIs are untouched by this refinement", () => {
  assert.ok(dashboardComponentSource.includes('label: "Active Project Value",'));
  assert.ok(dashboardComponentSource.includes("value: formatAED(stats.activeProjectValue),"));
  assert.ok(dashboardComponentSource.includes('label: "Completed Project Value",'));
  assert.ok(dashboardComponentSource.includes("value: formatAED(stats.completedProjectValue),"));
});
