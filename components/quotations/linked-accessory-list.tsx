"use client";

import { useId, useState, type ComponentType, type ReactNode } from "react";

import {
  buildLinkedAccessoryView,
  linkedAccessoryDetails,
  linkedAccessoryId,
  linkedAccessoryName,
  linkedAccessorySummary,
  toggledLinkedAccessoryQuantity,
  typedLinkedAccessoryQuantity,
  type LinkedAccessorySelectedRow,
  type LinkedAccessoryViewGroup,
  type LinkedAccessoryViewItem,
} from "./linked-accessory-view";
import { AccessoryGroupsToolbar } from "./accessory-group-status";

type GroupHeaderProps = { expanded: boolean; groupName: string; itemCount: number; required: boolean; chooseOne: boolean; selectedCount: number; onToggle: () => void };

export function LinkedAccessoryRow({ id, name, details, detailsId, detailsOpen, onToggleDetails, price, quantity, onQuantityChange }: {
  id: string;
  name: string;
  details: string[];
  detailsId: string;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  price: ReactNode;
  quantity: number;
  onQuantityChange: (id: string, quantity: number) => void;
}) {
  return (
    <div className="text-xs text-zinc-700">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="flex min-w-0 flex-1 basis-40 items-start gap-2">
          <input type="checkbox" checked={quantity > 0} onChange={(event) => onQuantityChange(id, toggledLinkedAccessoryQuantity(event.target.checked, quantity))} className="h-4 w-4 shrink-0 rounded border-zinc-300" />
          <span className="min-w-0 break-words font-medium text-zinc-900">{name}</span>
        </label>
        {details.length ? <button type="button" aria-expanded={detailsOpen} aria-controls={detailsOpen ? detailsId : undefined} aria-label={`Details for ${name}`} onClick={onToggleDetails} className="shrink-0 text-[11px] font-semibold text-emerald-900 hover:text-emerald-700">{detailsOpen ? "Hide details" : "Details"}</button> : null}
        {quantity > 0 ? <input type="number" min={1} step={1} aria-label={`Quantity for ${name}`} value={quantity} onChange={(event) => onQuantityChange(id, typedLinkedAccessoryQuantity(event.target.value))} className="h-8 w-16 shrink-0 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" /> : null}
        <span className="ml-auto shrink-0 text-right font-semibold">{price}</span>
      </div>
      {details.length && detailsOpen ? <div id={detailsId} className="mt-1 space-y-1 break-words pl-6 text-[11px] leading-4 text-zinc-500">{details.map((text, index) => <p key={index}>{text}</p>)}</div> : null}
    </div>
  );
}

export function LinkedAccessoryList<Item extends LinkedAccessoryViewItem>({ title, groups, quantities, selectedRow, ownRowIds, priceLabel, GroupHeader, onQuantityChange }: {
  title: string;
  groups: Array<LinkedAccessoryViewGroup<Item>>;
  quantities: Record<string, number>;
  selectedRow: LinkedAccessorySelectedRow;
  ownRowIds: readonly string[];
  priceLabel: (item: Item) => ReactNode;
  /** The same collapsed-group header the standalone product page uses. */
  GroupHeader: ComponentType<GroupHeaderProps>;
  onQuantityChange: (id: string, quantity: number) => void;
}) {
  const baseId = useId();
  const [showAll, setShowAll] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});
  const view = buildLinkedAccessoryView<Item, LinkedAccessoryViewGroup<Item>>({ groups, quantities, selectedRow, ownRowIds, showAll });

  return (
    <div className="min-w-0 space-y-2">
      <p className="break-words text-xs font-bold uppercase tracking-wide text-zinc-700">{title}</p>
      <AccessoryGroupsToolbar groups={view.groups} allExpanded={view.groups.every(({ group }) => expandedGroups[group.id])} onSetAll={(expanded) => setExpandedGroups(Object.fromEntries(view.groups.map(({ group }) => [group.id, expanded])))} />
      <p aria-live="polite" className="break-words text-xs text-zinc-600">{linkedAccessorySummary(view.selected)}</p>
      {view.hiddenCount ? (
        <p className="text-[11px] text-zinc-500">
          {showAll ? "Showing all items." : `${view.hiddenCount} ${view.hiddenCount === 1 ? "item" : "items"} for other models hidden.`}
          <button type="button" aria-pressed={showAll} onClick={() => setShowAll((current) => !current)} className="ml-2 font-semibold text-emerald-900 hover:text-emerald-700">Show all</button>
        </p>
      ) : null}
      {view.groups.map(({ group, items, selectedCount, required, chooseOne }) => {
        const expanded = expandedGroups[group.id] ?? false;
        return (
          <fieldset key={group.id} aria-label={group.group_name} className="min-w-0 border border-zinc-200 bg-white p-2">
            <GroupHeader expanded={expanded} groupName={group.group_name} itemCount={items.length} required={required} chooseOne={chooseOne} selectedCount={selectedCount} onToggle={() => setExpandedGroups((current) => ({ ...current, [group.id]: !expanded }))} />
            {expanded ? (
              <div className="mt-2 space-y-2">
                {items.map((item, index) => {
                  const id = linkedAccessoryId(item);
                  const detailsKey = `${group.id}:${id}`;
                  return <LinkedAccessoryRow key={id} id={id} name={linkedAccessoryName(item)} details={linkedAccessoryDetails(item)} detailsId={`${baseId}-${group.id}-${index}`} detailsOpen={Boolean(openDetails[detailsKey])} onToggleDetails={() => setOpenDetails((current) => ({ ...current, [detailsKey]: !current[detailsKey] }))} price={priceLabel(item)} quantity={quantities[id] ?? 0} onQuantityChange={onQuantityChange} />;
                })}
              </div>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}
