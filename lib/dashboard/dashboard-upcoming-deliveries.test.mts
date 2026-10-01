// Management Dashboard — Upcoming ETA / Delivery Summary. Real execution against a fake supabase
// client for getDashboardUpcomingDeliveries() (lib/dashboard/actions.ts), plus source-text checks
// for app/dashboard/page.tsx (role gating/active-order scope reuse) and
// components/dashboard/erp-dashboard.tsx (role-gated rendering, empty state, date formatting) -
// both are "use client"/Server Component files with "@/..." aliases not resolvable by Node's
// plain ESM resolver outside the Next.js build, matching the convention already used throughout
// this codebase's *-safety.test.mts files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

// ── Fixtures / mocks ─────────────────────────────────────────────────────────────────────────

type ProgressRow = { order_no: string; vendor_key: string; eta: string };

let progressRowsFixture: ProgressRow[] = [];
const queryCalls: Array<{ table: string; filters: Record<string, unknown> }> = [];

mock.module("server-only", { defaultExport: {} });
mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => ({ user: { id: "user-1" }, profile: { role: "procurement_manager" } }),
} });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => ({ error: null, client: {} }) } });
mock.module("@/lib/notifications/actions", { namedExports: { sendNotificationToRole: async () => {} } });
mock.module("@/lib/procurement/procurement-summary", { namedExports: {
  loadProcurementSummary: async () => { throw new Error("not used by this test file"); },
} });
mock.module("@/lib/supabase/server", { namedExports: {
  createClient: async () => ({
    from: (table: string) => {
      assert.equal(table, "procurement_vendor_progress");
      const filters: Record<string, unknown> = {};
      const builder = {
        select: (cols: string) => { filters.select = cols; return builder; },
        in: (col: string, vals: unknown) => { filters.in = [col, vals]; return builder; },
        not: (col: string, op: string, val: unknown) => { filters.not = [col, op, val]; return builder; },
        gte: (col: string, val: unknown) => { filters.gte = [col, val]; return builder; },
        order: (col: string, opts: unknown) => { filters.order = [col, opts]; return builder; },
        limit: (n: number) => { filters.limit = n; return builder; },
        returns: () => ({
          then: (resolve: (v: unknown) => void) => {
            queryCalls.push({ table, filters: { ...filters } });
            // Honor the server-side ordered/filtered/limited contract the real Postgres query
            // would apply, so the fixture behaves like the real DB for these assertions.
            const today = new Date().toISOString().slice(0, 10);
            const filtered = progressRowsFixture
              .filter((row) => row.eta !== null && row.eta >= today)
              .sort((a, b) => (a.eta < b.eta ? -1 : a.eta > b.eta ? 1 : 0))
              .slice(0, (filters.limit as number) ?? progressRowsFixture.length);
            resolve({ data: filtered, error: null });
          },
        }),
      };
      return builder;
    },
  }),
} });

const { getDashboardUpcomingDeliveries } = await import("./actions");

function reset() {
  progressRowsFixture = [];
  queryCalls.length = 0;
}

function project(orderNo: string, reference = "Ref", clientName = "Client", createdAt = "2026-01-01T00:00:00Z") {
  return { orderNo, clientName, reference, createdAt };
}

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── 1. no ETA rows -> empty result ──────────────────────────────────────────────────────────

test("1. no active orders -> empty result, no query issued", async () => {
  reset();
  const result = await getDashboardUpcomingDeliveries([]);
  assert.deepEqual(result, []);
  assert.equal(queryCalls.length, 0);
});

test("1b. no matching ETA rows -> empty result", async () => {
  reset();
  const result = await getDashboardUpcomingDeliveries([project("CO-0001")]);
  assert.deepEqual(result, []);
});

// ── 2/3/4. future/today included, past excluded ─────────────────────────────────────────────

test("2/3/4. future and today's ETA are included, past ETA is excluded", async () => {
  reset();
  progressRowsFixture = [
    { order_no: "CO-0001", vendor_key: "future-vendor", eta: isoDaysFromToday(5) },
    { order_no: "CO-0002", vendor_key: "today-vendor", eta: isoDaysFromToday(0) },
    { order_no: "CO-0003", vendor_key: "past-vendor", eta: isoDaysFromToday(-1) },
  ];
  const result = await getDashboardUpcomingDeliveries([project("CO-0001"), project("CO-0002"), project("CO-0003")]);
  const vendorLabels = result.map((d) => d.vendorLabel);
  assert.ok(vendorLabels.includes("future-vendor"));
  assert.ok(vendorLabels.includes("today-vendor"));
  assert.ok(!vendorLabels.includes("past-vendor"));
});

// ── 5. sorted ascending ──────────────────────────────────────────────────────────────────────

test("5. results are sorted by ETA ascending (nearest first)", async () => {
  reset();
  progressRowsFixture = [
    { order_no: "CO-0001", vendor_key: "v-far", eta: isoDaysFromToday(20) },
    { order_no: "CO-0002", vendor_key: "v-near", eta: isoDaysFromToday(1) },
    { order_no: "CO-0003", vendor_key: "v-mid", eta: isoDaysFromToday(10) },
  ];
  const result = await getDashboardUpcomingDeliveries([project("CO-0001"), project("CO-0002"), project("CO-0003")]);
  assert.deepEqual(result.map((d) => d.vendorLabel), ["v-near", "v-mid", "v-far"]);
});

// ── 6. max 5 rows ────────────────────────────────────────────────────────────────────────────

test("6. at most 5 rows are returned", async () => {
  reset();
  progressRowsFixture = Array.from({ length: 9 }, (_, i) => ({
    order_no: `CO-000${i}`,
    vendor_key: `vendor-${i}`,
    eta: isoDaysFromToday(i + 1),
  }));
  const result = await getDashboardUpcomingDeliveries(progressRowsFixture.map((r) => project(r.order_no)));
  assert.ok(result.length <= 5);
});

// ── 7/8. completed/cancelled Projects excluded ──────────────────────────────────────────────

test("7/8. only orders present in the caller's active-project list are queried - completed/cancelled Projects are excluded upstream", async () => {
  reset();
  progressRowsFixture = [{ order_no: "CO-0001", vendor_key: "v1", eta: isoDaysFromToday(1) }];
  await getDashboardUpcomingDeliveries([project("CO-0001")]);
  assert.deepEqual(queryCalls[0].filters.in, ["order_no", ["CO-0001"]]);
});

// ── 9. active-order dedup preserved (reuses the caller's already-deduped list) ──────────────

test("9. the active-order list is forwarded verbatim - no second dedup/active-status rule", async () => {
  reset();
  progressRowsFixture = [{ order_no: "CO-0001", vendor_key: "v1", eta: isoDaysFromToday(1) }];
  const projects = [project("CO-0001"), project("CO-0002")];
  await getDashboardUpcomingDeliveries(projects);
  assert.deepEqual(queryCalls[0].filters.in, ["order_no", ["CO-0001", "CO-0002"]]);
});

// ── 10. same Project, two vendors -> two rows ───────────────────────────────────────────────

test("10. the same Project with two vendors renders two distinct rows (never grouped, unlike Attention)", async () => {
  reset();
  progressRowsFixture = [
    { order_no: "CO-0003-001", vendor_key: "LAS MOBILI", eta: isoDaysFromToday(3) },
    { order_no: "CO-0003-001", vendor_key: "INTERSTUHL", eta: isoDaysFromToday(3) },
  ];
  const result = await getDashboardUpcomingDeliveries([project("CO-0003-001", "HQ Office Server Room Fit-out")]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((d) => d.vendorLabel).sort(), ["INTERSTUHL", "LAS MOBILI"]);
  assert.ok(result.every((d) => d.projectName === "HQ Office Server Room Fit-out"));
});

// ── Client context (Dashboard Context + Layout Polish) ──────────────────────────────────────

test("5. an upcoming delivery shows Client name when the Project is in the active-project list", async () => {
  reset();
  progressRowsFixture = [{ order_no: "CO-0002-003", vendor_key: "LAS MOBILI", eta: isoDaysFromToday(1) }];
  const result = await getDashboardUpcomingDeliveries([project("CO-0002-003", "HQ Office Server Room Fit-out", "TechCorp Solutions FZ-LLC")]);
  assert.equal(result[0].clientName, "TechCorp Solutions FZ-LLC");
});

test("6. an upcoming delivery still renders when Client is missing (no new lookup triggered)", async () => {
  reset();
  progressRowsFixture = [{ order_no: "CO-9999", vendor_key: "v1", eta: isoDaysFromToday(1) }];
  // CO-9999 itself isn't in the active-project list - mirrors a row whose Project lookup misses.
  const result = await getDashboardUpcomingDeliveries([project("CO-0001")]);
  assert.equal(result[0].clientName, undefined);
  assert.equal(result[0].orderNo, "CO-9999");
});

// ── 11. duplicate (orderNo, vendorKey) deduped ──────────────────────────────────────────────

test("11. a duplicate (orderNo, vendorKey) pair is deduped defensively", async () => {
  reset();
  progressRowsFixture = [
    { order_no: "CO-0001", vendor_key: "v1", eta: isoDaysFromToday(1) },
    { order_no: "CO-0001", vendor_key: "v1", eta: isoDaysFromToday(1) },
  ];
  const result = await getDashboardUpcomingDeliveries([project("CO-0001")]);
  assert.equal(result.length, 1);
});

// ── 12. Project name shown when available ───────────────────────────────────────────────────

test("12. the Project/reference name is shown when available, falling back to orderNo only when genuinely missing", async () => {
  reset();
  progressRowsFixture = [
    { order_no: "CO-0001", vendor_key: "v1", eta: isoDaysFromToday(1) },
    { order_no: "CO-9999", vendor_key: "v2", eta: isoDaysFromToday(2) },
  ];
  const result = await getDashboardUpcomingDeliveries([project("CO-0001", "Galleria Mall Boutique Refurbishment")]);
  assert.equal(result[0].projectName, "Galleria Mall Boutique Refurbishment");
  assert.equal(result[1].projectName, "CO-9999"); // not in the active list - safe orderNo fallback
});

// ── 13. exact Procurement order href ────────────────────────────────────────────────────────

test("13. each delivery links to the exact /procurement/orders/[orderNo] page", async () => {
  reset();
  progressRowsFixture = [{ order_no: "CO-0002-003", vendor_key: "v1", eta: isoDaysFromToday(1) }];
  const result = await getDashboardUpcomingDeliveries([project("CO-0002-003")]);
  assert.equal(result[0].href, "/procurement/orders/CO-0002-003");
});

// ── 15. no N+1 query pattern ─────────────────────────────────────────────────────────────────

test("15. exactly one bounded query is issued, independent of how many active orders/deliveries exist", async () => {
  reset();
  progressRowsFixture = Array.from({ length: 9 }, (_, i) => ({
    order_no: `CO-000${i}`, vendor_key: "v", eta: isoDaysFromToday(i + 1),
  }));
  await getDashboardUpcomingDeliveries(progressRowsFixture.map((r) => project(r.order_no)));
  assert.equal(queryCalls.length, 1);
  assert.ok(!queryCalls[0].filters.select?.toString().includes("items_snapshot"));
});

// ── no quotation items / documents / pricing fetched ────────────────────────────────────────

test("the query selects only order_no, vendor_key, eta - never items_snapshot/documents/pricing", async () => {
  reset();
  progressRowsFixture = [{ order_no: "CO-0001", vendor_key: "v1", eta: isoDaysFromToday(1) }];
  await getDashboardUpcomingDeliveries([project("CO-0001")]);
  assert.equal(queryCalls[0].filters.select, "order_no, vendor_key, eta");
});

// ── Source-level checks: page wiring, role gating, component rendering ─────────────────────────

const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const actionsSource = normalize(readFileSync("lib/dashboard/actions.ts", "utf8"));
const pageSource = normalize(readFileSync("app/dashboard/page.tsx", "utf8"));
const dashboardComponentSource = normalize(readFileSync("components/dashboard/erp-dashboard.tsx", "utf8"));

test("the dashboard page derives upcoming deliveries from the same active-projects list getActiveProjects() already returns", () => {
  const projectsCallIndex = pageSource.indexOf("getActiveProjects(),");
  const upcomingCallIndex = pageSource.indexOf("getDashboardUpcomingDeliveries(projects)");
  assert.ok(projectsCallIndex !== -1 && upcomingCallIndex !== -1 && projectsCallIndex < upcomingCallIndex);
});

test("14. upcoming deliveries are only fetched when canAccessProcurement() allows it - no new role logic", () => {
  assert.ok(pageSource.includes("canSeeProcurementAttention\n    ? await Promise.all([getDashboardProcurementAttention(projects), getDashboardUpcomingDeliveries(projects)])"));
  assert.ok(pageSource.includes(": [null, []];"));
  assert.ok(!/function\s+canSeeProcurementAttention/.test(pageSource));
});

test("14b. the dashboard component hides the Upcoming Deliveries card entirely (not just empty) for roles without Procurement access", () => {
  assert.ok(dashboardComponentSource.includes("{canAccessProcurement && ("));
  const cardStart = dashboardComponentSource.indexOf("{canAccessProcurement && (");
  const cardBlock = dashboardComponentSource.slice(cardStart, cardStart + 600);
  assert.ok(cardBlock.includes("Upcoming Deliveries"));
});

test("16. the existing Attention Required panel is untouched by this task", () => {
  assert.ok(dashboardComponentSource.includes('<p className="text-sm font-semibold text-zinc-950">Attention Required</p>'));
  assert.ok(dashboardComponentSource.includes("const procurementAttentionCategories: AttentionCategory[] = procurementAttention"));
});

test("17. the existing Active/Completed Project Value KPIs are untouched by this task", () => {
  assert.ok(dashboardComponentSource.includes('label: "Active Project Value",'));
  assert.ok(dashboardComponentSource.includes("value: formatAED(stats.activeProjectValue),"));
  assert.ok(dashboardComponentSource.includes('label: "Completed Project Value",'));
  assert.ok(dashboardComponentSource.includes("value: formatAED(stats.completedProjectValue),"));
});

test("empty state matches the required compact wording", () => {
  assert.ok(dashboardComponentSource.includes("No upcoming deliveries recorded."));
});

test("ETA formatting is date-only (no timezone conversion) and includes the year only when it differs from the current year", () => {
  const fnStart = dashboardComponentSource.indexOf("function formatEtaDate(");
  const fnBody = dashboardComponentSource.slice(fnStart, dashboardComponentSource.indexOf("\n}", fnStart));
  assert.ok(fnBody.includes("`${iso}T00:00:00`"));
  assert.ok(fnBody.includes("date.getFullYear() === new Date().getFullYear()"));
});

test("Part 3: the data layer itself filters eta IS NOT NULL and eta >= today, ordered ascending, server-side", () => {
  const fnStart = actionsSource.indexOf("export async function getDashboardUpcomingDeliveries(");
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n}", fnStart));
  assert.ok(fnBody.includes('.not("eta", "is", null)'));
  assert.ok(fnBody.includes('.gte("eta", today)'));
  assert.ok(fnBody.includes('.order("eta", { ascending: true })'));
  assert.ok(fnBody.includes(".limit(MAX_UPCOMING_DELIVERIES)"));
});
