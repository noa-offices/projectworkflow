// Pure rules for "one live price list per Supplier source". A new list for the same source REPLACES the existing one; different sources of one
// Brand may each have their own list. The server actions call these rules; the screens only show their messages. No database access here.
export type LiveVersion = { id: string; definition_id: string | null; title: string; filename: string; file_hash?: string; status: string; effective_from: string | null; created_at: string };
export type LiveBatch = { id: string; source_id: string; status: string; completed_at?: string | null };

const isOpen = (status: string) => status === "review" || status === "matching";
const newestFirst = (a: LiveVersion, b: LiveVersion) => (b.effective_from ?? "").localeCompare(a.effective_from ?? "") || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
const applicable = (item: LiveVersion, businessDate: string) => item.status === "imported" && (!item.effective_from || item.effective_from <= businessDate);

export const dayText = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
  : "";
const effectiveText = (value: string | null) => value ? `effective ${dayText(value)}` : "effective immediately";

/** The lists of one Supplier source that are still live: imported and not archived. Newest first (effective date, then import). */
export function liveLists(versions: LiveVersion[], definitionId: string, exceptId = ""): LiveVersion[] {
  return versions.filter((item) => item.definition_id === definitionId && item.status === "imported" && item.id !== exceptId).sort(newestFirst);
}

export type ImportDestination = { kind: "new_list" } | { kind: "replace"; replaces: { id: string; title: string; effectiveFrom: string | null }; message: string };
/**
 * Replace or new list? When the chosen Supplier source already has a live list the import REPLACES it; it is never added as a second list of
 * the same source. The list that is replaced is the current one (by effective date), or the newest one when none is current yet.
 */
export function importDestination(versions: LiveVersion[], definitionId: string | null, businessDate: string): ImportDestination {
  if (!definitionId) return { kind: "new_list" };
  const live = liveLists(versions, definitionId);
  const target = live.find((item) => applicable(item, businessDate)) ?? live[0];
  if (!target) return { kind: "new_list" };
  return { kind: "replace", replaces: { id: target.id, title: target.title, effectiveFrom: target.effective_from }, message: `This will replace ${target.title} (${effectiveText(target.effective_from)}).` };
}

export type ReplacementPlan = { becomesCurrent: boolean; archive: LiveVersion[]; leaveReviews: Array<{ batchId: string; sourceId: string; title: string }>; kept: Array<{ id: string; title: string; reason: string }> };
/**
 * What happens to the older lists of a source when a replacement is imported. Only when the new list is applicable today do the older lists go:
 * they are archived (never deleted) and their unfinished reviews are closed. The list of a completed review is a baseline and stays until the
 * new list's review is completed; a future-dated older list stays pending. An upcoming replacement changes nothing yet.
 */
export function planReplacement(input: { versions: LiveVersion[]; batches: LiveBatch[]; definitionId: string; newList: { id: string; effective_from: string | null; created_at: string }; businessDate: string }): ReplacementPlan {
  const { versions, batches, definitionId, newList, businessDate } = input;
  const others = liveLists(versions, definitionId, newList.id);
  const candidate: LiveVersion = { id: newList.id, definition_id: definitionId, title: "", filename: "", status: "imported", effective_from: newList.effective_from, created_at: newList.created_at };
  const winner = [candidate, ...others].filter((item) => applicable(item, businessDate)).sort(newestFirst)[0];
  const becomesCurrent = winner?.id === newList.id;
  if (!becomesCurrent) return { becomesCurrent, archive: [], leaveReviews: [], kept: others.map((item) => ({ id: item.id, title: item.title, reason: "The new price list is not current yet, so this one stays." })) };
  const archive: LiveVersion[] = [], kept: ReplacementPlan["kept"] = [];
  for (const item of others) {
    if (item.effective_from && item.effective_from > businessDate) kept.push({ id: item.id, title: item.title, reason: "It starts later, so it stays as an upcoming list." });
    else if (batches.some((batch) => batch.source_id === item.id && batch.status === "completed")) kept.push({ id: item.id, title: item.title, reason: "It is the baseline of a completed review. It stays until the new review is completed." });
    else archive.push(item);
  }
  const archiveIds = new Set(archive.map((item) => item.id));
  const leaveReviews = batches.filter((batch) => isOpen(batch.status) && archiveIds.has(batch.source_id)).map((batch) => ({ batchId: batch.id, sourceId: batch.source_id, title: archive.find((item) => item.id === batch.source_id)!.title }));
  return { becomesCurrent, archive, leaveReviews, kept };
}

/** The sentence shown before a replacement: what is archived, which reviews are closed and what is kept. */
export function replacementConfirmText(plan: ReplacementPlan): string[] {
  const lines: string[] = [];
  for (const item of plan.archive) lines.push(`"${item.title}" will be archived. It stays in History and Clean up; nothing is deleted.`);
  if (plan.leaveReviews.length) lines.push(`${plan.leaveReviews.length === 1 ? "Its unfinished review" : `${plan.leaveReviews.length} unfinished reviews`} will be closed.`);
  for (const item of plan.kept) lines.push(`"${item.title}" stays. ${item.reason}`);
  lines.push("Prices already applied and Product history are not changed.");
  return lines;
}

/** One open review per Supplier source: the plain reason a review cannot start because another list of the same source has one open. */
export function openReviewConflict(input: { versions: LiveVersion[]; batches: LiveBatch[]; sourceId: string }): string | null {
  const source = input.versions.find((item) => item.id === input.sourceId);
  if (!source?.definition_id) return null;
  const others = input.versions.filter((item) => item.definition_id === source.definition_id && item.id !== source.id && item.status !== "archived");
  const blocking = others.find((item) => input.batches.some((batch) => batch.source_id === item.id && isOpen(batch.status)));
  return blocking ? `"${blocking.title}" already has an open review for this Supplier source. Leave that review first, or finish it, before starting another.` : null;
}

/** Linking a new list to a Supplier source that already has a live list is a replacement and must be confirmed. */
export function linkNeedsReplacement(input: { versions: LiveVersion[]; source: { id: string; definition_id: string | null }; definitionId: string | null }): ImportDestination {
  if (!input.definitionId || input.source.definition_id === input.definitionId) return { kind: "new_list" };
  const live = liveLists(input.versions, input.definitionId, input.source.id);
  const target = live[0];
  return target ? { kind: "replace", replaces: { id: target.id, title: target.title, effectiveFrom: target.effective_from }, message: `This will replace ${target.title} (${effectiveText(target.effective_from)}).` } : { kind: "new_list" };
}

export type FileCheck = { exact: { title: string; date: string; message: string } | null; sameName: { date: string; message: string } | null };
/** Same file or same name? Only an exact content match (hash) blocks; a same name with different content is a plain warning. */
export function checkImportFile(input: { versions: LiveVersion[]; fileHash: string; fileName: string }): FileCheck {
  const imported = input.versions.filter((item) => item.status === "imported");
  const exact = imported.filter((item) => item.file_hash === input.fileHash).sort(newestFirst)[0];
  const sameName = imported.filter((item) => item.file_hash !== input.fileHash && item.filename.toLowerCase() === input.fileName.toLowerCase()).sort(newestFirst)[0];
  return {
    exact: exact ? { title: exact.title, date: exact.created_at.slice(0, 10), message: `This exact file was already imported on ${dayText(exact.created_at)}.` } : null,
    sameName: sameName ? { date: sameName.created_at.slice(0, 10), message: `A file with this name was imported on ${dayText(sameName.created_at)}, but its content is different.` } : null,
  };
}

/** "INTERSTUHL price view, effective 2 Jan 2026": the file name and the effective date. Null without a file name. */
export function defaultListTitle(fileName: string | null | undefined, effectiveFrom: string | null | undefined): string | null {
  const base = (fileName ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return null;
  return effectiveFrom ? `${base}, effective ${dayText(effectiveFrom)}` : base;
}

export type CardCandidate = { sourceId: string; definitionId?: string | null; priceListState?: string; effectiveFrom?: string | null; createdAt?: string };
/**
 * One card per Supplier source: the list in progress, otherwise the current list. A pending (upcoming) replacement keeps its own card, one per source.
 * Lists with no Supplier source are not grouped. The count of hidden older lists is returned so the screen can link to History and Clean up.
 */
export function selectLiveCards<T extends CardCandidate>(cards: T[]): { shown: T[]; hidden: Map<string, number> } {
  const order = (a: T, b: T) => (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? "") || (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.sourceId.localeCompare(a.sourceId);
  const shown: T[] = [], hidden = new Map<string, number>();
  const byDefinition = new Map<string, T[]>();
  for (const card of cards) {
    if (!card.definitionId) { shown.push(card); continue; }
    byDefinition.set(card.definitionId, [...(byDefinition.get(card.definitionId) ?? []), card]);
  }
  for (const [definitionId, list] of byDefinition) {
    const upcoming = list.filter((card) => card.priceListState === "upcoming").sort(order);
    const rest = list.filter((card) => card.priceListState !== "upcoming");
    const primary = rest.filter((card) => card.priceListState === "update_in_progress").sort(order)[0] ?? rest.filter((card) => card.priceListState === "current" || card.priceListState === undefined).sort(order)[0] ?? rest.sort(order)[0];
    const keep = [...(primary ? [primary] : []), ...(upcoming[0] ? [upcoming[0]] : [])];
    shown.push(...keep);
    const count = list.length - keep.length;
    if (count > 0) hidden.set(definitionId, count);
  }
  return { shown, hidden };
}
export const previousListsLine = (count: number) => `${count} previous ${count === 1 ? "list" : "lists"}`;
