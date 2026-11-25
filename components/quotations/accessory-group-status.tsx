"use client";

/** What accessory group headers, the summary and the blocked-Add note say. Display only: no rule lives here. */

export type AccessoryGroupState = { required: boolean; chooseOne: boolean; selectedCount: number };

/** Only required groups get a badge. "Choose 1" is used when the saved selection mode is exactly one. */
export function accessoryGroupBadge({ required, chooseOne, selectedCount }: AccessoryGroupState) {
  if (!required) return null;
  const satisfied = chooseOne ? selectedCount === 1 : selectedCount > 0;
  return { satisfied, text: satisfied ? "Required chosen" : chooseOne ? "Choose 1" : "Required" };
}

export function requiredGroupsSummary(groups: readonly AccessoryGroupState[]) {
  const required = groups.flatMap((group) => accessoryGroupBadge(group) ?? []);
  return required.length ? `Required: ${required.filter((badge) => badge.satisfied).length} of ${required.length} groups chosen` : null;
}

export function AccessoryGroupCounts({ itemCount, ...state }: AccessoryGroupState & { itemCount: number }) {
  const badge = accessoryGroupBadge(state);
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 text-[10px] font-medium text-zinc-500">
      <span>{itemCount} {itemCount === 1 ? "item" : "items"} · {state.selectedCount} selected</span>
      {badge ? <span className={`rounded border px-1.5 py-0.5 font-semibold ${badge.satisfied ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>{badge.satisfied ? <span aria-hidden="true">✓ </span> : null}{badge.text}</span> : null}
    </span>
  );
}

export function AccessoryGroupsToolbar({ groups, allExpanded, onSetAll }: { groups: readonly AccessoryGroupState[]; allExpanded: boolean; onSetAll: (expanded: boolean) => void }) {
  const summary = requiredGroupsSummary(groups);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p aria-live="polite" className="min-w-0 text-xs font-semibold text-zinc-700">{summary}</p>
      <button type="button" onClick={() => onSetAll(!allExpanded)} className="ml-auto text-[11px] font-semibold text-emerald-900 hover:text-emerald-700">{allExpanded ? "Collapse all" : "Expand all"}</button>
    </div>
  );
}

type Blocking = { code: string; groupId: string; message: string };

/** Names the group behind each existing blocking requirement. */
export function accessoryBlockedEntries(blocking: readonly Blocking[], groups: ReadonlyArray<{ id?: string; group_name?: string }>, evaluations: ReadonlyArray<{ groupId: string; maxSelections: number | null }>) {
  return blocking.map(({ code, groupId, message }) => {
    const name = groups.find((group) => group.id === groupId)?.group_name;
    if (!name) return { groupId, text: message };
    if (code !== "required_selection_missing") return { groupId, text: `"${name}": ${message}` };
    const chooseOne = evaluations.find((entry) => entry.groupId === groupId)?.maxSelections === 1;
    return { groupId, text: chooseOne ? `Choose 1 item in "${name}".` : `Choose at least one item in "${name}".` };
  });
}

export function AccessoryBlockedList({ entries, onOpen }: { entries: ReadonlyArray<{ groupId: string; text: string }>; onOpen: (groupId: string) => void }) {
  if (!entries.length) return null;
  return (
    <ul className="space-y-1">
      {entries.map((entry) => (
        <li key={entry.groupId}>
          <button type="button" onClick={() => onOpen(entry.groupId)} className="text-left text-xs font-semibold leading-5 text-amber-800 underline hover:text-amber-950">{entry.text}</button>
        </li>
      ))}
    </ul>
  );
}

/** Scrolls an accessory group into view and focuses its header. False when the group is not on screen. */
export function revealAccessoryGroup(root: ParentNode, groupId: string) {
  const target = Array.from(root.querySelectorAll("[data-accessory-group]")).find((element) => element.getAttribute("data-accessory-group") === groupId);
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  target.querySelector<HTMLElement>("button[aria-expanded]")?.focus({ preventScroll: true });
  return true;
}
