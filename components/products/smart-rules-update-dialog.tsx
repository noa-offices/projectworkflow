"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { SmartProductJsonImportResult } from "@/lib/products/smart-product-json-import";
import { createReviewedProductTemplateDraft } from "@/lib/products/smart-product-review";
import { applySmartRulesOnlyUpdate, planSmartRulesOnlyUpdate, type SmartRulesOnlyChange, type SmartRulesOnlyChoice, type SmartRulesOnlyPlan } from "@/lib/products/smart-rules-only-update";
import type { ProductTemplateDraft } from "@/lib/products/product-template-draft";
import type { SmartSetupReviewRoutingPlan } from "@/lib/products/smart-product-review-routing";

export type SmartRulesParseOutcome = { result: SmartProductJsonImportResult; finalText: string | null; wrapperRemoved: boolean; quoteRepaired: boolean };

const DEFAULT_CHOICE: SmartRulesOnlyChoice = { apply: true, addItems: true };
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function TargetList({ title, targets }: { title: string; targets: string[] }) {
  if (!targets.length) return null;
  return <details className="mt-1"><summary className="cursor-pointer font-semibold">{title} ({targets.length})</summary><ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-zinc-600">{targets.map((target, index) => <li key={`${target}-${index}`} className="break-words">{target}</li>)}</ul></details>;
}

function ChangeCard({ change, choice, unnamed, onChoice }: { change: SmartRulesOnlyChange; choice: SmartRulesOnlyChoice; unnamed: number; onChoice: (patch: Partial<SmartRulesOnlyChoice>) => void }) {
  return (
    <section className="rounded-md border border-zinc-200 p-3 text-xs">
      <label className="flex items-start gap-2 text-sm font-semibold text-zinc-900"><input type="checkbox" checked={choice.apply} onChange={(event) => onChoice({ apply: event.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300" /><span className="break-words">{change.name}</span></label>
      <p className="mt-1 font-semibold text-emerald-900">{change.targetsBefore} targets before -&gt; {change.targetsAfter} after</p>
      {change.settingChanges.map((text) => <p key={text} className="mt-1 break-words text-zinc-700">{text}</p>)}
      {change.itemListChanges ? <p className="mt-1 text-zinc-700">Offered items change on {plural(change.itemListChanges, "existing target")}.</p> : null}
      {change.ruleSettingChanges ? <p className="mt-1 text-zinc-700">Required, visibility or quantity settings change on {plural(change.ruleSettingChanges, "existing target")}.</p> : null}
      <TargetList title="Targets added" targets={change.addedTargets} />
      <TargetList title="Targets removed" targets={change.removedTargets} />
      {change.neededItems.length ? (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-950">
          <p className="font-semibold">{plural(change.neededItems.length, "new item")} needed</p>
          <ul className="mt-1 list-disc pl-5">{change.neededItems.map((item) => <li key={item.id} className="break-words">{item.name}</li>)}</ul>
          <label className="mt-2 flex items-center gap-2 font-semibold"><input type="checkbox" checked={choice.addItems} disabled={!choice.apply} onChange={(event) => onChoice({ addItems: event.target.checked })} className="h-4 w-4 rounded border-zinc-300" />Also add these {change.neededItems.length} items</label>
        </div>
      ) : null}
      {unnamed ? <p className="mt-2 text-amber-800">{unnamed} item{unnamed === 1 ? " is" : "s are"} not named by the new rules and will be offered on every target.</p> : null}
    </section>
  );
}

export function SmartRulesUpdateReview({ report, choices, manual, unnamed, onChoice, onManual }: {
  report: SmartRulesOnlyPlan;
  choices: Record<string, SmartRulesOnlyChoice>;
  manual: Record<string, string>;
  unnamed: Record<string, number>;
  onChoice: (key: string, patch: Partial<SmartRulesOnlyChoice>) => void;
  onManual: (incomingId: string, groupId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-zinc-900">{report.changes.length ? `${plural(report.changes.length, "group")} with different rules` : "No rule differences found"} · {plural(report.unchangedCount, "group")} unchanged</p>
      {report.changes.map((change) => <ChangeCard key={change.key} change={change} choice={choices[change.key] ?? DEFAULT_CHOICE} unnamed={unnamed[change.key] ?? 0} onChoice={(patch) => onChoice(change.key, patch)} />)}
      {report.ignored.length ? (
        <section className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs">
          <p className="font-semibold text-zinc-800">Not found in this template (ignored)</p>
          <p className="mt-1 text-zinc-600">No saved group has the same id or name. A group stays ignored unless you choose a saved group for it.</p>
          <ul className="mt-2 space-y-2">{report.ignored.map((entry) => (
            <li key={entry.id}>
              <p className="break-words font-medium text-zinc-900">{entry.name}</p>
              {report.availableGroups.length ? <label className="mt-1 flex flex-wrap items-center gap-2 text-zinc-600">Use for<select value={manual[entry.id] ?? ""} onChange={(event) => onManual(entry.id, event.target.value)} className="h-8 min-w-0 max-w-full rounded border border-zinc-300 bg-white px-2"><option value="">Ignore</option>{report.availableGroups.map((group) => <option key={group.groupId} value={group.groupId} disabled={Object.entries(manual).some(([id, value]) => id !== entry.id && value === group.groupId)}>{group.name}</option>)}</select></label> : null}
              {entry.suggestion && !manual[entry.id] ? <p className="mt-1 text-amber-800">Possibly &quot;{entry.suggestion.name}&quot; ({plural(entry.suggestion.sharedItems, "shared item")}). Check before choosing it.</p> : null}
            </li>
          ))}</ul>
        </section>
      ) : null}
    </div>
  );
}

export function SmartRulesUpdateDialog({ draft, plan, parse, renderParseProblems, onApply, onClose }: {
  draft: ProductTemplateDraft;
  plan: SmartSetupReviewRoutingPlan;
  /** The Smart Setup parser, so pasted text is repaired and validated exactly as everywhere else. */
  parse: (rawJson: string) => SmartRulesParseOutcome;
  renderParseProblems: (rawJson: string, outcome: SmartRulesParseOutcome) => ReactNode;
  onApply: (draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan, updatedCount: number) => void;
  onClose: () => void;
}) {
  const [rawJson, setRawJson] = useState("");
  const [outcome, setOutcome] = useState<SmartRulesParseOutcome | null>(null);
  const [incoming, setIncoming] = useState<ProductTemplateDraft | null>(null);
  const [overrides, setOverrides] = useState<Record<string, SmartRulesOnlyChoice>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [fileError, setFileError] = useState<string | null>(null);

  const report = useMemo(() => incoming ? planSmartRulesOnlyUpdate(draft, plan, incoming, manual) : null, [draft, plan, incoming, manual]);
  const choices = useMemo(() => Object.fromEntries((report?.changes ?? []).map((change) => [change.key, overrides[change.key] ?? DEFAULT_CHOICE])), [report, overrides]);
  const result = useMemo(() => incoming ? applySmartRulesOnlyUpdate(draft, plan, incoming, choices, manual) : null, [draft, plan, incoming, choices, manual]);

  const reset = (text: string) => { setRawJson(text); setOutcome(null); setIncoming(null); setOverrides({}); setManual({}); };
  const validate = () => {
    const next = parse(rawJson);
    if (next.finalText) setRawJson(next.finalText);
    setOutcome(next);
    setIncoming(next.result.kind === "valid" && next.result.validation.draft ? createReviewedProductTemplateDraft(next.result.validation.draft) : null);
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    try { reset(await file.text()); setFileError(null); } catch { setFileError("The file could not be read. Paste the JSON instead."); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Update Rules from JSON" className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/50 p-4">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4">
          <div><h3 className="font-semibold">Update Rules from JSON</h3><p className="text-xs text-zinc-500">Only accessory group rules and names change. Prices, pricing rows and images stay as they are. Nothing is saved until you press Save Changes.</p></div>
          <button type="button" onClick={onClose} className="text-sm font-medium">Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {report ? <SmartRulesUpdateReview report={report} choices={choices} manual={manual} unnamed={result?.unnamed ?? {}} onChoice={(key, patch) => setOverrides((current) => ({ ...current, [key]: { ...(current[key] ?? DEFAULT_CHOICE), ...patch } }))} onManual={(incomingId, groupId) => setManual((current) => { const next = { ...current }; if (groupId) next[incomingId] = groupId; else delete next[incomingId]; return next; })} /> : (
            <>
              <label className="block text-xs font-semibold text-zinc-700">Upload a .json or .txt file<input type="file" accept=".json,.txt,application/json,text/plain" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} className="mt-1 block w-full text-xs font-normal" /></label>
              {fileError ? <p role="alert" className="mt-1 text-xs text-red-700">{fileError}</p> : null}
              <textarea value={rawJson} onChange={(event) => reset(event.target.value)} aria-label="Rules JSON" placeholder="Or paste the JSON here" className="mt-3 min-h-64 w-full rounded-md border border-zinc-300 p-3 font-mono text-xs" />
              <button type="button" onClick={validate} className="mt-3 rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Validate JSON</button>
            </>
          )}
          {outcome ? renderParseProblems(rawJson, outcome) : null}
        </div>
        {report && result ? (
          <div className="border-t border-zinc-200 p-4">
            {result.errors.length ? <div role="alert" className="mb-2 max-h-32 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800"><p className="font-semibold">Apply is blocked. Nothing has changed.</p><ul className="mt-1 list-disc pl-5">{result.errors.map((message) => <li key={message} className="break-words">{message}</li>)}</ul></div> : null}
            {!result.errors.length && !result.workspace && report.changes.length ? <p role="status" className="mb-2 text-xs text-zinc-600">Tick at least one group to apply.</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => reset(rawJson)} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Back to JSON</button>
              <button type="button" disabled={!result.workspace} onClick={() => { if (result.workspace) onApply(result.workspace.draft, result.workspace.plan, result.updatedCount); }} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Apply Rules</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
