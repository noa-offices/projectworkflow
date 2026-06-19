"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
// ─── Exported types ───────────────────────────────────────────────────────────

export type DashboardStats = {
  activeProjects: number;
  completedProjects: number;
  pendingQuotations: number;
};

export type DashboardProject = {
  orderNo: string;
  clientName: string;
  reference: string;
  createdAt: string;
};

export type ActivityEntry = {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  actorName: string | null;
};

// ─── 1. getDashboardStats ─────────────────────────────────────────────────────
// All three counts run in parallel via Promise.all.
// Session client is sufficient — all SELECT RLS policies only require
// current_user_is_active(), which is satisfied by the session cookie.

const PENDING_STATUSES = [
  "draft",
  "internal_review",
  "revision_required",
  "ready_to_send",
  "sent_to_client",
  "on_hold",
];

export async function getDashboardStats(): Promise<DashboardStats> {
  await requireActiveUser();
  const supabase = await createClient();

  // Active/completed counts use the same quotations.layout_settings JSON scan
  // as the sidebar pages (/projects/orders and /projects/completed). The
  // `projects` table is NOT the source of truth here — completion status is
  // stored in layout_settings.projectCompletedAt, not projects.project_status.
  const [{ data: quotations }, { count: quotationsCount }] = await Promise.all([
    supabase
      .from("quotations")
      .select("id, layout_settings")
      .returns<Array<{ id: string; layout_settings: unknown }>>(),
    supabase
      .from("quotations")
      .select("id", { count: "exact" })
      .eq("is_active", true)
      .in("status", PENDING_STATUSES)
      .limit(0),
  ]);

  let activeProjects = 0;
  let completedProjects = 0;
  const seen = new Set<string>();

  for (const quotation of quotations ?? []) {
    const settings = quotation.layout_settings as Record<string, unknown> | null;

    const pf = projectFileFromLayoutSettings(quotation.layout_settings);
    const draft = !pf ? clientApprovalDraftFromLayoutSettings(quotation.layout_settings) : null;
    const order = pf ?? draft?.confirmedOrder ?? null;

    if (!order) continue;
    if (seen.has(order.orderNo)) continue;
    seen.add(order.orderNo);

    if (typeof settings?.projectCompletedAt === "string") {
      completedProjects++;
    } else if (typeof settings?.projectCancelledAt !== "string") {
      activeProjects++;
    }
    // Cancelled orders count as neither active nor completed.
  }

  return {
    activeProjects,
    completedProjects,
    pendingQuotations: quotationsCount ?? 0,
  };
}

// ─── 2. getActiveProjects ─────────────────────────────────────────────────────
// Mirrors the layout_settings JSON scan in app/projects/orders/page.tsx.
// Excludes completed and cancelled orders. Caps at 50 rows (newest first).

export async function getActiveProjects(): Promise<DashboardProject[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data: quotations } = await supabase
    .from("quotations")
    .select("id, layout_settings")
    .returns<Array<{ id: string; layout_settings: unknown }>>();

  return (quotations ?? [])
    .flatMap((quotation) => {
      const settings = quotation.layout_settings as Record<string, unknown> | null;
      if (typeof settings?.projectCompletedAt === "string") return [];
      if (typeof settings?.projectCancelledAt === "string") return [];

      const pf = projectFileFromLayoutSettings(quotation.layout_settings);
      if (pf) {
        return [{ orderNo: pf.orderNo, clientName: pf.clientName, reference: pf.reference, createdAt: pf.createdAt }];
      }

      const draft = clientApprovalDraftFromLayoutSettings(quotation.layout_settings);
      if (draft?.confirmedOrder) {
        const co = draft.confirmedOrder;
        return [{ orderNo: co.orderNo, clientName: co.clientName, reference: co.reference, createdAt: co.createdAt }];
      }

      return [];
    })
    .filter((p, i, all) => all.findIndex((q) => q.orderNo === p.orderNo) === i)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);
}

// ─── 3. getProjectRecentActivity ──────────────────────────────────────────────
// Called client-side when a pipeline row is expanded.
// Uses metadata->>orderNo text extraction — confirmed syntax from project page:
//   .or(`parent_entity_id.eq.${quotationId},metadata->>orderNo.eq.${orderNo}`)

export async function getProjectRecentActivity(orderNo: string): Promise<ActivityEntry[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("audit_activity_log")
    .select("id, title, description, created_at, metadata")
    .filter("metadata->>orderNo", "eq", orderNo)
    .eq("entity_type", "project_activity")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !data) return [];

  return (data as Array<{
    id: string;
    title: string;
    description: string | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }>).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    created_at: row.created_at,
    actorName: (row.metadata?.actorName as string | undefined) ?? null,
  }));
}

// ─── Types for sales data ────────────────────────────────────────────────────

export type MonthlyTotal = { month: number; total: number };

export type SalesPersonStat = {
  salesperson_id: string | null;
  full_name: string;
  avatar_url: string | null;
  total: number;
  deal_count: number;
};

export type DashboardSalesData = {
  yearlyTurnover: number;
  dealCount: number;
  salesByPerson: SalesPersonStat[];
};

// ─── 5. getDashboardSalesData ─────────────────────────────────────────────────
// Session client is sufficient — profiles SELECT RLS uses current_user_is_active(),
// same as the sales-report page which reads profiles without an admin client.
// Quotations are filtered at the DB level (status + is_active + year range) to
// avoid fetching all rows. Profiles join is done in JS, matching sales-report pattern.

export async function getDashboardSalesData(): Promise<DashboardSalesData> {
  await requireActiveUser();
  const supabase = await createClient();

  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;

  const [{ data: quotations }, { data: profiles }] = await Promise.all([
    supabase
      .from("quotations")
      .select("id, salesperson_id, grand_total")
      .eq("status", "client_confirmed")
      .eq("is_active", true)
      .gte("created_at", yearStart)
      .lt("created_at", yearEnd)
      // Exclude projects cancelled via cancelProjectAction — that action writes
      // projectCancelledAt into layout_settings JSONB but does not change status
      // or is_active, so without this filter cancelled projects are counted.
      // ->> extracts as text; returns SQL NULL when the key is absent (= not cancelled).
      .filter("layout_settings->>projectCancelledAt", "is", null)
      .returns<Array<{ id: string; salesperson_id: string | null; grand_total: number }>>(),
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .eq("role", "sales_designer")
      .eq("account_status", "active")
      .returns<Array<{ id: string; full_name: string | null; avatar_url: string | null }>>(),
  ]);

  const rows = quotations ?? [];
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const yearlyTurnover = rows.reduce((sum, q) => sum + (q.grand_total ?? 0), 0);
  const dealCount = rows.length;

  // Aggregate totals per salesperson_id (null key = unattributed)
  const byPerson = new Map<string | null, { total: number; deal_count: number }>();
  for (const q of rows) {
    const key = q.salesperson_id ?? null;
    const existing = byPerson.get(key);
    if (existing) {
      existing.total += q.grand_total ?? 0;
      existing.deal_count += 1;
    } else {
      byPerson.set(key, { total: q.grand_total ?? 0, deal_count: 1 });
    }
  }

  // Attributed rows sorted by total desc; unattributed row pinned last
  const attributed: SalesPersonStat[] = [];
  let unattributedStat: SalesPersonStat | null = null;

  for (const [personId, stat] of byPerson) {
    if (personId === null) {
      unattributedStat = {
        salesperson_id: null,
        full_name: "Unattributed",
        avatar_url: null,
        total: stat.total,
        deal_count: stat.deal_count,
      };
    } else {
      const profile = profileMap.get(personId);
      attributed.push({
        salesperson_id: personId,
        full_name: profile?.full_name ?? "Unknown",
        avatar_url: profile?.avatar_url ?? null,
        total: stat.total,
        deal_count: stat.deal_count,
      });
    }
  }

  attributed.sort((a, b) => b.total - a.total);

  return {
    yearlyTurnover,
    dealCount,
    salesByPerson: unattributedStat ? [...attributed, unattributedStat] : attributed,
  };
}

// ─── 6. getMonthlySalesData ───────────────────────────────────────────────────
// Returns an array of 12 entries (one per calendar month) with the summed
// grand_total of client_confirmed, non-cancelled quotations for the current year.
// Months with no confirmed quotations have total = 0.

export async function getMonthlySalesData(): Promise<MonthlyTotal[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const year = new Date().getFullYear();

  const { data } = await supabase
    .from("quotations")
    .select("grand_total, created_at")
    .eq("status", "client_confirmed")
    .eq("is_active", true)
    .gte("created_at", `${year}-01-01`)
    .lt("created_at", `${year + 1}-01-01`)
    .filter("layout_settings->>projectCancelledAt", "is", null)
    .returns<Array<{ grand_total: number; created_at: string }>>();

  // Initialise all 12 months at 0 (month numbers 1–12)
  const totals: MonthlyTotal[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    total: 0,
  }));

  for (const row of data ?? []) {
    const monthIndex = new Date(row.created_at).getMonth(); // 0-based
    totals[monthIndex].total += row.grand_total ?? 0;
  }

  return totals;
}
