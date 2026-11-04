// Pure rules for the Supplier Sources "Clean up" tab: which old price lists, stale reviews and unused definitions to show, why a list is
// protected, and the wording. No database access here: the loader reads the rows and the existing safety check (supplier_previous_source_state);
// the delete re-checks every guard on the server.
export type CleanupVersion = { id: string; definition_id: string | null; title: string; filename: string; status: string; effective_from: string | null; created_at: string; stored_rows: number };
export type CleanupBatch = { id: string; source_id: string; status: string; completed_at?: string | null };
export type CleanupDefinition = { id: string; name: string; isActive: boolean; canDelete: boolean; familyCount: number };
/** One verdict of the existing safety check for an older price list. */
export type CleanupVerdict = { source_id: string; current_source_id: string; batches: number; protected_reviews: string[]; reasons: string[]; safe_to_delete: boolean; rows: number };

export type CleanupOldList = {
  id: string; title: string; filename: string; importedOn: string; lines: number; currentSourceId: string | null;
  removable: boolean; /** The plain reason it is safe, or the plain reason it is protected. */ reason: string; openReviews: number; archived: boolean;
};
export type CleanupStaleReview = { batchId: string; sourceId: string; title: string; filename: string; statusLabel: string };
export type CleanupUnusedDefinition = { id: string; name: string; removable: boolean };
export type SupplierCleanup = { oldLists: CleanupOldList[]; staleReviews: CleanupStaleReview[]; unusedDefinitions: CleanupUnusedDefinition[] };

const isOpen = (status: string) => status === "review" || status === "matching";
const group = (version: { definition_id: string | null }) => version.definition_id ?? "";

/** Same rule as the applicable-version resolver: imported, effective by today, latest effective date, then the newest import. */
function applicableCurrent(versions: CleanupVersion[], businessDate: string): CleanupVersion | null {
  return [...versions.filter((item) => item.status === "imported" && (!item.effective_from || item.effective_from <= businessDate))]
    .sort((a, b) => (b.effective_from ?? "").localeCompare(a.effective_from ?? "") || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] ?? null;
}

/** The current price list of each Supplier source (and of the lists that belong to none): the newest applicable one. Keyed by definition id ("" = none). */
export function cleanupCurrentSources(versions: CleanupVersion[], businessDate: string): Map<string, CleanupVersion> {
  const result = new Map<string, CleanupVersion>();
  for (const key of new Set(versions.map(group))) {
    const current = applicableCurrent(versions.filter((item) => group(item) === key), businessDate);
    if (current) result.set(key, current);
  }
  return result;
}

const PROTECTED_REVIEW: Record<string, string> = {
  KEEP_PROTECTED_COMPLETED: "it is used in completed price history",
  KEEP_PROTECTED_APPLIED: "prices from its review are in Product history",
  KEEP_PROTECTED_DECISIONS: "its review has saved decisions",
  KEEP_IN_PROGRESS: "a review of it is still matching",
  KEEP_SOURCE_PROTECTED: "its import is not finished",
  MISSING: "its review could not be found",
};
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1) + (text.endsWith(".") ? "" : ".");

/** The plain reason a list is protected, built from the database check. */
export function protectedReason(verdict: Pick<CleanupVerdict, "reasons" | "protected_reviews">): string {
  const parts: string[] = [];
  for (const reason of verdict.reasons) {
    if (/review history that must be retained/i.test(reason)) {
      const why = [...new Set(verdict.protected_reviews.map((code) => PROTECTED_REVIEW[code] ?? "it holds review history"))];
      parts.push(`Protected: ${why.length ? why.join("; ") : "it holds review history"}.`);
    } else if (/not an older version/i.test(reason)) parts.push("It is not older than the current price list.");
    else if (/not a version of the same supplier source/i.test(reason)) parts.push("It does not belong to the same Supplier source as the current price list.");
    else if (/new price list is not fully imported/i.test(reason)) parts.push("The current price list is not fully imported yet.");
    else if (/previous import is not finished/i.test(reason)) parts.push("Its import is not finished.");
    else parts.push(sentence(reason));
  }
  return parts.join(" ") || "Protected by the database check.";
}
export const SAFE_REASON = "Safe to delete: no completed review, no applied prices and no saved review decisions.";
const NO_SOURCE_REASON = "It is not linked to a Supplier source, so it cannot be checked here. Archive it on the History tab and delete it there.";
const NO_CURRENT_REASON = "There is no current price list to compare it with.";

const dateOnly = (value: string) => value.slice(0, 10);

/**
 * Builds the three lists. `verdicts` maps the current list's id to the database check of its older versions. The current list never
 * appears as removable: it is skipped here, and a list is removable only when the database check says so.
 */
export function buildSupplierCleanup(input: { versions: CleanupVersion[]; batches: CleanupBatch[]; definitions: CleanupDefinition[]; verdicts: Map<string, CleanupVerdict[]>; businessDate: string }): SupplierCleanup {
  const { versions, batches, definitions, verdicts, businessDate } = input;
  const currentBySource = cleanupCurrentSources(versions, businessDate);
  const currentIds = new Set([...currentBySource.values()].map((item) => item.id));
  // The price list of a completed review is a baseline: it is never offered for removal, even when a newer list exists.
  const protectedBaselines = new Set(versions.filter((item) => !currentIds.has(item.id) && batches.some((batch) => batch.source_id === item.id && batch.status === "completed")).map((item) => item.id));
  for (const id of protectedBaselines) currentIds.add(id);
  const verdictFor = new Map<string, CleanupVerdict>();
  for (const list of verdicts.values()) for (const verdict of list) verdictFor.set(verdict.source_id, verdict);

  const oldLists: CleanupOldList[] = [];
  for (const item of versions) {
    if (currentBySource.get(group(item))?.id === item.id) continue; // the current list is never offered
    if (!["imported", "archived"].includes(item.status)) continue; // unfinished imports are handled by the import recovery
    if (item.status === "imported" && item.effective_from && item.effective_from > businessDate) continue; // upcoming, not old
    const current = currentBySource.get(group(item));
    const openReviews = batches.filter((batch) => batch.source_id === item.id && isOpen(batch.status)).length;
    const base = { id: item.id, title: item.title, filename: item.filename, importedOn: dateOnly(item.created_at), openReviews, archived: item.status === "archived" };
    const verdict = verdictFor.get(item.id);
    if (!item.definition_id) oldLists.push({ ...base, lines: item.stored_rows, currentSourceId: null, removable: false, reason: NO_SOURCE_REASON });
    else if (!current) oldLists.push({ ...base, lines: item.stored_rows, currentSourceId: null, removable: false, reason: NO_CURRENT_REASON });
    else if (protectedBaselines.has(item.id)) oldLists.push({ ...base, lines: verdict?.rows ?? item.stored_rows, currentSourceId: current.id, removable: false, reason: "Protected: it is the price list of a completed review." });
    else if (!verdict) oldLists.push({ ...base, lines: item.stored_rows, currentSourceId: current.id, removable: false, reason: "It is not older than the current price list." });
    else oldLists.push({ ...base, lines: verdict.rows, currentSourceId: current.id, removable: verdict.safe_to_delete && !currentIds.has(item.id), reason: verdict.safe_to_delete ? `${SAFE_REASON}${openReviews ? ` Its open ${openReviews === 1 ? "review is" : "reviews are"} deleted with it.` : ""}` : protectedReason(verdict) });
  }
  oldLists.sort((a, b) => Number(b.removable) - Number(a.removable) || a.importedOn.localeCompare(b.importedOn) || a.id.localeCompare(b.id));

  const byId = new Map(versions.map((item) => [item.id, item]));
  const staleReviews: CleanupStaleReview[] = batches
    .filter((batch) => isOpen(batch.status) && byId.has(batch.source_id) && !currentIds.has(batch.source_id))
    .map((batch) => ({ batchId: batch.id, sourceId: batch.source_id, title: byId.get(batch.source_id)!.title, filename: byId.get(batch.source_id)!.filename, statusLabel: batch.status === "matching" ? "Matching" : "Open" }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.batchId.localeCompare(b.batchId));

  // Unused: no price list and no products. Whether it can be deleted is decided again by the database.
  const unusedDefinitions = definitions.filter((item) => item.canDelete && item.familyCount === 0).map((item) => ({ id: item.id, name: item.name, removable: true })).sort((a, b) => a.name.localeCompare(b.name));
  return { oldLists, staleReviews, unusedDefinitions };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "2 old lists, 1 stale review, 2 unused definitions can be cleaned up" or "Nothing to clean up". Only removable old lists are counted. */
export function cleanupSummary(cleanup: SupplierCleanup): string {
  const parts = [
    cleanup.oldLists.filter((item) => item.removable).length ? count(cleanup.oldLists.filter((item) => item.removable).length, "old list", "old lists") : "",
    cleanup.staleReviews.length ? count(cleanup.staleReviews.length, "stale review", "stale reviews") : "",
    cleanup.unusedDefinitions.length ? count(cleanup.unusedDefinitions.length, "unused definition", "unused definitions") : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")} can be cleaned up` : "Nothing to clean up";
}

const lineText = (n: number) => count(n, "line", "lines");
/** What the confirm dialog says for deleting one old price list: exactly what goes, and what stays. */
export function deleteListDialog(item: Pick<CleanupOldList, "title" | "filename" | "importedOn" | "lines" | "openReviews">) {
  return {
    title: `Delete the old price list "${item.title}"?`,
    removes: [`The price list "${item.title}" (${item.filename}), imported on ${item.importedOn}`, `Its ${lineText(item.lines)} and the items read from them`, ...(item.openReviews ? [`Its ${count(item.openReviews, "open review", "open reviews")}`] : [])],
    keeps: ["Prices already applied to products", "Product price history", "The current price list", "The original file in storage"],
  };
}
export function leaveReviewDialog(item: Pick<CleanupStaleReview, "title">) {
  return { title: `Leave the review of "${item.title}"?`, removes: ["The unfinished review work on this old price list"], keeps: ["Prices already applied to products", "Product price history", "The price list itself", "The current price list and its review"] };
}
export function deleteDefinitionDialog(item: Pick<CleanupUnusedDefinition, "name">) {
  return { title: `Delete the unused definition "${item.name}"?`, removes: [`The Supplier source definition "${item.name}"`], keeps: ["All price lists, reviews and Product history", "Products and their prices"] };
}

export const deletedListMessage = (deleted: Record<string, number> | undefined) => {
  const lines = deleted?.supplier_source_rows ?? 0;
  return `Deleted 1 old price list. ${lines.toLocaleString("en-US")} ${lines === 1 ? "line" : "lines"} removed.`;
};
export const leftReviewMessage = "Left 1 stale review. Applied prices and Product history are unchanged.";
export const deletedDefinitionMessage = (name: string) => `Deleted the unused definition "${name}".`;
