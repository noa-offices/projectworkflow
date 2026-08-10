"use client";

import { useState } from "react";
import { getFinishCategoryGroupImportCandidates, type FinishCategoryGroupImportCandidate } from "@/lib/products/finish-category-group-json-import";
import { parseSmartProductJsonImport, type SmartProductJsonImportResult } from "@/lib/products/smart-product-json-import";

function displayPrice(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : String(value);
}

export function FinishCategoryGroupJsonImport({
  groupName,
  onClose,
  onReplace,
}: {
  groupName: string;
  onClose: () => void;
  onReplace: (candidate: FinishCategoryGroupImportCandidate) => void;
}) {
  const [rawJson, setRawJson] = useState("");
  const [result, setResult] = useState<SmartProductJsonImportResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const draft = result?.kind === "valid" ? result.validation.draft : null;
  const imported = draft ? getFinishCategoryGroupImportCandidates(draft) : null;
  const candidates = imported?.candidates ?? [];
  const selected = candidates.find((candidate) => candidate.id === (selectedId ?? (candidates.length === 1 ? candidates[0]?.id : null))) ?? null;
  const warnings = [...(result?.kind === "valid" ? result.validation.warnings.map((warning) => warning.message) : []), ...(imported?.warnings ?? [])];
  const validationMessage = result && result.kind !== "valid"
    ? (result.kind === "validation" ? "JSON does not meet the ProductTemplateDraft v1 contract." : result.message)
    : null;
  const validate = () => {
    setSelectedId(null);
    setResult(parseSmartProductJsonImport(rawJson));
  };

  return <div role="dialog" aria-modal="true" aria-label="Import JSON into Finish Category Group" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"><div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl"><div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 p-5"><div><h2 className="text-lg font-semibold">Import JSON into Finish / Category Group</h2><p className="mt-1 text-sm text-zinc-600">Target group: {groupName}</p></div><button type="button" onClick={onClose} className="text-sm font-medium text-zinc-700">Close</button></div>{!draft ? <div className="min-h-0 flex-1 overflow-y-auto p-5"><textarea value={rawJson} onChange={(event) => { setRawJson(event.target.value); setResult(null); }} className="min-h-72 w-full rounded-md border border-zinc-300 p-3 font-mono text-xs" aria-label="Finish category group JSON" />{validationMessage ? <p className="mt-3 text-sm text-red-800">{validationMessage}</p> : null}<div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Cancel</button><button type="button" onClick={validate} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Validate</button></div></div> : !candidates.length ? <div className="p-5"><p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">No compatible Finish / Category price matrix was found. Modular matrices cannot be imported into this group.</p>{warnings.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul> : null}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setResult(null)} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Back to JSON</button><button type="button" onClick={onClose} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Cancel</button></div></div> : <div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><p className="font-semibold">Validated ProductTemplateDraft v1</p><p className="mt-1">{candidates.length === 1 ? "One compatible Finish / Category matrix was selected." : "Choose one compatible matrix to import."}</p></div>{candidates.length > 1 ? <fieldset className="mt-4 space-y-2"><legend className="text-sm font-semibold">Choose matrix to import</legend>{candidates.map((candidate) => <label key={candidate.id} className="flex items-center gap-2 rounded-md border border-zinc-200 p-3 text-sm"><input type="radio" name="finish-category-matrix" checked={selectedId === candidate.id} onChange={() => setSelectedId(candidate.id)} />{candidate.label} · {candidate.group.items.length} rows</label>)}</fieldset> : null}{selected ? <div className="mt-4 rounded-md border border-zinc-200 p-4"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{selected.label}</h3><p className="text-sm text-zinc-600">{selected.group.price_categories.length} columns · {selected.group.items.length} rows</p></div></div><div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="border-b border-zinc-200 text-zinc-500"><tr><th className="px-2 py-2">Model / Code</th>{selected.group.price_categories.map((category) => <th key={category} className="px-2 py-2">{category}</th>)}</tr></thead><tbody>{selected.group.items.map((row) => <tr key={row.id} className="border-b border-zinc-100 last:border-0"><td className="px-2 py-2"><p className="font-medium">{row.display_name || row.variant_name || row.id}</p><p className="text-zinc-500">{row.supplier_price_list_code || "—"}</p></td>{selected.group.price_categories.map((category) => <td key={category} className="px-2 py-2">{displayPrice(row.prices?.[category])}</td>)}</tr>)}</tbody></table></div></div> : null}{warnings.length ? <section className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Import warnings</p><ul className="mt-2 list-disc space-y-1 pl-5">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></section> : null}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setResult(null)} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Back to JSON</button><button type="button" disabled={!selected} onClick={() => { if (selected) onReplace(selected); }} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Replace This Group</button></div></div>}</div></div>;
}
