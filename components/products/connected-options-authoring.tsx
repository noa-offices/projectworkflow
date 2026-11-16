"use client";

import React, { useEffect, useId, useState } from "react";
import type { ProductTemplateDraft } from "@/lib/products/product-template-draft";
import type { SmartReviewAccessoryConfiguration, SmartReviewRoute, SmartSetupReviewRoutingPlan } from "@/lib/products/smart-product-review-routing";
import {
  connectedOptionChoices, connectedOptionIssues, connectedOptionKey, connectedOptionQuantityIssue,
  connectedOptionSettings, rebuildConnectedOptionRules, setConnectedOptionSettings, type ConnectedOptionChoice,
} from "@/lib/products/smart-product-connected-options";

const button = "rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50";

export function ConnectedOptionQuantityNotice({ accessory, onUseAtLeastOne }: { accessory: SmartReviewAccessoryConfiguration; onUseAtLeastOne: () => void }) {
  const issue = connectedOptionQuantityIssue(accessory.selection, accessory.rules);
  if (!issue) return null;
  const exactlyOne = accessory.selection === "required_exactly_one" || accessory.selection === "optional_exactly_one";
  return <div role="alert" className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
    <p>{issue}</p>{exactlyOne ? <button type="button" className={`${button} mt-2`} onClick={onUseAtLeastOne}>Use At least one</button> : null}
  </div>;
}

export function ConnectedOptionsPicker({ choices, pending, search, onSearch, onPending, onCancel, onSave }: {
  choices: ConnectedOptionChoice[]; pending: Set<string>; search: string;
  onSearch: (search: string) => void; onPending: (keys: Set<string>) => void; onCancel: () => void; onSave: () => void;
}) {
  const query = search.trim().toLowerCase();
  const shown = choices.filter((choice) => `${choice.groupName} ${choice.label} ${choice.code}`.toLowerCase().includes(query));
  const groups = [...new Map(shown.map((choice) => [choice.target.group_id, choice.groupName]))];
  const toggle = (keys: string[], selected: boolean) => {
    const next = new Set(pending);
    keys.forEach((key) => { if (selected) next.add(key); else next.delete(key); });
    onPending(next);
  };
  return <div role="dialog" aria-modal="true" aria-label="Choose connected options" className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white p-4 shadow-xl">
      <h3 className="font-semibold">Choose options</h3>
      <input type="search" autoFocus aria-label="Search options" placeholder="Search option name or supplier code" value={search} onChange={(event) => onSearch(event.target.value)} className="mt-3 h-8 rounded-md border border-zinc-300 px-2 text-xs" />
      {query ? <p className="mt-1 text-xs text-zinc-500">Group checkboxes select the shown items. Hidden selections are kept.</p> : null}
      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto border-y border-zinc-100 py-2">
        {!shown.length ? <p className="p-2 text-xs text-zinc-500">No options match your search.</p> : null}
        {groups.map(([groupId, name]) => {
          const items = shown.filter((choice) => choice.target.group_id === groupId);
          const eligible = items.filter((choice) => !choice.disabledReason);
          return <fieldset key={groupId} className="rounded border border-zinc-200 p-2">
            <legend className="px-1 text-xs font-semibold">{name}</legend>
            <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" aria-label={`Select all in ${name}`} disabled={!eligible.length} checked={eligible.length > 0 && eligible.every((choice) => pending.has(choice.key))} onChange={(event) => toggle(eligible.map((choice) => choice.key), event.target.checked)} />Select all in this group</label>
            {items.map((choice) => <label key={choice.key} className={`flex items-start gap-2 rounded p-2 text-sm ${choice.disabledReason ? "text-zinc-400" : "cursor-pointer hover:bg-zinc-50"}`}>
              <input type="checkbox" disabled={Boolean(choice.disabledReason)} checked={pending.has(choice.key)} onChange={(event) => toggle([choice.key], event.target.checked)} />
              <span>{choice.label}{choice.code ? <span className="ml-2 text-xs">{choice.code}</span> : null}{choice.disabledReason ? <span className="block text-xs">{choice.disabledReason}</span> : null}</span>
            </label>)}
          </fieldset>;
        })}
      </div>
      <div className="mt-4 flex justify-end gap-2"><button type="button" className={button} onClick={onCancel}>Cancel</button><button type="button" onClick={onSave} className="rounded bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Save</button></div>
    </div>
  </div>;
}

export function ConnectedOptionsAuthoring({ draft, plan, route, onRouteChange }: {
  draft: ProductTemplateDraft; plan: SmartSetupReviewRoutingPlan; route: SmartReviewRoute; onRouteChange: (update: (route: SmartReviewRoute) => SmartReviewRoute) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(new Set<string>());
  const [search, setSearch] = useState("");
  const id = useId();
  const accessory = route.accessory!;
  const choices = connectedOptionChoices(draft, plan, route.sourceId);
  const rules = accessory.rules.filter((rule) => rule.target?.kind === "option_item");
  const groups = [...new Set(rules.map((rule) => rule.target!.group_id))];
  const settings = connectedOptionSettings(accessory);
  const issues = connectedOptionIssues(draft, plan, route);
  const quantityIssue = connectedOptionQuantityIssue(accessory.selection, accessory.rules);
  const update = (patch: Partial<typeof settings>) => onRouteChange((current) => ({ ...current, accessory: setConnectedOptionSettings(current.accessory!, { ...connectedOptionSettings(current.accessory!), ...patch }) }));
  const useAtLeastOne = () => onRouteChange((current) => ({ ...current, accessory: { ...current.accessory!, selection: "required_at_least_one" } }));
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  return <section className="mt-3 rounded-lg border border-zinc-200 bg-white p-3" aria-label="Connected options">
    <h3 className="text-xs font-semibold text-zinc-900">Connected options</h3>
    <p className="mt-1 text-xs text-zinc-600">Use this when this item is needed because another option is selected. Example: a Stirrup Kit for a Modesty Panel.</p>
    <button type="button" className={`${button} mt-3`} onClick={() => { setPending(new Set(rules.map(connectedOptionKey))); setSearch(""); setOpen(true); }}>Choose options</button>
    {!rules.length ? <p className="mt-2 text-xs text-zinc-500">No connected options yet.</p> : <>
      <div className="mt-3 space-y-2 text-xs">{groups.map((groupId) => <div key={groupId}>
        <p className="font-semibold">{plan.routes.find((entry) => entry.sourceKind === "option" && entry.sourceId === groupId)?.groupName ?? draft.optionGroups.find((group) => group.id === groupId)?.label ?? "Missing group"}:</p>
        <ul className="mt-1 flex flex-wrap gap-2">{rules.filter((rule) => rule.target!.group_id === groupId).map((rule, index) => {
          const item = draft.optionGroups.find((group) => group.id === groupId)?.items.find((row) => row.id === rule.target!.row_id);
          const label = item?.displayName ?? item?.label ?? (item ? item.id : "Missing option");
          return <li key={`${connectedOptionKey(rule)}:${index}`} className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1">{label}<button type="button" aria-label={`Remove ${label} connection`} onClick={() => onRouteChange((current) => ({ ...current, accessory: { ...current.accessory!, rules: current.accessory!.rules.filter((entry) => connectedOptionKey(entry) !== connectedOptionKey(rule)) } }))} className="rounded px-1 font-semibold hover:bg-zinc-100">×</button></li>;
        })}</ul>
      </div>)}</div>
      {settings.mixed ? <p className="mt-3 text-xs font-semibold text-amber-800">Mixed settings. Your next choice applies to all connections.</p> : null}
      <fieldset className="mt-3 space-y-1 text-xs"><legend className="mb-1 font-semibold">Mode</legend>
        <label className="flex items-center gap-2"><input type="radio" name={`${id}-mode`} checked={!settings.mixed && settings.required} onChange={() => update({ required: true })} />Add automatically</label>
        <label className="flex items-center gap-2"><input type="radio" name={`${id}-mode`} checked={!settings.mixed && !settings.required} onChange={() => update({ required: false, scaled: false })} />Let the user choose</label>
      </fieldset>
      {settings.required || settings.mixed ? <fieldset className="mt-3 space-y-2 text-xs"><legend className="font-semibold">Quantity</legend>
        <label className="flex items-center gap-2">Quantity<input type="number" aria-label="Connected option quantity" min="1" step="1" value={settings.quantity} onChange={(event) => update({ quantity: Number(event.target.value) })} className="h-8 w-20 rounded border border-zinc-300 px-2" /></label>
        <label className="flex items-center gap-2"><input type="radio" name={`${id}-quantity`} checked={!settings.mixed && settings.scaled} onChange={() => update({ scaled: true })} />for each selected option</label>
        <label className="flex items-center gap-2"><input type="radio" name={`${id}-quantity`} checked={!settings.mixed && !settings.scaled} onChange={() => update({ scaled: false })} />in total</label>
        {!settings.mixed ? <p className="text-zinc-500">2 options selected → {settings.quantity * (settings.scaled ? 2 : 1)} {settings.quantity * (settings.scaled ? 2 : 1) === 1 ? "item" : "items"}</p> : null}
      </fieldset> : null}
    </>}
    {issues.filter((message) => message !== quantityIssue).map((message) => <p role="alert" key={message} className="mt-2 text-xs text-red-800">{message}</p>)}
    <ConnectedOptionQuantityNotice accessory={accessory} onUseAtLeastOne={useAtLeastOne} />
    {open ? <ConnectedOptionsPicker choices={choices} pending={pending} search={search} onSearch={setSearch} onPending={setPending} onCancel={() => setOpen(false)} onSave={() => { onRouteChange((current) => ({ ...current, accessory: { ...current.accessory!, rules: rebuildConnectedOptionRules(current.accessory!, choices, pending) } })); setOpen(false); }} /> : null}
  </section>;
}
