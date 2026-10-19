import {
  publicationMetadata,
  withPublication,
  type PublicationAttempt,
} from "./quotation-publication";
import type { LocalQuotationItem, LocalQuotationSection, LocalQuotationWorkspace } from "./quotation-workspace";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Conflict recovery for the Local Builder. The atomic publication RPC stays the only authority:
// nothing here writes to the server or relaxes the workspace_version comparison.

/**
 * Decide what to show when the builder opens.
 * - Clean draft and no pending attempt: nothing local is at risk, so the latest server workspace
 *   (and its verified baseVersion) is adopted. Keeping stale local rows under a fresh baseVersion
 *   would let the next save silently overwrite newer server work.
 * - Dirty draft or pending attempt: the local draft is never replaced. A newer server version is only reported.
 *   A pending attempt is left to the same-attempt retry, because that attempt may already have committed.
 */
export function reconcileOpenedWorkspace(existing: LocalQuotationWorkspace, server: LocalQuotationWorkspace) {
  const local = publicationMetadata(existing);
  if (existing.has_unsaved_changes || local.pending) {
    const serverVersion = publicationMetadata(server).baseVersion;
    return {
      workspace: existing,
      serverNewer: !local.pending && Boolean(serverVersion) && Boolean(local.baseVersion) && serverVersion !== local.baseVersion,
    };
  }
  return { workspace: adoptServerWorkspace(existing, server), serverNewer: false };
}

/** A clean local workspace initialised from a server snapshot; no pending attempt survives. */
export function adoptServerWorkspace(existing: LocalQuotationWorkspace, server: LocalQuotationWorkspace): LocalQuotationWorkspace {
  const serverVersion = publicationMetadata(server).baseVersion;
  return withPublication({
    ...server,
    local_id: existing.local_id,
    has_unsaved_changes: false,
    last_saved_to_software_at: existing.last_saved_to_software_at ?? server.last_saved_to_software_at,
  }, serverVersion ? { baseVersion: serverVersion } : {});
}

/** Load Latest. Refuses a snapshot without a verified baseline instead of inventing one. */
export function loadLatestWorkspace(current: LocalQuotationWorkspace, server: LocalQuotationWorkspace): LocalQuotationWorkspace {
  if (server.server_quotation_id !== current.server_quotation_id) throw new Error("The latest version belongs to a different quotation.");
  if (!publicationMetadata(server).baseVersion) throw new Error("The latest server version could not be verified. Your local draft was kept.");
  return adoptServerWorkspace(current, server);
}

/**
 * A definitive CONFLICT means the RPC found no receipt for this mutation and the baseline is stale forever
 * (versions are random UUIDs), so the attempt can never commit. It is dropped; every local edit is kept.
 */
export function discardRejectedAttempt(workspace: LocalQuotationWorkspace): LocalQuotationWorkspace {
  const { pending, ...rest } = publicationMetadata(workspace);
  void pending;
  return withPublication(workspace, rest);
}

/**
 * Keep My Version. A brand-new attempt (fresh mutation ID) against the freshly fetched server version.
 * The snapshot is the current local workspace, so edits made after an older pending snapshot are included.
 * The server still verifies the version atomically, so a newer concurrent change produces another conflict.
 */
export function beginReplacementPublication(
  workspace: LocalQuotationWorkspace,
  latestVersion: string,
  mutationId: string = crypto.randomUUID(),
): { attempt: PublicationAttempt; pending: LocalQuotationWorkspace } {
  if (!uuid.test(latestVersion)) throw new Error("The latest server version could not be verified. Your local draft was kept.");
  const base = withPublication(workspace, { baseVersion: latestVersion });
  const attempt: PublicationAttempt = { mutationId, baseVersion: latestVersion, snapshot: structuredClone(base) };
  return { attempt, pending: withPublication(base, { baseVersion: latestVersion, pending: attempt }) };
}

export type DifferenceSummary = {
  header: Array<{ label: string; local: string; server: string }>;
  sectionsAdded: string[];
  sectionsRemoved: string[];
  itemsAdded: string[];
  itemsRemoved: string[];
  itemChanges: Array<{ item: string; changes: string[] }>;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : value == null ? "" : String(value));
const money = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "0.00");

function sectionTitle(sections: LocalQuotationSection[], id: string | null | undefined) {
  return text(sections.find((section) => section.id === id)?.section_title) || "(no section)";
}

// Server rows are re-created with new IDs on every publication, so rows are matched by section + code/name,
// in order for duplicates. This is an approximate review aid and is never used to merge.
function keyedItems(workspace: LocalQuotationWorkspace) {
  const seen = new Map<string, number>();
  return new Map(workspace.items.filter((item) => item.is_active !== false).map((item) => {
    const label = text(item.item_name_snapshot) || text(item.item_code_snapshot) || text(item.model_snapshot) || "Item";
    const base = `${sectionTitle(workspace.sections, item.section_id)}|${text(item.item_code_snapshot)}|${label}`.toLowerCase();
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return [`${base}#${count}`, { item, label, section: sectionTitle(workspace.sections, item.section_id) }] as const;
  }));
}

function itemFieldChanges(local: LocalQuotationItem, server: LocalQuotationItem) {
  const changes: string[] = [];
  if (Number(local.qty) !== Number(server.qty)) changes.push(`Quantity ${server.qty} → ${local.qty}`);
  if (money(local.unit_price) !== money(server.unit_price)) changes.push(`Unit price ${money(server.unit_price)} → ${money(local.unit_price)}`);
  if (text(local.discount_type) !== text(server.discount_type) || money(local.discount_value) !== money(server.discount_value)) changes.push("Discount changed");
  if (text(local.specification_snapshot) !== text(server.specification_snapshot)) changes.push("Specification changed");
  if (text(local.finish_snapshot) !== text(server.finish_snapshot)) changes.push("Finish changed");
  return changes;
}

export function summarizeDifferences(local: LocalQuotationWorkspace, server: LocalQuotationWorkspace): DifferenceSummary {
  const header = ([
    ["Title", local.title, server.title],
    ["Status", local.status, server.status],
    ["Currency", local.currency, server.currency],
    ["VAT %", local.vat_percent, server.vat_percent],
    ["Subtotal", money(local.totals.subtotal), money(server.totals.subtotal)],
    ["Grand total", money(local.totals.grand_total), money(server.totals.grand_total)],
  ] as const).filter(([, a, b]) => text(a) !== text(b)).map(([label, a, b]) => ({ label, local: text(a), server: text(b) }));

  const count = (rows: string[]) => rows.reduce((map, row) => map.set(row, (map.get(row) ?? 0) + 1), new Map<string, number>());
  const localSections = count(local.sections.filter((s) => s.is_active !== false).map((s) => text(s.section_title)));
  const serverSections = count(server.sections.filter((s) => s.is_active !== false).map((s) => text(s.section_title)));
  const missing = (from: Map<string, number>, other: Map<string, number>) =>
    [...from].flatMap(([title, n]) => Array.from({ length: Math.max(n - (other.get(title) ?? 0), 0) }, () => title || "(untitled)"));

  const localItems = keyedItems(local);
  const serverItems = keyedItems(server);
  const itemChanges: DifferenceSummary["itemChanges"] = [];
  for (const [key, entry] of localItems) {
    const match = serverItems.get(key);
    const changes = match ? itemFieldChanges(entry.item, match.item) : [];
    if (changes.length) itemChanges.push({ item: `${entry.section}: ${entry.label}`, changes });
  }
  const only = (a: typeof localItems, b: typeof localItems) => [...a].filter(([key]) => !b.has(key)).map(([, e]) => `${e.section}: ${e.label}`);

  return {
    header,
    sectionsAdded: missing(localSections, serverSections),
    sectionsRemoved: missing(serverSections, localSections),
    itemsAdded: only(localItems, serverItems),
    itemsRemoved: only(serverItems, localItems),
    itemChanges,
  };
}

export function hasDifferences(summary: DifferenceSummary) {
  return Boolean(summary.header.length || summary.sectionsAdded.length || summary.sectionsRemoved.length ||
    summary.itemsAdded.length || summary.itemsRemoved.length || summary.itemChanges.length);
}
