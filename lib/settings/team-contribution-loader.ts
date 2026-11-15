import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildTeamContribution,
  LOGGED_EDIT_ACTION_NAMES,
  LOGGED_EDIT_ENTITY_TYPES,
  type ContributionQuotation,
  type ContributionRange,
  type CreationAuditRow,
  type EditAuditRow,
  type MemberContribution,
} from "@/lib/settings/team-contribution";

const PAGE_SIZE = 1000;

async function fetchAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[] | null> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      console.warn(`loadTeamContributionStats: ${label} query failed`, error.message);
      return null;
    }
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

/**
 * Team Contribution tab numbers (created / edited / created value). A separate loader on purpose:
 * loadTeamStats keeps feeding /settings/profile and the Commercial tab unchanged. System owner only; the caller checks the role.
 */
export async function loadTeamContributionStats(
  range: ContributionRange,
  userIds: string[],
): Promise<Record<string, MemberContribution> | null> {
  const adminResult = createAdminClient();
  if (!adminResult.client) return null;
  const admin = adminResult.client;
  const rangeTo = range.to.includes("T") ? range.to : `${range.to}T23:59:59.999Z`;

  const [quotations, creationAudit, editAudit] = await Promise.all([
    fetchAll<ContributionQuotation>("quotations", (from, to) =>
      admin
        .from("quotations")
        .select("id,quotation_no,option_no,revision_no,created_by,title,status,grand_total,currency,created_at,status_updated_at,layout_settings")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
        .returns<ContributionQuotation[]>(),
    ),
    fetchAll<CreationAuditRow>("creation audit", (from, to) =>
      admin
        .from("audit_activity_log")
        .select("entity_id,created_by,created_at")
        .eq("entity_type", "quotation")
        .eq("action", "quotation_created")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
        .returns<CreationAuditRow[]>(),
    ),
    fetchAll<EditAuditRow>("edit audit", (from, to) =>
      admin
        .from("audit_activity_log")
        .select("action,entity_type,entity_id,parent_entity_id,created_by,created_at")
        .in("entity_type", LOGGED_EDIT_ENTITY_TYPES)
        .in("action", LOGGED_EDIT_ACTION_NAMES)
        .gte("created_at", range.from)
        .lte("created_at", rangeTo)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
        .returns<EditAuditRow[]>(),
    ),
  ]);
  if (!quotations || !creationAudit || !editAudit) return null;

  return buildTeamContribution({ creationAudit, editAudit, quotations, range, userIds });
}
