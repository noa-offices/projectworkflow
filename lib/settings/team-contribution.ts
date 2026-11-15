import {
  actualApprovedQuotationsByFolder,
  latestPrimaryQuotationsByFolder,
  quotationSalesFolderKey,
  type SalesAttributionQuotation,
} from "@/lib/quotations/sales-attribution";

/**
 * Team Contribution rules (Insights > Sales Report > Team Contribution tab).
 *
 * CREATED: the creator of the EARLIEST quotation in a folder (quotations.created_by, falling back to the
 * quotation_created audit row) is credited once per folder, with the value of the latest primary quotation
 * of that folder, so revisions are never counted twice. The sales owner gets no credit for owning.
 * EDITED: distinct folders where the person has a LOGGED edit action in the date range, excluding folders
 * they created themselves. Edits never add to created value.
 */

export type ContributionRange = { from: string; to: string };

export type ContributionQuotation = SalesAttributionQuotation & {
  created_by: string | null;
  currency: string | null;
  grand_total: number | null;
  title: string | null;
};

export type CreationAuditRow = {
  created_at: string;
  created_by: string | null;
  entity_id: string | null;
};

export type EditAuditRow = {
  action: string;
  created_at: string;
  created_by: string | null;
  entity_id: string | null;
  entity_type: string;
  parent_entity_id: string | null;
};

/** The only audit_activity_log actions that count as an edit, by entity type. */
export const LOGGED_EDIT_ACTIONS = {
  quotation: [
    "quotation_updated",
    "commercial_terms_updated",
    "enquiry_details_updated",
    "specification_settings_updated",
    "document_setup_updated",
    "extra_discount_updated",
    "quotation_software_snapshot_saved",
    "revision_created",
    "quotation_option_created",
  ],
  quotation_item: [
    "quotation_item_added",
    "quotation_item_updated",
    "quotation_item_restored",
    "manual_currency_converted",
    "deleted",
  ],
  quotation_section: ["deleted", "restored"],
} as const;

export const LOGGED_EDIT_ENTITY_TYPES = Object.keys(LOGGED_EDIT_ACTIONS);
export const LOGGED_EDIT_ACTION_NAMES = Array.from(new Set(Object.values(LOGGED_EDIT_ACTIONS).flat()));

export function isLoggedEdit(row: Pick<EditAuditRow, "action" | "entity_type">): boolean {
  const actions = (LOGGED_EDIT_ACTIONS as Record<string, readonly string[]>)[row.entity_type];
  return Boolean(actions?.includes(row.action));
}

export type ContributionMonth = {
  approved: number;
  month: string;
  monthKey: string;
  total: number;
  value: number;
  year: number;
};

export type MemberContribution = {
  approvedOfCreated: number;
  createdCount: number;
  createdValue: number;
  editedCount: number;
  monthlyData: ContributionMonth[];
  recentCreated: ContributionQuotation[];
  userId: string;
};

function rangeEnd(range: ContributionRange) {
  return range.to.includes("T") ? range.to : `${range.to}T23:59:59.999Z`;
}

function inRange(value: string, range: ContributionRange) {
  const time = new Date(value).getTime();
  return time >= new Date(range.from).getTime() && time <= new Date(rangeEnd(range)).getTime();
}

function monthBuckets(range: ContributionRange): ContributionMonth[] {
  const buckets: ContributionMonth[] = [];
  const start = new Date(range.from);
  const end = new Date(range.to);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= endMonth) {
    buckets.push({
      approved: 0,
      month: cursor.toLocaleString("en-US", { month: "short" }),
      monthKey: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      total: 0,
      value: 0,
      year: cursor.getFullYear(),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return buckets;
}

export function buildTeamContribution(input: {
  creationAudit: CreationAuditRow[];
  editAudit: EditAuditRow[];
  quotations: ContributionQuotation[];
  range: ContributionRange;
  userIds: string[];
}): Record<string, MemberContribution> {
  const { creationAudit, editAudit, quotations, range, userIds } = input;
  const result: Record<string, MemberContribution> = {};
  for (const userId of userIds) {
    result[userId] = {
      approvedOfCreated: 0,
      createdCount: 0,
      createdValue: 0,
      editedCount: 0,
      monthlyData: monthBuckets(range),
      recentCreated: [],
      userId,
    };
  }

  const auditByQuotationId = new Map<string, CreationAuditRow>();
  for (const row of [...creationAudit].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (row.entity_id && !auditByQuotationId.has(row.entity_id)) auditByQuotationId.set(row.entity_id, row);
  }

  const rowsByFolder = new Map<string, ContributionQuotation[]>();
  for (const quotation of quotations) {
    const key = quotationSalesFolderKey(quotation);
    rowsByFolder.set(key, [...(rowsByFolder.get(key) ?? []), quotation]);
  }
  const quotationById = new Map(quotations.map((quotation) => [quotation.id, quotation]));
  const latestByFolder = new Map(
    latestPrimaryQuotationsByFolder(quotations).map((quotation) => [quotationSalesFolderKey(quotation), quotation]),
  );
  const approvedFolders = new Set(actualApprovedQuotationsByFolder(quotations).map(quotationSalesFolderKey));

  const creatorByFolder = new Map<string, string>();
  const createdAtByFolder = new Map<string, string>();
  for (const [folderKey, folderRows] of rowsByFolder) {
    const initial = [...folderRows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id),
    )[0];
    const audit = auditByQuotationId.get(initial.id);
    const creator = initial.created_by ?? audit?.created_by ?? null;
    const createdAt = initial.created_by ? initial.created_at : audit?.created_at ?? null;
    if (creator) creatorByFolder.set(folderKey, creator);
    if (createdAt) createdAtByFolder.set(folderKey, createdAt);
  }

  for (const [folderKey, creator] of creatorByFolder) {
    const member = result[creator];
    const createdAt = createdAtByFolder.get(folderKey);
    const latest = latestByFolder.get(folderKey);
    if (!member || !createdAt || !latest || !inRange(createdAt, range)) continue;
    member.createdCount += 1;
    member.createdValue += latest.grand_total ?? 0;
    const approved = approvedFolders.has(folderKey);
    if (approved) member.approvedOfCreated += 1;
    member.recentCreated.push(latest);
    const created = new Date(createdAt);
    const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
    const bucket = member.monthlyData.find((month) => month.monthKey === monthKey);
    if (bucket) {
      bucket.total += 1;
      bucket.value += latest.grand_total ?? 0;
      if (approved) bucket.approved += 1;
    }
  }
  for (const member of Object.values(result)) {
    member.recentCreated.sort(
      (a, b) =>
        new Date(createdAtByFolder.get(quotationSalesFolderKey(b)) ?? 0).getTime() -
        new Date(createdAtByFolder.get(quotationSalesFolderKey(a)) ?? 0).getTime(),
    );
    member.recentCreated = member.recentCreated.slice(0, 5);
  }

  const editedFolders = new Map<string, Set<string>>();
  for (const row of editAudit) {
    if (!row.created_by || !result[row.created_by] || !isLoggedEdit(row) || !inRange(row.created_at, range)) continue;
    const quotationId = row.entity_type === "quotation" ? row.entity_id : row.parent_entity_id;
    const quotation = quotationId ? quotationById.get(quotationId) : null;
    if (!quotation) continue;
    const folderKey = quotationSalesFolderKey(quotation);
    if (creatorByFolder.get(folderKey) === row.created_by) continue;
    const folders = editedFolders.get(row.created_by) ?? new Set<string>();
    folders.add(folderKey);
    editedFolders.set(row.created_by, folders);
  }
  for (const [userId, folders] of editedFolders) result[userId].editedCount = folders.size;

  return result;
}

/** Everyone with the highest Quotes created count. Ties share it; an all-zero team gets nobody. */
export function mostQuotesCreatedIds(
  members: ReadonlyArray<{ createdCount: number; userId: string }>,
): Set<string> {
  const max = Math.max(0, ...members.map((member) => member.createdCount));
  return new Set(max > 0 ? members.filter((member) => member.createdCount === max).map((member) => member.userId) : []);
}
