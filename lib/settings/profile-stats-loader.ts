import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  actualApprovedQuotationsByFolder,
  latestPrimaryQuotationsByFolder,
  quotationSalesFolderKey,
} from "@/lib/quotations/sales-attribution";
import type { SalesCommissionRow } from "@/lib/commissions/types";

type DateRange = { from: string; to: string };

function inclusiveRangeEnd(dateRange: DateRange) {
  return dateRange.to.includes("T") ? dateRange.to : `${dateRange.to}T23:59:59.999Z`;
}

type QuotationRow = {
  id: string;
  client_id: string | null;
  legacy_reference: string | null;
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
  created_by: string | null;
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
  actor_name?: string | null;
  actor_role?: string | null;
  quotation_id?: string | null;
  quotation_no?: string | null;
};

export type ProfileProjectRow = {
  approvedValue: number;
  clientName: string;
  currency: string;
  folderKey: string;
  id: string;
  lastUpdated: string;
  latestQuotation: string;
  preparedBy: string;
  projectName: string;
  quotedValue: number;
  salesManager: string;
  status: string;
};

export type ProfileCommissionRow = Pick<SalesCommissionRow,
  "id" | "quotation_folder_key" | "approved_total_including_vat" | "formula_type_snapshot" |
  "original_calculated_amount" | "final_commission_amount" | "currency" | "status" |
  "earned_at" | "paid_at"
>;

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
    createdAt <= new Date(inclusiveRangeEnd(dateRange)).getTime()
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
  role: string | null = null,
) {
  const supabase = await createClient();

  // Effective range: caller-supplied or last-6-months default for bucket generation
  const range = dateRange ?? getDateRangePreset("last_6_months");

  const quotationsQuery = supabase
    .from("quotations")
    .select("id,client_id,legacy_reference,quotation_no,option_no,revision_no,approved_salesperson_id,salesperson_id,created_by,title,status,grand_total,currency,created_at,status_updated_at,layout_settings")
    .order("created_at", { ascending: false });

  let activityQuery = supabase
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

  let quotationsPreparedQuery = supabase
    .from("audit_activity_log")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .eq("entity_type", "quotation")
    .eq("action", "quotation_created");

  let revisionsPreparedQuery = supabase
    .from("audit_activity_log")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .eq("entity_type", "quotation")
    .eq("action", "revision_created");
  let optionsPreparedQuery = supabase
    .from("audit_activity_log")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .eq("entity_type", "quotation")
    .eq("action", "quotation_option_created");

  let personalActivityCountQuery = supabase
    .from("audit_activity_log")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .in("entity_type", ["quotation", "quotation_item", "quotation_section"]);

  let workActivityQuery = supabase
    .from("audit_activity_log")
    .select("entity_id,parent_entity_id")
    .eq("created_by", userId)
    .in("entity_type", ["quotation", "quotation_item", "quotation_section"])
    .limit(1000);

  let commissionsQuery = supabase
    .from("sales_commissions")
    .select("id,quotation_folder_key,approved_total_including_vat,formula_type_snapshot,original_calculated_amount,final_commission_amount,currency,status,earned_at,paid_at")
    .eq("salesperson_id", userId)
    .order("earned_at", { ascending: false });

  if (dateRange !== null) {
    activityQuery = activityQuery
      .gte("created_at", dateRange.from)
      .lte("created_at", inclusiveRangeEnd(dateRange));
    quotationsPreparedQuery = quotationsPreparedQuery
      .gte("created_at", dateRange.from)
      .lte("created_at", inclusiveRangeEnd(dateRange));
    revisionsPreparedQuery = revisionsPreparedQuery
      .gte("created_at", dateRange.from)
      .lte("created_at", inclusiveRangeEnd(dateRange));
    optionsPreparedQuery = optionsPreparedQuery
      .gte("created_at", dateRange.from)
      .lte("created_at", inclusiveRangeEnd(dateRange));
    personalActivityCountQuery = personalActivityCountQuery
      .gte("created_at", dateRange.from)
      .lte("created_at", inclusiveRangeEnd(dateRange));
    workActivityQuery = workActivityQuery
      .gte("created_at", dateRange.from)
      .lte("created_at", inclusiveRangeEnd(dateRange));
    commissionsQuery = commissionsQuery
      .gte("earned_at", dateRange.from)
      .lte("earned_at", inclusiveRangeEnd(dateRange));
  }

  const [
    { data: quotationRows, error: quotationError },
    { data: activityRows, error: activityError },
    quotationsPreparedResult,
    revisionsPreparedResult,
    optionsPreparedResult,
    personalActivityCountResult,
    { data: workActivityRows },
    { data: commissionRows },
  ] = await Promise.all([
    quotationsQuery.returns<QuotationRow[]>(),
    activityQuery.returns<ActivityRow[]>(),
    quotationsPreparedQuery,
    revisionsPreparedQuery,
    optionsPreparedQuery,
    personalActivityCountQuery,
    workActivityQuery,
    role === "sales_designer"
      ? commissionsQuery.returns<ProfileCommissionRow[]>()
      : Promise.resolve({ data: [] as ProfileCommissionRow[] }),
  ]);

  if (quotationError) {
    console.warn("loadProfileStats: quotations query failed", quotationError.message);
  }
  if (activityError) {
    console.warn("loadProfileStats: audit_activity_log query failed", activityError.message);
  }

  const stats = commercialProfileStats(quotationRows ?? [], userId, range, dateRange);
  const recentPreparedQuotations = (quotationRows ?? [])
    .filter((quotation) => quotation.created_by === userId && isWithinDateRange(quotation, dateRange))
    .slice(0, 10);
  const ownedQuotationRows = (quotationRows ?? []).filter(
    (quotation) => quotation.salesperson_id === userId,
  );
  const ownedQuotationIds = ownedQuotationRows.map((quotation) => quotation.id);
  let salesActivity: ActivityRow[] = [];

  if (ownedQuotationIds.length > 0) {
    const adminResult = createAdminClient();
    const salesActivityClient = adminResult.client ?? supabase;
    let salesActivityQuery = salesActivityClient
      .from("audit_activity_log")
      .select("id,action,title,description,entity_type,entity_id,parent_entity_id,created_by,created_at")
      .or(`entity_id.in.(${ownedQuotationIds.join(",")}),parent_entity_id.in.(${ownedQuotationIds.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(10);

    if (dateRange !== null) {
      salesActivityQuery = salesActivityQuery
        .gte("created_at", dateRange.from)
        .lte("created_at", inclusiveRangeEnd(dateRange));
    }

    const { data: salesActivityRows, error: salesActivityError } = await salesActivityQuery.returns<
      (ActivityRow & {
        entity_id: string;
        parent_entity_id: string | null;
        created_by: string | null;
      })[]
    >();

    if (salesActivityError) {
      console.warn("loadProfileStats: owned sales activity query failed", salesActivityError.message);
    } else {
      const actorIds = Array.from(new Set((salesActivityRows ?? []).flatMap((row) => row.created_by ? [row.created_by] : [])));
      const { data: actorProfiles } = actorIds.length > 0 && adminResult.client
        ? await adminResult.client
          .from("profiles")
          .select("id,full_name,email,role")
          .in("id", actorIds)
          .returns<{ id: string; full_name: string | null; email: string | null; role: string | null }[]>()
        : { data: [] };
      const actorById = new Map((actorProfiles ?? []).map((profile) => [profile.id, profile]));
      const quotationById = new Map(ownedQuotationRows.map((quotation) => [quotation.id, quotation]));

      salesActivity = (salesActivityRows ?? []).map((row) => {
        const quotationId = quotationById.has(row.entity_id) ? row.entity_id : row.parent_entity_id;
        const quotation = quotationId ? quotationById.get(quotationId) : null;
        const actor = row.created_by ? actorById.get(row.created_by) : null;
        return {
          ...row,
          actor_name: actor?.full_name?.trim() || actor?.email?.trim() || "Unknown user",
          actor_role: actor?.role ?? null,
          quotation_id: quotationId,
          quotation_no: quotation?.quotation_no ?? null,
        };
      });
    }
  }

  const rows = quotationRows ?? [];
  const quotationById = new Map(rows.map((quotation) => [quotation.id, quotation]));
  const workedFolderKeys = new Set<string>();
  for (const quotation of rows) {
    if (quotation.created_by === userId && isWithinDateRange(quotation, dateRange)) {
      workedFolderKeys.add(quotationSalesFolderKey(quotation));
    }
  }
  for (const activity of (workActivityRows ?? []) as { entity_id: string; parent_entity_id: string | null }[]) {
    const quotation = quotationById.get(activity.entity_id) ??
      (activity.parent_entity_id ? quotationById.get(activity.parent_entity_id) : undefined);
    if (quotation) workedFolderKeys.add(quotationSalesFolderKey(quotation));
  }

  const latestRows = latestPrimaryQuotationsByFolder(rows).filter((quotation) =>
    isWithinDateRange(quotation, dateRange),
  );
  const commercialRows = latestRows.filter((quotation) => quotation.salesperson_id === userId);
  const preparedRows = latestRows.filter((quotation) => workedFolderKeys.has(quotationSalesFolderKey(quotation)));
  const visibleProjectRows = role === "sales_designer" ? commercialRows : preparedRows;
  const approvedByFolder = new Map(
    actualApprovedQuotationsByFolder(rows)
      .filter((quotation) =>
        isWithinDateRange(quotation, dateRange) &&
        (role !== "sales_designer" || quotation.approved_salesperson_id === userId),
      )
      .map((quotation) => [quotationSalesFolderKey(quotation), quotation]),
  );
  const commissionByFolder = new Map<string, ProfileCommissionRow>();
  for (const commission of commissionRows ?? []) {
    if (!commissionByFolder.has(commission.quotation_folder_key)) {
      commissionByFolder.set(commission.quotation_folder_key, commission);
    }
  }

  const clientIds = Array.from(new Set(visibleProjectRows.flatMap((row) => row.client_id ? [row.client_id] : [])));
  const visibleFolderKeys = visibleProjectRows.map(quotationSalesFolderKey);
  const profileIds = Array.from(new Set(visibleProjectRows.flatMap((row) =>
    [row.salesperson_id, row.created_by].filter((id): id is string => Boolean(id)),
  )));
  const adminResult = createAdminClient();
  const [{ data: clientRows }, { data: profileRows }, { data: approvalSnapshotRows }] = adminResult.client
    ? await Promise.all([
      clientIds.length
        ? adminResult.client.from("clients").select("id,company_name").in("id", clientIds).returns<{ id: string; company_name: string | null }[]>()
        : Promise.resolve({ data: [] as { id: string; company_name: string | null }[] }),
      profileIds.length
        ? adminResult.client.from("profiles").select("id,full_name,email").in("id", profileIds).returns<{ id: string; full_name: string | null; email: string | null }[]>()
        : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
      role !== "sales_designer" && visibleFolderKeys.length
        ? adminResult.client.from("sales_commissions")
          .select("quotation_folder_key,approved_total_including_vat,earned_at")
          .in("quotation_folder_key", visibleFolderKeys)
          .gte("earned_at", dateRange?.from ?? "1970-01-01T00:00:00.000Z")
          .lte("earned_at", dateRange ? inclusiveRangeEnd(dateRange) : new Date().toISOString())
          .order("earned_at", { ascending: false })
          .returns<{ quotation_folder_key: string; approved_total_including_vat: number; earned_at: string }[]>()
        : Promise.resolve({ data: [] as { quotation_folder_key: string; approved_total_including_vat: number; earned_at: string }[] }),
    ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const clientNameById = new Map((clientRows ?? []).map((client) => [client.id, client.company_name ?? "Unknown client"]));
  const profileNameById = new Map((profileRows ?? []).map((profile) => [profile.id, profile.full_name?.trim() || profile.email || "Unknown user"]));
  const approvalSnapshotValueByFolder = new Map<string, number>();
  for (const snapshot of approvalSnapshotRows ?? []) {
    if (!approvalSnapshotValueByFolder.has(snapshot.quotation_folder_key)) {
      approvalSnapshotValueByFolder.set(snapshot.quotation_folder_key, Number(snapshot.approved_total_including_vat));
    }
  }

  const projects: ProfileProjectRow[] = visibleProjectRows.map((quotation) => {
    const folderKey = quotationSalesFolderKey(quotation);
    const approvedQuotation = approvedByFolder.get(folderKey);
    const commission = commissionByFolder.get(folderKey);
    return {
      approvedValue: commission
        ? Number(commission.approved_total_including_vat)
        : approvalSnapshotValueByFolder.get(folderKey) ?? approvedQuotation?.grand_total ?? 0,
      clientName: quotation.client_id ? clientNameById.get(quotation.client_id) ?? "Unknown client" : "No client",
      currency: quotation.currency ?? "AED",
      folderKey,
      id: quotation.id,
      lastUpdated: quotation.status_updated_at ?? quotation.created_at,
      latestQuotation: quotation.quotation_no ?? "—",
      preparedBy: quotation.created_by ? profileNameById.get(quotation.created_by) ?? "Unknown user" : "Unknown user",
      projectName: quotation.legacy_reference?.trim() || quotation.title?.trim() || "Untitled enquiry",
      quotedValue: quotation.grand_total ?? 0,
      salesManager: quotation.salesperson_id ? profileNameById.get(quotation.salesperson_id) ?? "Unassigned" : "Unassigned",
      status: quotation.status,
    };
  });

  const projectQuotedValue = projects.reduce((sum, project) => sum + project.quotedValue, 0);
  const projectApprovedValue = projects.reduce((sum, project) => sum + project.approvedValue, 0);
  const uniqueClients = new Set(visibleProjectRows.map((row) => row.client_id).filter(Boolean)).size;

  return {
    ...stats,
    quotationsPrepared: quotationsPreparedResult.error
      ? 0
      : quotationsPreparedResult.count ?? 0,
    revisionsPrepared: revisionsPreparedResult.error ? 0 : revisionsPreparedResult.count ?? 0,
    optionsPrepared: optionsPreparedResult.error ? 0 : optionsPreparedResult.count ?? 0,
    personalActivityCount: personalActivityCountResult.error
      ? 0
      : personalActivityCountResult.count ?? 0,
    salesActivity,
    projects,
    projectSummary: {
      approvedValue: projectApprovedValue,
      averageApprovedValue: projects.filter((project) => project.approvedValue > 0).length
        ? projectApprovedValue / projects.filter((project) => project.approvedValue > 0).length
        : 0,
      averageQuotedValue: projects.length ? projectQuotedValue / projects.length : 0,
      pendingQuotedValue: projects.filter((project) => project.approvedValue <= 0).reduce((sum, project) => sum + project.quotedValue, 0),
      quotedValue: projectQuotedValue,
      uniqueClients,
      uniqueProjects: projects.length,
    },
    commissions: commissionRows ?? [],
    recentPreparedQuotations,
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
        .lte("created_at", inclusiveRangeEnd(dateRange));
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
      .lte("created_at", inclusiveRangeEnd(dateRange));
  }

  if (dateRange !== null) {
    activityQuery = activityQuery
      .gte("created_at", dateRange.from)
      .lte("created_at", inclusiveRangeEnd(dateRange));
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
