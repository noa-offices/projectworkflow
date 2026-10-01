// Reporting: Project Value dashboard metrics (activeProjectValue/completedProjectValue) added
// to getDashboardStats(). Real execution against a fake Supabase client (same mock.module()
// convention as lib/procurement/*.test.mts) - the dedup/active/completed/cancelled logic itself
// is pre-existing and untouched, so these tests exercise the real function end to end rather
// than re-deriving its rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

type QuotationFixtureRow = {
  id: string;
  project_id: string | null;
  client_id?: string | null;
  quotation_no: string | null;
  quotation_date: string;
  status: string;
  is_active: boolean;
  approved_salesperson_id: string | null;
  layout_settings: unknown;
};

let quotationsFixture: QuotationFixtureRow[] = [];
const clientsFixture: Array<{ id: string; company_name: string | null }> = [];

mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => ({ user: { id: "user-1" }, profile: { role: "system_owner" }, displayName: "Fixture User" }),
} });
mock.module("@/lib/supabase/admin", { namedExports: {
  createAdminClient: () => ({ error: null, client: {} }),
} });
mock.module("@/lib/notifications/actions", { namedExports: {
  sendNotificationToRole: async () => ({ ok: true }),
} });
mock.module("@/lib/supabase/server", { namedExports: {
  createClient: async () => ({
    from: (table: string) => {
      if (table === "quotations") {
        return {
          select: () => ({
            returns: () => ({ then: (resolve: (v: unknown) => void) => resolve({ data: quotationsFixture }) }),
          }),
        };
      }
      if (table === "clients") {
        return {
          select: () => ({
            in: () => ({
              returns: () => ({ then: (resolve: (v: unknown) => void) => resolve({ data: clientsFixture }) }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
} });

const { getDashboardStats } = await import("./actions");

// Minimal valid layout_settings.projectFile snapshot - every field projectFileRecordValue
// requires, so `order` resolves to a real, non-null snapshot in the function under test.
function projectFile(overrides: { orderNo: string; total: number; currency?: string }) {
  return {
    projectFile: {
      orderNo: overrides.orderNo,
      quotationId: `q-${overrides.orderNo}`,
      quotationNo: `QN-0001-001`,
      folderNo: "0001",
      opportunityNo: null,
      clientId: "client-1",
      clientName: "Fixture Client",
      reference: "Fixture Reference",
      total: overrides.total,
      currency: overrides.currency ?? "AED",
      status: "Confirmed",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user-1",
      source: "quotation_layout_settings",
    },
  };
}

function row(id: string, layoutSettings: Record<string, unknown>): QuotationFixtureRow {
  return {
    id,
    project_id: null,
    quotation_no: `QN-${id}`,
    quotation_date: "2026-01-01",
    status: "client_confirmed",
    is_active: true,
    approved_salesperson_id: null,
    layout_settings: layoutSettings,
  };
}

test("1. zero Projects -> both totals zero", async () => {
  quotationsFixture = [];
  const stats = await getDashboardStats();
  assert.equal(stats.activeProjectValue, 0);
  assert.equal(stats.completedProjectValue, 0);
  assert.equal(stats.activeProjects, 0);
  assert.equal(stats.completedProjects, 0);
});

test("2. one active Project -> active value correct", async () => {
  quotationsFixture = [row("a1", projectFile({ orderNo: "CO-0001-001", total: 15000 }))];
  const stats = await getDashboardStats();
  assert.equal(stats.activeProjectValue, 15000);
  assert.equal(stats.completedProjectValue, 0);
  assert.equal(stats.activeProjects, 1);
});

test("3. one completed Project -> completed value correct", async () => {
  quotationsFixture = [row("c1", { ...projectFile({ orderNo: "CO-0002-001", total: 20000 }), projectCompletedAt: "2026-02-01T00:00:00.000Z" })];
  const stats = await getDashboardStats();
  assert.equal(stats.completedProjectValue, 20000);
  assert.equal(stats.activeProjectValue, 0);
  assert.equal(stats.completedProjects, 1);
});

test("4. cancelled Project -> excluded from both", async () => {
  quotationsFixture = [row("x1", { ...projectFile({ orderNo: "CO-0003-001", total: 99999 }), projectCancelledAt: "2026-02-01T00:00:00.000Z" })];
  const stats = await getDashboardStats();
  assert.equal(stats.activeProjectValue, 0);
  assert.equal(stats.completedProjectValue, 0);
  assert.equal(stats.activeProjects, 0);
  assert.equal(stats.completedProjects, 0);
});

test("5. duplicate quotation revisions with the same orderNo are counted once", async () => {
  quotationsFixture = [
    row("r1", projectFile({ orderNo: "CO-0004-001", total: 5000 })),
    row("r2", projectFile({ orderNo: "CO-0004-001", total: 5000 })),
  ];
  const stats = await getDashboardStats();
  assert.equal(stats.activeProjects, 1);
  assert.equal(stats.activeProjectValue, 5000);
});

test("6. active + completed mix -> separate totals correct", async () => {
  quotationsFixture = [
    row("a1", projectFile({ orderNo: "CO-0005-001", total: 1000 })),
    row("a2", projectFile({ orderNo: "CO-0005-002", total: 2000 })),
    row("c1", { ...projectFile({ orderNo: "CO-0005-003", total: 4000 }), projectCompletedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const stats = await getDashboardStats();
  assert.equal(stats.activeProjectValue, 3000);
  assert.equal(stats.completedProjectValue, 4000);
  assert.equal(stats.activeProjects, 2);
  assert.equal(stats.completedProjects, 1);
});

test("7. missing snapshot -> ignored (no projectFile, no confirmedOrder draft)", async () => {
  quotationsFixture = [row("m1", { someUnrelatedKey: true })];
  const stats = await getDashboardStats();
  assert.equal(stats.activeProjectValue, 0);
  assert.equal(stats.completedProjectValue, 0);
  assert.equal(stats.activeProjects, 0);
  assert.equal(stats.completedProjects, 0);
});

test("8. invalid/missing total -> the whole snapshot is rejected and ignored safely (never NaN)", async () => {
  const invalidSnapshot = projectFile({ orderNo: "CO-0006-001", total: 1000 });
  // total becomes non-finite - projectFileRecordValue returns null for the entire record,
  // so this row contributes to neither count nor value (never guessed/coerced to 0 mid-sum).
  (invalidSnapshot.projectFile as { total: unknown }).total = Number.NaN;
  quotationsFixture = [row("i1", invalidSnapshot)];
  const stats = await getDashboardStats();
  assert.equal(stats.activeProjectValue, 0);
  assert.equal(Number.isNaN(stats.activeProjectValue), false);
  assert.equal(stats.activeProjects, 0);
});

test("9. completed + cancelled together are not double-counted across both categories", async () => {
  quotationsFixture = [row("cc1", {
    ...projectFile({ orderNo: "CO-0007-001", total: 8000 }),
    projectCompletedAt: "2026-02-01T00:00:00.000Z",
    projectCancelledAt: "2026-02-02T00:00:00.000Z",
  })];
  const stats = await getDashboardStats();
  // Existing precedence (untouched by this task): completedAt is checked first, so this
  // contributes to exactly one bucket, never both and never neither.
  const totalCounted = stats.activeProjects + stats.completedProjects;
  const totalValueCounted = stats.activeProjectValue + stats.completedProjectValue;
  assert.equal(totalCounted, 1);
  assert.equal(totalValueCounted, 8000);
});

test("11. existing Project counts are unaffected by the new value fields", async () => {
  quotationsFixture = [
    row("a1", projectFile({ orderNo: "CO-0008-001", total: 100 })),
    row("c1", { ...projectFile({ orderNo: "CO-0008-002", total: 200 }), projectCompletedAt: "2026-02-01T00:00:00.000Z" }),
    row("x1", { ...projectFile({ orderNo: "CO-0008-003", total: 300 }), projectCancelledAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const stats = await getDashboardStats();
  assert.equal(stats.activeProjects, 1);
  assert.equal(stats.completedProjects, 1);
});

// ── SOURCE-TEXT REGRESSION / UI-FORMATTING CHECKS ───────────────────────────────────────────

const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const actionsSource = normalize(readFileSync("lib/dashboard/actions.ts", "utf8"));
const dashboardSource = normalize(readFileSync("components/dashboard/erp-dashboard.tsx", "utf8"));

test("10. dashboard UI formats both new values with the existing formatAED helper", () => {
  assert.ok(dashboardSource.includes("formatAED(stats.activeProjectValue)"));
  assert.ok(dashboardSource.includes("formatAED(stats.completedProjectValue)"));
});

test("12. getDashboardSalesData / getMonthlySalesData are untouched", () => {
  assert.ok(actionsSource.includes("export async function getDashboardSalesData(): Promise<DashboardSalesData> {"));
  assert.ok(actionsSource.includes("export async function getMonthlySalesData(): Promise<MonthlyTotal[]> {"));
  assert.ok(actionsSource.includes('.eq("status", "client_confirmed")'));
  assert.ok(actionsSource.includes('.filter("layout_settings->>projectCancelledAt", "is", null)'));
});

test("13. no quotation_items query was introduced", () => {
  assert.ok(!actionsSource.includes("quotation_items"));
});
