"use client";

import { useRef, useState, type ReactNode } from "react";
import type { AccessoryGroupEvaluation } from "@/lib/products/accessory-conditional-configuration";
import { effectiveLinkedAccessoryQuantity, evaluateLinkedAccessories, linkedFixedItemIds } from "@/lib/products/linked-accessory-rules";
import { AccessoryBlockedList, accessoryBlockedEntries, AccessoryGroupsToolbar, revealAccessoryGroup } from "./accessory-group-status";

type Group = Parameters<typeof evaluateLinkedAccessories>[0]["groups"][number] & { group_is_required?: boolean };

/** What the standalone accessory section (AccessoryConfigurationFields) needs; passed in so this file stays small. */
export type LinkedAccessoryFieldsProps = {
  evaluations: AccessoryGroupEvaluation[];
  quantities: Record<string, number>;
  categories: Record<string, string>;
  onCategoryChange: (itemId: string, categoryId: string) => void;
  ordinaryOptionGroupIds: ReadonlySet<string>;
  lockedItemIds: ReadonlySet<string>;
  isGroupExpanded: (groupId: string, defaultExpanded: boolean) => boolean;
  onGroupExpandedChange: (groupId: string, expanded: boolean) => void;
  onQuantityChange: (groupItemIds: string[], itemId: string, quantity: number, replaceGroup: boolean) => void;
};

/** The same pick rule as the standalone onQuantityChange, without required overrides (locked items ignore changes). */
export function nextLinkedQuantities(current: Record<string, number>, lockedItemIds: ReadonlySet<string>, groupItemIds: string[], itemId: string, quantity: number, replaceGroup: boolean) {
  if (!replaceGroup && lockedItemIds.has(itemId)) return current;
  const next = { ...current };
  if (replaceGroup) groupItemIds.forEach((id) => { delete next[id]; });
  if (itemId) {
    if (quantity > 0) next[itemId] = quantity;
    else delete next[itemId];
  }
  return next;
}

export function LinkedAccessoryPopup<G extends Group>({ title, groups, row, savedQuantities, savedCategories, instanceQuantity = 1, perScreenFixedQuantities, money, renderFields, onApply, onClose }: {
  title: string;
  groups: G[];
  row: Parameters<typeof evaluateLinkedAccessories>[0]["row"];
  /** The linked selection's stored accessoryQuantities. Only copied; the popup never writes them until Apply. */
  savedQuantities: Record<string, number>;
  savedCategories?: Record<string, string>;
  instanceQuantity?: number;
  perScreenFixedQuantities?: true;
  money: (amount: number) => string;
  renderFields: (props: LinkedAccessoryFieldsProps) => ReactNode;
  onApply: (accessoryQuantities: Record<string, number>, categories: Record<string, string>, perScreenFixedQuantities: true) => void;
  onClose: () => void;
}) {
  // Starts from what the rules allow for the chosen row: hidden items are dropped and required items added (shown, not saved).
  const [draft, setDraft] = useState(() => evaluateLinkedAccessories({ groups, row, quantities: savedQuantities }).savedQuantities);
  const [categories, setCategories] = useState(() => ({ ...savedCategories }));
  const dropped = Object.keys(savedQuantities).filter((id) => (savedQuantities[id] ?? 0) > 0 && !(id in evaluateLinkedAccessories({ groups, row, quantities: savedQuantities }).savedQuantities));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const result = evaluateLinkedAccessories({ groups, row, quantities: draft, categories });
  const evaluations = result.configuration.groups.filter((evaluation) => !groups.some((group) => group.id === evaluation.groupId && !result.ordinaryOptionGroupIds.has(group.id) && group.conditional_configuration?.applicability.some((rule) => rule.target?.kind === "option_item")));
  const states = evaluations.filter((evaluation) => evaluation.visible).map((evaluation) => ({ id: evaluation.groupId, required: evaluation.required, chooseOne: evaluation.maxSelections === 1, selectedCount: evaluation.selectedItemIds.length }));
  const fixedItemIds = linkedFixedItemIds(result.configuration.groups);
  const fixedLines = instanceQuantity !== 1
    ? result.priceLines.filter(({ accessory }) => accessory.id && fixedItemIds.has(accessory.id))
    : [];
  const total = result.priceLines.reduce((sum, line) => {
    const isFixed = perScreenFixedQuantities === true && fixedItemIds.has(line.accessory.id ?? "");
    return sum + effectiveLinkedAccessoryQuantity(line.qty, isFixed, instanceQuantity) * line.unitPrice;
  }, 0);
  const open = (groupId: string) => {
    setExpanded((current) => ({ ...current, [groupId]: true }));
    // after the group has opened
    window.setTimeout(() => { if (dialogRef.current) revealAccessoryGroup(dialogRef.current, groupId); }, 0);
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Edit accessories: ${title}`} className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/50 p-3 sm:p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4">
          <div className="min-w-0"><h3 className="break-words font-semibold">Edit accessories: {title}</h3><p className="text-xs text-zinc-500">The same rules as the product page. Nothing changes until you press Apply.</p></div>
          <button type="button" onClick={onClose} className="shrink-0 text-sm font-medium">Cancel</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {states.length ? <AccessoryGroupsToolbar groups={states} allExpanded={states.every((state) => expanded[state.id])} onSetAll={(value) => setExpanded(Object.fromEntries(states.map((state) => [state.id, value])))} /> : <p className="text-xs text-zinc-600">No accessories apply to the chosen model.</p>}
          {renderFields({
            evaluations,
            quantities: draft,
            categories,
            onCategoryChange: (id, category) => setCategories((current) => ({ ...current, [id]: category })),
            ordinaryOptionGroupIds: result.ordinaryOptionGroupIds,
            lockedItemIds: result.lockedItemIds,
            isGroupExpanded: (groupId) => expanded[groupId] ?? false,
            onGroupExpandedChange: (groupId, value) => setExpanded((current) => ({ ...current, [groupId]: value })),
            onQuantityChange: (groupItemIds, itemId, quantity, replaceGroup) => setDraft((current) => nextLinkedQuantities(current, result.lockedItemIds, groupItemIds, itemId, quantity, replaceGroup)),
          })}
        </div>
        <div className="space-y-2 border-t border-zinc-200 p-4">
          <p className="text-xs font-semibold text-zinc-800">Accessories: {money(total)}</p>
          {fixedLines.map(({ accessory, qty }) => (
            <p key={accessory.id} className="text-xs text-zinc-600">
              {!perScreenFixedQuantities ? "On Apply: " : ""}{accessory.item_name}: {qty} per screen x {instanceQuantity} screens = {effectiveLinkedAccessoryQuantity(qty, true, instanceQuantity)}
            </p>
          ))}
          {dropped.length ? <p className="text-xs text-amber-700">{dropped.length} saved item{dropped.length === 1 ? " does" : "s do"} not apply to the chosen model and will be removed on Apply.</p> : null}
          {result.missingModel ? <p className="text-xs text-amber-700">Choose a model or variant first.</p> : null}
          <AccessoryBlockedList entries={accessoryBlockedEntries(result.configuration.blockingRequirements, groups, result.configuration.groups)} onOpen={open} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Cancel</button>
            <button type="button" disabled={result.blocked} onClick={() => onApply(result.savedQuantities, result.savedCategories, true)} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}
