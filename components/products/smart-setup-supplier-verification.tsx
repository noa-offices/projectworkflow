"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkSmartSetupSupplierPrices, listSmartSetupSupplierSourcesAction } from "@/app/products/smart-setup-supplier-check-actions";
import type { ProductTemplateDraft } from "@/lib/products/product-template-draft";
import type { SmartSetupSupplierCheckOutput } from "@/lib/products/smart-setup-supplier-check";
import type { SmartSetupSupplierSourceOption } from "@/lib/products/smart-setup-supplier-sources";
import type { SmartSetupPriceCell, SmartSetupUnsupportedCell } from "@/lib/products/smart-setup-supplier-targets";
import { buildSmartSetupCheckRequest, checkFingerprint, evidenceText, importedPriceText, reasonLabels, referencePriceText, sourceOptionLabel, statusLabels, summarizeCheckResults, visibleCheckResults } from "@/lib/products/smart-setup-supplier-verification";

const PAGE = 50;
const tone = { MATCHED: "border-emerald-300 bg-emerald-50 text-emerald-900", MISMATCH: "border-red-300 bg-red-50 text-red-900", NOT_FOUND: "border-zinc-300 bg-zinc-100 text-zinc-700", NEEDS_REVIEW: "border-amber-300 bg-amber-50 text-amber-900" } as const;
type Sources = { state: "loading" } | { state: "unauthorized" } | { state: "error" } | { state: "ready"; options: SmartSetupSupplierSourceOption[] };
type Checked = { fingerprint: string; output: SmartSetupSupplierCheckOutput; cells: SmartSetupPriceCell[]; unsupported: SmartSetupUnsupportedCell[] };

/** Read-only supplier price verification for the current Smart Setup draft. Never edits the draft, applies a price, or blocks Apply. Mount with key={brandId}. */
export function SmartSetupSupplierVerification({ draft, routingPlan, brandId }: { draft: ProductTemplateDraft; routingPlan: unknown; brandId: string }) {
  const [sources, setSources] = useState<Sources>({ state: "loading" });
  const [definitionId, setDefinitionId] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const requestId = useRef(0);
  const selected = sources.state === "ready" ? sources.options.find((o) => o.definitionId === definitionId) ?? null : null;

  useEffect(() => {
    let current = true;
    if (!brandId) return;
    listSmartSetupSupplierSourcesAction(brandId)
      .then((list) => { if (current) setSources(list.status === "ok" ? { state: "ready", options: list.sources } : { state: "unauthorized" }); })
      .catch(() => { if (current) setSources({ state: "error" }); });
    return () => { current = false; };
  }, [brandId]);

  const fingerprint = useMemo(() => (selected ? checkFingerprint({ draft, routingPlan, brandId, definitionId: selected.definitionId, versionId: selected.versionId }) : null), [draft, routingPlan, brandId, selected]);
  const fresh = checked && fingerprint && checked.fingerprint === fingerprint ? checked : null;
  const stale = Boolean(checked && !fresh);

  const run = async () => {
    if (!selected || !fingerprint) return;
    const request = buildSmartSetupCheckRequest(draft);
    if (!request.ok) { setError(request.message); return; }
    const id = ++requestId.current; setRunning(true); setError(null);
    try {
      const output = await checkSmartSetupSupplierPrices({ brandId, definitionId: selected.definitionId, sourceVersionId: selected.versionId, cells: request.cells });
      // The result belongs to the draft and selection it was requested for; a newer request supersedes it.
      if (id === requestId.current) { setChecked({ fingerprint, output, cells: request.cells, unsupported: request.unsupported }); setShowAll(false); setLimit(PAGE); }
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error && e.message ? e.message : "Supplier price check failed.");
    } finally {
      if (id === requestId.current) setRunning(false);
    }
  };

  return <SupplierVerificationPanel brandId={brandId} sources={sources} definitionId={definitionId} onSelect={(id) => { setDefinitionId(id); setError(null); }} selected={selected} running={running} error={error} stale={stale} fresh={fresh} showAll={showAll} onShowAll={(v) => { setShowAll(v); setLimit(PAGE); }} limit={limit} onMore={() => setLimit((n) => n + PAGE)} onRun={run} />;
}

export type SupplierVerificationPanelProps = { brandId: string; sources: Sources; definitionId: string; onSelect: (definitionId: string) => void; selected: SmartSetupSupplierSourceOption | null; running: boolean; error: string | null; stale: boolean; fresh: Checked | null; showAll: boolean; onShowAll: (value: boolean) => void; limit: number; onMore: () => void; onRun: () => void };
/** Presentation only: renders exactly what the service returned; no matching or comparison happens here. */
export function SupplierVerificationPanel({ brandId, sources, definitionId, onSelect, selected, running, error, stale, fresh, showAll, onShowAll, limit, onMore, onRun }: SupplierVerificationPanelProps) {
  const summary = fresh ? summarizeCheckResults(fresh.output.results) : null;
  const labels = new Map((fresh?.cells ?? []).map((c) => [c.locator, c]));
  const rows = fresh ? visibleCheckResults(fresh.output.results, showAll) : [];
  const headline = summary
    ? `${summary.counts.MATCHED} matched · ${summary.counts.MISMATCH} mismatch · ${summary.counts.NOT_FOUND} not found · ${summary.counts.NEEDS_REVIEW} needs review`
    : stale ? "Result is out of date" : "Not checked";

  return <details className="mb-3 rounded-md border border-zinc-200 bg-zinc-50" aria-label="Supplier Price Verification">
    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-zinc-900">Supplier Price Verification <span className="ml-2 font-normal text-zinc-600">{!brandId ? "Select a brand" : sources.state === "ready" && !sources.options.length ? "No applicable supplier price list" : headline}</span>{summary?.discrepancies ? <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">{summary.discrepancies} to review</span> : null}</summary>
    <div className="max-h-72 space-y-2 overflow-y-auto border-t border-zinc-200 p-3 text-xs">
      {!brandId ? <p className="text-zinc-600">Select a brand to verify prices against its supplier price list.</p>
        : sources.state === "loading" ? <p className="text-zinc-600">Loading supplier price lists…</p>
        : sources.state === "unauthorized" ? <p className="text-zinc-600">Supplier price verification is not available for your account.</p>
        : sources.state === "error" ? <p className="text-red-800">Supplier price lists could not be loaded.</p>
        : !sources.options.length ? <p className="text-zinc-600">No applicable supplier price list.</p>
        : <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-64 flex-1 font-medium text-zinc-700">Supplier price list
              <select aria-label="Supplier price list" value={definitionId} onChange={(e) => onSelect(e.target.value)} className="mt-1 block h-8 w-full rounded-md border border-zinc-300 bg-white px-2 text-xs">
                <option value="">Select a supplier price list</option>
                {sources.options.map((o) => <option key={o.definitionId} value={o.definitionId}>{sourceOptionLabel(o)}</option>)}
              </select>
            </label>
            <button type="button" disabled={!selected || running} onClick={onRun} className="h-8 rounded-md border border-emerald-700 bg-white px-3 text-xs font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50">{running ? "Checking…" : "Check Supplier Prices"}</button>
          </div>
          {error ? <p role="alert" className="text-red-800">{error}</p> : null}
          {stale ? <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">The draft or selection changed after the last check. Check Supplier Prices again; the earlier result is no longer shown.</p> : null}
          {fresh && summary ? <>
            <p className="text-zinc-700">Checked against <span className="font-semibold">{fresh.output.source.title}</span> · {fresh.output.source.currency} · {fresh.output.source.basis} price{selected?.effectiveFrom ? ` · effective ${selected.effectiveFrom}` : ""}</p>
            <div className="flex flex-wrap gap-2" aria-label="Check summary">{(["MATCHED", "MISMATCH", "NOT_FOUND", "NEEDS_REVIEW"] as const).map((s) => <span key={s} className={`rounded-full border px-2 py-0.5 font-semibold ${tone[s]}`}>{statusLabels[s]} {summary.counts[s]}</span>)}</div>
            {summary.discrepancies ? <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">{summary.discrepancies} price{summary.discrepancies === 1 ? "" : "s"} differ from the supplier list or need review. This is informational; you can still apply.</p> : null}
            {fresh.unsupported.length ? <p className="text-zinc-600" title={fresh.unsupported.map((u) => `${u.label}: ${u.detail}`).join("\n")}>{fresh.unsupported.length} priced row{fresh.unsupported.length === 1 ? " was" : "s were"} not checked (missing or multiple supplier codes).</p> : null}
            <label className="flex items-center gap-2 text-zinc-700"><input type="checkbox" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} />Also show matched and not found</label>
            {rows.length ? <table className="w-full table-fixed border-collapse text-left">
              <thead><tr className="border-b border-zinc-300 text-zinc-600"><th className="w-1/5 py-1">Model / code</th><th className="w-1/6">Price field / category</th><th>Imported price</th><th>Supplier price</th><th>Status</th><th className="w-1/4">Reason / evidence</th></tr></thead>
              <tbody>{rows.slice(0, limit).map((r) => {
                const cell = labels.get(r.locator);
                return <tr key={r.locator} className="border-b border-zinc-200 align-top">
                  <td className="py-1 pr-2"><span className="font-semibold">{cell?.label ?? r.locator}</span><br />{r.code}</td>
                  <td>{cell?.dimensionLabel || r.dimension || r.priceField.replace("_", " ")}{r.role !== "main_product" ? <><br /><span className="text-zinc-500">{r.role.replace("_", " ")}</span></> : null}</td>
                  <td>{importedPriceText(r)}</td><td>{referencePriceText(r)}</td>
                  <td><span className={`rounded-full border px-2 py-0.5 font-semibold ${tone[r.status]}`}>{statusLabels[r.status]}</span></td>
                  <td>{reasonLabels[r.reason]}{evidenceText(r) ? <><br /><span className="text-zinc-500">{evidenceText(r)}</span></> : null}</td>
                </tr>;
              })}</tbody></table> : <p className="text-zinc-600">{showAll ? "No rows." : "No mismatches or rows needing review."}</p>}
            {rows.length > limit ? <button type="button" onClick={onMore} className="font-semibold text-emerald-900 underline">Show {Math.min(PAGE, rows.length - limit)} more ({rows.length - limit} remaining)</button> : null}
          </> : null}
        </>}
    </div>
  </details>;
}
