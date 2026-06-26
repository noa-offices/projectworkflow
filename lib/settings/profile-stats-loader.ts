import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type QuotationRow = {
  id: string;
  quotation_no: string | null;
  title: string | null;
  status: string;
  grand_total: number | null;
  currency: string | null;
  created_at: string;
};

type MonthlyData = {
  month: string;
  year: number;
  monthKey: string;
  total: number;
  approved: number;
  value: number;
};

type ActivityRow = {
  id: string;
  action: string;
  title: string;
  description: string | null;
  entity_type: string;
  created_at: string;
};

export async function loadProfileStats(userId: string) {
  const supabase = await createClient();

  const [{ data: quotationRows, error: quotationError }, { data: activityRows, error: activityError }] =
    await Promise.all([
      supabase
        .from("quotations")
        .select("id,quotation_no,title,status,grand_total,currency,created_at")
        .eq("created_by", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<QuotationRow[]>(),
      supabase
        .from("audit_activity_log")
        .select("id,action,title,description,entity_type,created_at")
        .eq("created_by", userId)
        .order("created_at", { ascending: false })
        .limit(10)
        .returns<ActivityRow[]>(),
    ]);

  if (quotationError) {
    console.warn("loadProfileStats: quotations query failed", quotationError.message);
  }
  if (activityError) {
    console.warn("loadProfileStats: audit_activity_log query failed", activityError.message);
  }

  const rows = quotationRows ?? [];

  const totalQuotations = rows.length;
  const approvedQuotations = rows.filter((q) => q.status === "client_confirmed").length;
  const totalValue = rows.reduce((sum, q) => sum + (q.grand_total ?? 0), 0);
  const currency = rows[0]?.currency ?? "AED";
  const recentQuotations = rows.slice(0, 5);

  const now = new Date();
  const monthlyData: MonthlyData[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.toLocaleString("en-US", { month: "short" });
    const monthKey = `${year}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyData.push({ month, year, monthKey, total: 0, approved: 0, value: 0 });
  }
  for (const q of rows) {
    const d = new Date(q.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = monthlyData.find((m) => m.monthKey === key);
    if (bucket) {
      bucket.total++;
      if (q.status === "client_confirmed") bucket.approved++;
      bucket.value += q.grand_total ?? 0;
    }
  }

  return {
    totalQuotations,
    approvedQuotations,
    totalValue,
    currency,
    recentQuotations,
    recentActivity: activityRows ?? [],
    monthlyData,
  };
}

type TeamProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  account_status: string | null;
};

type TeamQuotationRow = {
  id: string;
  created_by: string | null;
  status: string;
  grand_total: number | null;
  currency: string | null;
};

export type TeamMemberStat = {
  userId: string;
  displayName: string;
  role: string | null;
  totalQuotations: number;
  approvedQuotations: number;
  totalValue: number;
  currency: string;
};

export async function loadTeamStats(): Promise<TeamMemberStat[] | null> {
  const adminResult = createAdminClient();
  if (!adminResult.client) return null;
  const admin = adminResult.client;

  const [{ data: profileRows, error: profileError }, { data: quotationRows, error: quotationError }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id,full_name,email,role,account_status")
        .eq("account_status", "active")
        .order("full_name", { ascending: true })
        .returns<TeamProfileRow[]>(),
      admin
        .from("quotations")
        .select("id,created_by,status,grand_total,currency")
        .eq("is_active", true)
        .limit(500)
        .returns<TeamQuotationRow[]>(),
    ]);

  if (profileError) {
    console.warn("loadTeamStats: profiles query failed", profileError.message);
    return null;
  }
  if (quotationError) {
    console.warn("loadTeamStats: quotations query failed", quotationError.message);
    return null;
  }

  const quotations = quotationRows ?? [];

  const stats: TeamMemberStat[] = (profileRows ?? []).map((profile) => {
    const userQuotations = quotations.filter((q) => q.created_by === profile.id);
    const totalQuotations = userQuotations.length;
    const approvedQuotations = userQuotations.filter((q) => q.status === "client_confirmed").length;
    const totalValue = userQuotations.reduce((sum, q) => sum + (q.grand_total ?? 0), 0);
    const currency = userQuotations[0]?.currency ?? "AED";
    const displayName = profile.full_name?.trim() || profile.email?.trim() || "Unknown";

    return {
      userId: profile.id,
      displayName,
      role: profile.role,
      totalQuotations,
      approvedQuotations,
      totalValue,
      currency,
    };
  });

  return stats.sort((a, b) => b.totalValue - a.totalValue);
}
