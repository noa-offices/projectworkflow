"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { quotationFolderNumberFromQuotationNumber } from "@/lib/projectworkflow-numbering";
import type { AlertIconKey, DashboardAlert } from "@/components/dashboard/alerts-panel";
import { sendNotificationToRole } from "@/lib/notifications/actions";
// ─── Exported types ───────────────────────────────────────────────────────────

export type DashboardStats = {
  activeProjects: number;
  completedProjects: number;
  pendingQuotations: number;
  quotationWorkflow: {
    clientConfirmed: number;
    draft: number;
    readyToSend: number;
    sentToClient: number;
  };
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
  const { data: quotations } = await supabase
    .from("quotations")
    .select("id, project_id, quotation_no, quotation_date, status, is_active, layout_settings")
    .returns<Array<{
      id: string;
      project_id: string | null;
      quotation_no: string | null;
      quotation_date: string;
      status: string;
      is_active: boolean;
      layout_settings: unknown;
    }>>();

  let activeProjects = 0;
  let completedProjects = 0;
  const seen = new Set<string>();
  const quotationFolders = new Map<string, NonNullable<typeof quotations>[number]>();

  for (const quotation of quotations ?? []) {
    const folderNo = quotationFolderNumberFromQuotationNumber(quotation.quotation_no);
    const folderKey = folderNo ?? (quotation.project_id ? `project:${quotation.project_id}` : `legacy:${quotation.id}`);
    const currentRepresentative = quotationFolders.get(folderKey);
    if (
      quotation.is_active &&
      (!currentRepresentative ||
        !currentRepresentative.is_active ||
        new Date(quotation.quotation_date) > new Date(currentRepresentative.quotation_date))
    ) {
      quotationFolders.set(folderKey, quotation);
    } else if (!currentRepresentative) {
      quotationFolders.set(folderKey, quotation);
    }

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

  const workflow = {
    clientConfirmed: 0,
    draft: 0,
    readyToSend: 0,
    sentToClient: 0,
  };
  let pendingQuotations = 0;

  for (const quotation of quotationFolders.values()) {
    if (!quotation.is_active) continue;
    if (PENDING_STATUSES.includes(quotation.status)) pendingQuotations++;
    if (quotation.status === "draft") workflow.draft++;
    if (quotation.status === "ready_to_send") workflow.readyToSend++;
    if (quotation.status === "sent_to_client") workflow.sentToClient++;
    if (quotation.status === "client_confirmed") workflow.clientConfirmed++;
  }

  return {
    activeProjects,
    completedProjects,
    pendingQuotations,
    quotationWorkflow: workflow,
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
    .order("created_at", { ascending: false })
    .limit(3);

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
// Profiles query uses admin client — RLS profiles_select_own restricts non-system-owners
// to their own row only, so the session client returns only the current user's profile.

export async function getDashboardSalesData(): Promise<DashboardSalesData> {
  await requireActiveUser();
  const supabase = await createClient();
  const adminResult = createAdminClient();
  if (!adminResult.client) throw new Error(adminResult.error ?? "Admin client unavailable");
  const adminClient = adminResult.client;

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
    adminClient
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

// ─── 7. getHrExpiryAlerts ────────────────────────────────────────────────────
// Loads upcoming document expiry alerts for profiles_hr and workers.
// Also sends in-app notifications at the exact threshold days (60/30/10/0),
// deduplicating via hr_expiry_notifications and worker_expiry_notifications.
// Returns an empty array on any error so the dashboard never breaks.

const ALERT_THRESHOLDS = [60, 30, 10, 0] as const;

function expiryTone(daysUntil: number): string {
  if (daysUntil <= 0) return "bg-red-100 text-red-800";
  if (daysUntil <= 10) return "bg-red-50 text-red-700";
  if (daysUntil <= 30) return "bg-amber-50 text-amber-700";
  return "bg-yellow-50 text-yellow-700";
}

function expiryIcon(daysUntil: number): AlertIconKey {
  if (daysUntil <= 10) return "critical";
  if (daysUntil <= 30) return "warning";
  return "info";
}

function formatExpiryDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en", { dateStyle: "medium" });
}

function expiryDetail(daysUntil: number, dateStr: string): string {
  if (daysUntil <= 0) return `Expired on ${formatExpiryDate(dateStr)}`;
  if (daysUntil === 1) return "Expires tomorrow";
  return `Expires in ${daysUntil} days (${formatExpiryDate(dateStr)})`;
}

function notificationBody(name: string, fieldLabel: string, daysUntil: number, dateStr: string): string {
  if (daysUntil <= 0) {
    return `EXPIRED: ${name}'s ${fieldLabel} expired today`;
  }
  return `${name}'s ${fieldLabel} expires in ${daysUntil} days (expires ${formatExpiryDate(dateStr)})`;
}

function daysUntilDate(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function nearestThreshold(daysUntil: number): (typeof ALERT_THRESHOLDS)[number] | null {
  return (ALERT_THRESHOLDS.find((t) => t === daysUntil) ?? null) as (typeof ALERT_THRESHOLDS)[number] | null;
}

export async function getHrExpiryAlerts(): Promise<DashboardAlert[]> {
  try {
    await requireActiveUser();

    const adminResult = createAdminClient();
    if (!adminResult.client) return [];
    const adminClient = adminResult.client;

    const today = new Date().toISOString().slice(0, 10);

    // ── Parallel data fetch ────────────────────────────────────────────────────
    const [hrResult, workersResult] = await Promise.all([
      adminClient
        .from("profiles_hr")
        .select("profile_id, emirates_id_expiry, passport_expiry, profiles!inner(full_name, email)")
        .returns<Array<{
          profile_id: string;
          emirates_id_expiry: string | null;
          passport_expiry: string | null;
          profiles: { full_name: string | null; email: string | null } | null;
        }>>(),
      adminClient
        .from("workers")
        .select("id, full_name, emirates_id_expiry, passport_expiry, status")
        .neq("status", "offboarded")
        .returns<Array<{
          id: string;
          full_name: string;
          emirates_id_expiry: string | null;
          passport_expiry: string | null;
          status: string;
        }>>(),
    ]);

    const hrRows = hrResult.data ?? [];
    const workerRows = workersResult.data ?? [];

    // ── Build alerts ──────────────────────────────────────────────────────────

    const alerts: (DashboardAlert & { _daysUntil: number })[] = [];

    // HR profile alerts
    for (const row of hrRows) {
      const name = row.profiles?.full_name?.trim() || row.profiles?.email?.trim() || "Unknown";

      for (const [field, label] of [
        ["emirates_id_expiry", "Emirates ID"],
        ["passport_expiry", "Passport"],
      ] as const) {
        const dateStr = row[field];
        if (!dateStr) continue;
        const daysUntil = daysUntilDate(dateStr);
        if (daysUntil > 60) continue;

        alerts.push({
          title: `${name} — ${label}`,
          detail: expiryDetail(daysUntil, dateStr),
          icon: expiryIcon(daysUntil),
          tone: expiryTone(daysUntil),
          _daysUntil: daysUntil,
        });

        // In-app notification at exact thresholds
        try {
          const threshold = nearestThreshold(daysUntil);
          if (threshold !== null) {
            const { data: existing } = await adminClient
              .from("hr_expiry_notifications")
              .select("id")
              .eq("profile_id", row.profile_id)
              .eq("field_name", field)
              .eq("threshold_days", threshold)
              .eq("sent_at", today)
              .maybeSingle<{ id: string }>();

            if (!existing) {
              const body = notificationBody(name, label, daysUntil, dateStr);
              await Promise.allSettled([
                sendNotificationToRole("system_owner", body),
                sendNotificationToRole("admin_manager", body),
                adminClient.from("hr_expiry_notifications").insert({
                  profile_id: row.profile_id,
                  field_name: field,
                  threshold_days: threshold,
                  sent_at: today,
                } as never),
              ]);
            }
          }
        } catch {
          // Notification failures must not break the alerts panel.
        }
      }
    }

    // Worker alerts
    for (const row of workerRows) {
      const name = row.full_name?.trim() || "Unknown worker";

      for (const [field, label] of [
        ["emirates_id_expiry", "Emirates ID"],
        ["passport_expiry", "Passport"],
      ] as const) {
        const dateStr = row[field];
        if (!dateStr) continue;
        const daysUntil = daysUntilDate(dateStr);
        if (daysUntil > 60) continue;

        alerts.push({
          title: `${name} (worker) — ${label}`,
          detail: expiryDetail(daysUntil, dateStr),
          icon: expiryIcon(daysUntil),
          tone: expiryTone(daysUntil),
          _daysUntil: daysUntil,
        });

        // In-app notification at exact thresholds
        try {
          const threshold = nearestThreshold(daysUntil);
          if (threshold !== null) {
            const { data: existing } = await adminClient
              .from("worker_expiry_notifications")
              .select("id")
              .eq("worker_id", row.id)
              .eq("field_name", field)
              .eq("threshold_days", threshold)
              .eq("sent_at", today)
              .maybeSingle<{ id: string }>();

            if (!existing) {
              const body = notificationBody(name, label, daysUntil, dateStr);
              await Promise.allSettled([
                sendNotificationToRole("system_owner", body),
                sendNotificationToRole("admin_manager", body),
                adminClient.from("worker_expiry_notifications").insert({
                  worker_id: row.id,
                  field_name: field,
                  threshold_days: threshold,
                  sent_at: today,
                } as never),
              ]);
            }
          }
        } catch {
          // Notification failures must not break the alerts panel.
        }
      }
    }

    // Sort most urgent first
    alerts.sort((a, b) => a._daysUntil - b._daysUntil);

    return alerts.map(({ _daysUntil: _, ...alert }) => alert);
  } catch {
    return [];
  }
}
