import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  actualApprovedQuotationsByFolder,
  latestPrimaryQuotationsByFolder,
} from "@/lib/quotations/sales-attribution";

type DateRange = { from: string; to: string };

type QuotationRow = {
  id: string;
  quotation_no: string | null;
  option_no: number | null;
  revision_no: number | null;
  approved_salesperson_id: string | null;
  salesperson_id: string | null;
  title: string | null;
  status: string;
  grand_total: number | null;
  currency: string | null;
  created_at: string;
  status_updated_at: string | null;
  layout_settings: unknown;
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

// ── Date range preset helper ──────────────────────────────────────────────────

export function getDateRangePreset(
  preset: "this_month" | "last_3_months" | "last_6_months" | "this_year",
): DateRange {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  switch (preset) {
    case "this_month":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
        to: today,
      };
    case "last_3_months":
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10),
        to: today,
      };
    case "last_6_months":
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString().slice(0, 10),
        to: today,
      };
    case "this_year":
      return { from: `${now.getFullYear()}-01-01`, to: today };
  }
}

// ── Monthly bucket builder ────────────────────────────────────────────────────

function buildMonthlyBuckets(from: string, to: string): MonthlyData[] {
  const buckets: MonthlyData[] = [];
  const start = new Date(from);
  const end = new Date(to);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= endMonth) {
    const year = cursor.getFullYear();
    const month = cursor.toLocaleString("en-US", { month: "short" });
    const monthKey = `${year}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    buckets.push({ month, year, monthKey, total: 0, approved: 0, value: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return buckets;
}

function isWithinDateRange(quotation: QuotationRow, dateRange: DateRange | null) {
  if (dateRange === null) return true;
  const createdAt = new Date(quotation.created_at).getTime();
  return (
    createdAt >= new Date(dateRange.from).getTime() &&
    createdAt <= new Date(dateRange.to).getTime()
  );
}

function commercialQuotationRows(
  rows: QuotationRow[],
  userId: string,
  dateRange: DateRange | null,
) {
  const quoted = latestPrimaryQuotationsByFolder(rows)
    .filter(
      (quotation) =>
        quotation.salesperson_id === userId && isWithinDateRange(quotation, dateRange),
    )
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    );
  const approved = actualApprovedQuotationsByFolder(rows).filter(
    (quotation) =>
      quotation.approved_salesperson_id === userId &&
      isWithinDateRange(quotation, dateRange),
  );

  return { approved, quoted };
}

function commercialProfileStats(
  rows: QuotationRow[],
  userId: string,
  range: DateRange,
  dateRange: DateRange | null,
) {
  const { approved, quoted } = commercialQuotationRows(rows, userId, dateRange);
  const monthlyData = buildMonthlyBuckets(range.from, range.to);

  for (const quotation of quoted) {
    const date = new Date(quotation.created_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = monthlyData.find((month) => month.monthKey === key);
    if (bucket) {
      bucket.total++;
      bucket.value += quotation.grand_total ?? 0;
    }
  }

  for (const quotation of approved) {
    const date = new Date(quotation.created_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = monthlyData.find((month) => month.monthKey === key);
    if (bucket) bucket.approved++;
  }

  return {
    approvedQuotations: approved.length,
    currency: quoted[0]?.currency ?? "AED",
    monthlyData,
    recentQuotations: quoted.slice(0, 5),
    totalQuotations: quoted.length,
    totalValue: quoted.reduce((sum, quotation) => sum + (quotation.grand_total ?? 0), 0),
  };
}

// ── loadProfileStats ──────────────────────────────────────────────────────────

export async function loadProfileStats(
  userId: string,
  dateRange: DateRange | null = null,
) {
  const supabase = await createClient();

  // Effective range: caller-supplied or last-6-months default for bucket generation
  const range = dateRange ?? getDateRangePreset("last_6_months");

  const quotationsQuery = supabase
    .from("quotations")
    .select("id,quotation_no,option_no,revision_no,approved_salesperson_id,salesperson_id,title,status,grand_total,currency,created_at,status_updated_at,layout_settings")
    .order("created_at", { ascending: false });

  let activityQuery = supabase
    .from("audit_activity_log")
    .select("id,action,title,description,entity_type,created_at")
    .eq("created_by", userId)
    .in("entity_type", ["quotation", "quotation_item", "quotation_section"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (dateRange !== null) {
    activityQuery = activityQuery
      .gte("created_at", dateRange.from)
      .lte("created_at", dateRange.to);
  }

  const [
    { data: quotationRows, error: quotationError },
    { data: activityRows, error: activityError },
  ] = await Promise.all([
    quotationsQuery.returns<QuotationRow[]>(),
    activityQuery.returns<ActivityRow[]>(),
  ]);

  if (quotationError) {
    console.warn("loadProfileStats: quotations query failed", quotationError.message);
  }
  if (activityError) {
    console.warn("loadProfileStats: audit_activity_log query failed", activityError.message);
  }

  const stats = commercialProfileStats(quotationRows ?? [], userId, range, dateRange);

  return {
    ...stats,
    recentActivity: activityRows ?? [],
  };
}

// ── loadTeamStats ─────────────────────────────────────────────────────────────

type TeamProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  account_status: string | null;
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

export async function loadTeamStats(
  dateRange: DateRange | null = null,
): Promise<TeamMemberStat[] | null> {
  const adminResult = createAdminClient();
  if (!adminResult.client) return null;
  const admin = adminResult.client;

  const teamQuotationsQuery = admin
    .from("quotations")
    .select("id,quotation_no,option_no,revision_no,approved_salesperson_id,salesperson_id,title,status,grand_total,currency,created_at,status_updated_at,layout_settings")
    .order("created_at", { ascending: false });

  const [
    { data: profileRows, error: profileError },
    { data: quotationRows, error: quotationError },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id,full_name,email,role,account_status")
      .eq("account_status", "active")
      .order("full_name", { ascending: true })
      .returns<TeamProfileRow[]>(),
    teamQuotationsQuery.returns<QuotationRow[]>(),
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
    const { approved, quoted } = commercialQuotationRows(quotations, profile.id, dateRange);
    const totalQuotations = quoted.length;
    const approvedQuotations = approved.length;
    const totalValue = quoted.reduce((sum, quotation) => sum + (quotation.grand_total ?? 0), 0);
    const currency = quoted[0]?.currency ?? "AED";
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

// ── loadProfileStatsForUser ───────────────────────────────────────────────────
// Uses the admin client so a system_owner can read any user's data.
// Only call this after requireSystemOwner() (or role === "system_owner") has been verified.

export async function loadProfileStatsForUser(
  userId: string,
  dateRange: DateRange | null = null,
) {
  const adminResult = createAdminClient();
  if (!adminResult.client) return null;
  const admin = adminResult.client;

  const range = dateRange ?? getDateRangePreset("last_6_months");

  const quotationsQuery = admin
    .from("quotations")
    .select("id,quotation_no,option_no,revision_no,approved_salesperson_id,salesperson_id,title,status,grand_total,currency,created_at,status_updated_at,layout_settings")
    .order("created_at", { ascending: false });

  let activityQuery = admin
    .from("audit_activity_log")
    .select("id,action,title,description,entity_type,created_at")
    .eq("created_by", userId)
    .in("entity_type", [
      "quotation",
      "quotation_item",
      "quotation_section",
      "product_template",
      "product_template_price",
      "product_template_detail_price",
      "brand",
      "brand_price_list_update",
    ])
    .order("created_at", { ascending: false })
    .limit(30);

  function auditCountQuery(entityType: string, actions: string[]) {
    let query = admin
      .from("audit_activity_log")
      .select("id", { count: "exact", head: true })
      .eq("created_by", userId)
      .eq("entity_type", entityType)
      .in("action", actions);

    if (dateRange !== null) {
      query = query
        .gte("created_at", dateRange.from)
        .lte("created_at", dateRange.to);
    }

    return query;
  }

  let clientsCreatedQuery = admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId);

  if (dateRange !== null) {
    clientsCreatedQuery = clientsCreatedQuery
      .gte("created_at", dateRange.from)
      .lte("created_at", dateRange.to);
  }

  if (dateRange !== null) {
    activityQuery = activityQuery
      .gte("created_at", dateRange.from)
      .lte("created_at", dateRange.to);
  }

  const [
    { data: quotationRows, error: quotationError },
    { data: activityRows, error: activityError },
    clientsCreatedResult,
    quotationItemsAddedResult,
    productTemplatesCreatedResult,
    productTemplatesUpdatedResult,
    revisionsCreatedResult,
    optionsCreatedResult,
    copiesCreatedResult,
    enquiryUpdatesResult,
    documentActionsResult,
  ] = await Promise.all([
    quotationsQuery.returns<QuotationRow[]>(),
    activityQuery.returns<ActivityRow[]>(),
    clientsCreatedQuery,
    auditCountQuery("quotation_item", ["quotation_item_added"]),
    auditCountQuery("product_template", [
      "created",
      "product_template_created_from_quote",
      "product_template_variant_created_from_quote",
    ]),
    auditCountQuery("product_template", ["updated"]),
    auditCountQuery("quotation", ["revision_created"]),
    auditCountQuery("quotation", ["quotation_option_created"]),
    auditCountQuery("quotation", ["quotation_created"]).eq("metadata->>mode", "duplicate"),
    auditCountQuery("quotation", ["enquiry_details_updated"]),
    auditCountQuery("quotation", [
      "document_setup_updated",
      "project_file_created",
      "confirmed_order_project_created",
    ]),
  ]);

  if (quotationError) {
    console.warn("loadProfileStatsForUser: quotations query failed", quotationError.message);
  }
  if (activityError) {
    console.warn("loadProfileStatsForUser: audit_activity_log query failed", activityError.message);
  }

  function countOrNull(result: { count: number | null; error: { message: string } | null }) {
    return result.error ? null : result.count ?? 0;
  }

  const stats = commercialProfileStats(quotationRows ?? [], userId, range, dateRange);

  return {
    ...stats,
    recentActivity: activityRows ?? [],
    contributions: {
      clientsCreated: countOrNull(clientsCreatedResult),
      copiesCreated: countOrNull(copiesCreatedResult),
      documentActions: countOrNull(documentActionsResult),
      enquiryUpdates: countOrNull(enquiryUpdatesResult),
      optionsCreated: countOrNull(optionsCreatedResult),
      productTemplatesCreated: countOrNull(productTemplatesCreatedResult),
      productTemplatesUpdated: countOrNull(productTemplatesUpdatedResult),
      quotationItemsAdded: countOrNull(quotationItemsAddedResult),
      revisionsCreated: countOrNull(revisionsCreatedResult),
    },
  };
}
