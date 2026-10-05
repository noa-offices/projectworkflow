"use client";

import { useState } from "react";
import type { SupplierCapacityReport } from "@/lib/products/supplier-price-repository";
import { loadSupplierCapacityReport } from "@/app/products/price-updates/supplier-sources/actions";

const button = "inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const badge = "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium";
const mb = (bytes: number | null | undefined) => `${((bytes ?? 0) / 1_048_576).toFixed(1)} MB`;
const tone = (value: string) => value === "SAFE_CANDIDATE" || value === "SUPERSEDED_SAFE_TO_DELETE" ? "border-amber-200 bg-amber-50 text-amber-900"
  : value === "MANUAL_REVIEW_REQUIRED" ? "border-red-200 bg-red-50 text-red-900" : "border-zinc-200 bg-zinc-50 text-zinc-700";

/** System Owner only, read-only: database usage and the deterministic cleanup dry run. It has no delete controls. */
export function SupplierCapacityPanel() {
  const [report, setReport] = useState<SupplierCapacityReport | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [details, setDetails] = useState(false);
  async function refresh() { setBusy(true); setMessage(""); try { setReport(await loadSupplierCapacityReport()); } catch (error) { setMessage(error instanceof Error ? error.message : "Report unavailable."); } finally { setBusy(false); } }
  const superseded = report?.batches.filter((batch) => batch.retention === "SUPERSEDED_SAFE_TO_DELETE") ?? [];
  return <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm"><summary className="cursor-pointer"><span className="font-semibold text-zinc-950">Supplier Database Capacity</span> <span className="text-xs text-zinc-500">System Owner only. Read-only report and cleanup dry run.</span></summary>
    <div className="mt-3 space-y-3">
      <p className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={button} onClick={() => void refresh()}>Refresh report</button>{report ? <button type="button" className={button} onClick={() => setDetails((open) => !open)}>{details ? "Hide dry run" : "View dry run"}</button> : null}</p>
      <p role="status" aria-live="polite" className="text-amber-800">{message}</p>
      {report ? <>
        <dl className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{([["Database usage", mb(report.database_bytes)], ["Supplier data", mb(report.supplier_bytes)], ["Duplicate source groups", String(report.duplicate_groups.length)],
          ["Derived match data", mb(report.tables.find((table) => table.name === "supplier_price_matches")?.total_bytes)], ["Importing sources", String(report.protected_sources.length)],
          ["Cleanup candidates", mb((report.reclaimable.duplicate_sources_bytes ?? 0) + (report.reclaimable.superseded_batches_bytes ?? 0) + (report.compaction.source_chunk_bytes ?? 0) + (report.compaction.match_chunk_bytes ?? 0))]] as const).map(([label, value]) =>
          <div key={label} className="rounded-md border border-zinc-200 bg-white px-3 py-2"><dt className="text-xs text-zinc-500">{label}</dt><dd className="font-semibold tabular-nums text-zinc-950">{value}</dd></div>)}</dl>
        <p className="text-xs text-zinc-600">Estimates are logical bytes. Deleting rows makes space reusable inside the database; the reported database size only shrinks after separate maintenance.</p>
        {details ? <div className="space-y-3 text-xs">
          {report.protected_sources.map((source) => <p key={source.source_id} className="rounded border border-zinc-200 bg-white p-2"><span className={`${badge} border-emerald-200 bg-emerald-50 text-emerald-900`}>Protected</span> {source.filename}: {source.reason}</p>)}
          {report.duplicate_groups.map((group) => <div key={group.file_hash} className="space-y-1 rounded border border-zinc-200 bg-white p-2"><p className="font-semibold">Same file imported {group.members.length} times ({group.brand}) <span className={`${badge} ${tone(group.classification)}`}>{group.classification}</span></p>
            <ul className="space-y-0.5">{group.members.map((member) => <li key={member.source_id}><span className={`${badge} ${tone(member.classification)}`}>{member.classification}</span> {member.title} · {String(member.created_at).slice(0, 10)} · {member.batches} reviews · {member.decisions} decisions · {mb(member.estimated_bytes)}</li>)}</ul>
            <p>Recoverable now: {mb(group.reclaimable_bytes)}</p></div>)}
          <p>{superseded.length} superseded review {superseded.length === 1 ? "run" : "runs"} without decisions ({mb(report.reclaimable.superseded_batches_bytes)}). Staging payloads that can be compacted: {mb((report.compaction.source_chunk_bytes ?? 0) + (report.compaction.match_chunk_bytes ?? 0))}.</p>
          <p className="text-zinc-500">No cleanup runs from this screen. Cleanup needs a separate, explicitly approved step.</p>
        </div> : null}
      </> : null}
    </div></details>;
}
