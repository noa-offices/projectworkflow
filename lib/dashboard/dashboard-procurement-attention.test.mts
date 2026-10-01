// Management Dashboard Operational Attention Summary. Real execution against a fake
// loadProcurementSummary() for the new wrapper function (lib/dashboard/actions.ts), plus
// source-text checks for app/dashboard/page.tsx (role gating/active-order scope reuse) and
// components/dashboard/erp-dashboard.tsx (zero-row omission, HR/pending-quotation rows intact,
// Project Value KPIs untouched) - both are "use client"/Server Component files with "@/..."
// aliases not resolvable by Node's plain ESM resolver outside the Next.js build, matching the
// convention already used throughout this codebase's *-safety.test.mts files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

let summaryFixture: {
  openPoCount: number;
  vendorCount: number;
  awaitingConfirmationCount: number;
  inTransitCount: number;
  receiving: { pending: number; partial: number; received: number };
  missingEtaCount: number;
  missingEtdCount: number;
  deliveredNotReceivedCount: number;
} = {
  openPoCount: 0,
  vendorCount: 0,
  awaitingConfirmationCount: 0,
  inTransitCount: 0,
  receiving: { pending: 0, partial: 0, received: 0 },
  missingEtaCount: 0,
  missingEtdCount: 0,
  deliveredNotReceivedCount: 0,
};
const summaryCalls: string[][] = [];

mock.module("server-only", { defaultExport: {} });
mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => ({ user: { id: "user-1" }, profile: { role: "procurement_manager" } }),
} });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({}) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => ({ error: null, client: {} }) } });
mock.module("@/lib/notifications/actions", { namedExports: { sendNotificationToRole: async () => {} } });
mock.module("@/lib/procurement/procurement-summary", { namedExports: {
  loadProcurementSummary: async (orderNos: string[]) => { summaryCalls.push(orderNos); return summaryFixture; },
} });

const { getDashboardProcurementAttention } = await import("./actions");

function reset() {
  summaryFixture = {
    openPoCount: 0,
    vendorCount: 0,
    awaitingConfirmationCount: 0,
    inTransitCount: 0,
    receiving: { pending: 0, partial: 0, received: 0 },
    missingEtaCount: 0,
    missingEtdCount: 0,
    deliveredNotReceivedCount: 0,
  };
  summaryCalls.length = 0;
}

// ── 1. zero Procurement issues ──────────────────────────────────────────────────────────────

test("1. zero Procurement issues map to an all-zero attention object", async () => {
  reset();
  const result = await getDashboardProcurementAttention(["CO-0001"]);
  assert.deepEqual(result, {
    awaitingSupplierConfirmation: 0,
    missingEta: 0,
    missingEtd: 0,
    deliveredNotReceived: 0,
  });
});

// ── 2/3/4. counts map correctly ─────────────────────────────────────────────────────────────

test("2. awaiting-confirmation count is passed through from the summary", async () => {
  reset();
  summaryFixture.awaitingConfirmationCount = 3;
  const result = await getDashboardProcurementAttention(["CO-0001"]);
  assert.equal(result.awaitingSupplierConfirmation, 3);
});

test("3. missing ETA count is passed through from the summary", async () => {
  reset();
  summaryFixture.missingEtaCount = 1;
  const result = await getDashboardProcurementAttention(["CO-0001"]);
  assert.equal(result.missingEta, 1);
});

test("4. missing ETD count is passed through from the summary", async () => {
  reset();
  summaryFixture.missingEtdCount = 2;
  const result = await getDashboardProcurementAttention(["CO-0001"]);
  assert.equal(result.missingEtd, 2);
});

test("13. deliveredNotReceived is passed through from the summary", async () => {
  reset();
  summaryFixture.deliveredNotReceivedCount = 1;
  const result = await getDashboardProcurementAttention(["CO-0001"]);
  assert.equal(result.deliveredNotReceived, 1);
});

// ── 7. active-order dedup/scope is the caller's, never re-derived ──────────────────────────

test("7/11. the wrapper forwards the caller's order-number list verbatim - no re-derivation, no second query layer", async () => {
  reset();
  await getDashboardProcurementAttention(["CO-0001", "CO-0002"]);
  assert.deepEqual(summaryCalls, [["CO-0001", "CO-0002"]]);
  assert.equal(summaryCalls.length, 1); // exactly one delegated call - no per-order loop
});

// ── 5/6. completed/cancelled exclusion lives upstream in getActiveProjects(), reused as-is ──

const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const actionsSource = normalize(readFileSync("lib/dashboard/actions.ts", "utf8"));
const pageSource = normalize(readFileSync("app/dashboard/page.tsx", "utf8"));
const dashboardComponentSource = normalize(readFileSync("components/dashboard/erp-dashboard.tsx", "utf8"));

test("5/6. the dashboard page derives procurementAttention from the same completed/cancelled-excluded, deduped projects array getActiveProjects() already returns", () => {
  const projectsCallIndex = pageSource.indexOf("getActiveProjects(),");
  const attentionCallIndex = pageSource.indexOf("getDashboardProcurementAttention(projects.map((project) => project.orderNo))");
  assert.ok(projectsCallIndex !== -1 && attentionCallIndex !== -1 && projectsCallIndex < attentionCallIndex);
  // getDashboardProcurementAttention itself never queries "quotations" directly - it only
  // delegates to loadProcurementSummary(), it does not re-scan/re-derive "active" at all.
  const fnStart = actionsSource.indexOf("export async function getDashboardProcurementAttention(");
  const fnBody = actionsSource.slice(fnStart, actionsSource.indexOf("\n}", fnStart));
  assert.ok(!fnBody.includes('.from("quotations")'));
  assert.ok(fnBody.includes("loadProcurementSummary(activeOrderNos)"));
});

// ── 8. hidden for unauthorized roles ────────────────────────────────────────────────────────

test("8. Procurement attention is only fetched when canAccessProcurement() allows it - no new role logic", () => {
  assert.ok(pageSource.includes("const canSeeProcurementAttention = canAccessProcurement(profile?.role);"));
  assert.ok(pageSource.includes("canSeeProcurementAttention\n    ? await getDashboardProcurementAttention"));
  assert.ok(pageSource.includes(": null;"));
  // No second/new role-check helper was introduced for this.
  assert.ok(!/function\s+canSeeProcurementAttention/.test(pageSource));
});

// ── 9/10. existing HR + pending-quotation attention rows remain intact ─────────────────────

test("9. the existing HR alerts attention row is unchanged", () => {
  assert.ok(dashboardComponentSource.includes('label: "HR and worker documents nearing expiry",'));
  assert.ok(dashboardComponentSource.includes('href: "/hr",'));
});

test("10. the existing pending-quotations attention row is unchanged", () => {
  assert.ok(dashboardComponentSource.includes('label: "Quotation folders awaiting completion",'));
  assert.ok(dashboardComponentSource.includes("count: stats.pendingQuotations,"));
  assert.ok(dashboardComponentSource.includes('href: "/sales/quotations",'));
});

// ── 12. zero-value Procurement rows produce no noisy UI ─────────────────────────────────────

test("12. each Procurement attention row is individually gated to only render when its count is greater than zero", () => {
  assert.ok(dashboardComponentSource.includes("procurementAttention.awaitingSupplierConfirmation > 0"));
  assert.ok(dashboardComponentSource.includes("procurementAttention.missingEta > 0"));
  assert.ok(dashboardComponentSource.includes("procurementAttention.missingEtd > 0"));
  assert.ok(dashboardComponentSource.includes("procurementAttention.deliveredNotReceived > 0"));
  // A null procurementAttention (unauthorized/not fetched) contributes zero rows.
  assert.ok(dashboardComponentSource.includes("const procurementAttentionItems = procurementAttention"));
});

// ── 6 (Part 6). top "Attention Items" KPI is intentionally left unchanged (Option A) ───────

test("the top Attention Items KPI total is unchanged by this task (Option A: panel-only change)", () => {
  assert.ok(dashboardComponentSource.includes(
    "const attentionCount = stats.pendingQuotations + (hrAlerts?.length ?? 0);",
  ));
});

// ── 14. existing Project Value KPIs are untouched ───────────────────────────────────────────

test("14. the existing Active/Completed Project Value KPIs are untouched by this task", () => {
  assert.ok(dashboardComponentSource.includes('label: "Active Project Value",'));
  assert.ok(dashboardComponentSource.includes("value: formatAED(stats.activeProjectValue),"));
  assert.ok(dashboardComponentSource.includes('label: "Completed Project Value",'));
  assert.ok(dashboardComponentSource.includes("value: formatAED(stats.completedProjectValue),"));
});

// ── links (Part 7) ───────────────────────────────────────────────────────────────────────────

test("Procurement attention rows link to the existing /procurement/orders workspace", () => {
  const rowsBlockStart = dashboardComponentSource.indexOf("const procurementAttentionItems = procurementAttention");
  const rowsBlockEnd = dashboardComponentSource.indexOf("const attentionItems = [", rowsBlockStart);
  const rowsBlock = dashboardComponentSource.slice(rowsBlockStart, rowsBlockEnd);
  assert.equal((rowsBlock.match(/href: "\/procurement\/orders",/g) ?? []).length, 4);
});
