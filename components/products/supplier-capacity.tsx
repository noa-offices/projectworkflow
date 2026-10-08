"use client";

import { useEffect, useState, useTransition } from "react";
import { captureCapacitySnapshot, cleanTemporaryProductSources, loadSystemCapacityReport, saveCapacitySettings } from "@/app/settings/system-health/actions";
import { bucketShares, capacityBytes as bytes, capacityChange, capacityHealth, capacitySettingInput, capacityTrend, growthSeries, meterPercent, storageForecast, type CapacityBucket, type CapacityUnit, type GrowthPoint, type SystemCapacityReport } from "@/lib/products/system-capacity";

const button = "inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const shortDate = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "short" }).format(new Date(value));
const summary = "cursor-pointer font-semibold text-zinc-900";
const cell = "px-3 py-2 text-left tabular-nums";
const card = "rounded-lg border border-zinc-200 bg-white p-4 sm:p-5";
const tones: Record<string, { badge: string; bar: string }> = {
  Healthy: { badge: "border-emerald-200 bg-emerald-50 text-emerald-800", bar: "bg-emerald-600" },
  Watch: { badge: "border-amber-200 bg-amber-50 text-amber-800", bar: "bg-amber-500" },
  "Action needed": { badge: "border-red-200 bg-red-50 text-red-800", bar: "bg-red-600" },
};

/** Owner-only monitoring. Loads on open; writes are limited to snapshots and capacity settings. */
export function SupplierCapacityPanel() {
  const [report, setReport] = useState<SystemCapacityReport | null>(null);
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  function run(capture: boolean) {
    startTransition(async () => {
      setMessage("");
      try {
        setReport(await (capture ? captureCapacitySnapshot() : loadSystemCapacityReport()));
        if (capture) setMessage("Capacity snapshot captured.");
      } catch (error) {
        setReport(null);
        setMessage(error instanceof Error ? error.message : "Report unavailable.");
      }
    });
  }
  useEffect(() => { run(false); }, []);
  return <div className="space-y-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role="status" aria-live="polite" className="text-xs text-zinc-700">{message || (report ? `Measured ${date(report.generated_at)}` : busy ? "Reading current usage…" : "")}</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} className={button} onClick={() => run(false)}>{busy ? "Loading…" : "Refresh"}</button>
        <button type="button" disabled={busy} className={button} onClick={() => run(true)}>Capture snapshot</button>
      </div>
    </div>
    {report ? <>
      <CapacitySettings key={`${report.database_setting ?? "env"}:${report.storage_setting ?? "env"}`} report={report} onSaved={(next) => { setReport(next); setMessage("Capacity settings saved."); }} />
      <SystemCapacityDetails report={report} onReport={setReport} />
    </> : null}
  </div>;
}

export function CapacitySettings({ report, onSaved }: { report: SystemCapacityReport; onSaved: (report: SystemCapacityReport) => void }) {
  const initial = (saved: number | null, effective: number | null) => saved === null ? { ...capacitySettingInput(effective), value: "" } : capacitySettingInput(saved);
  const database = initial(report.database_setting, report.database_limit);
  const storage = initial(report.storage_setting, report.storage_limit);
  const [databaseValue, setDatabaseValue] = useState(database.value);
  const [databaseUnit, setDatabaseUnit] = useState<CapacityUnit>(database.unit);
  const [storageValue, setStorageValue] = useState(storage.value);
  const [storageUnit, setStorageUnit] = useState<CapacityUnit>(storage.unit);
  const [message, setMessage] = useState("");
  const [saving, startSaving] = useTransition();

  function save() {
    startSaving(async () => {
      setMessage("");
      try {
        onSaved(await saveCapacitySettings({ databaseValue, databaseUnit, storageValue, storageUnit }));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Capacity settings could not be saved.");
      }
    });
  }

  const field = (label: string, value: string, setValue: (value: string) => void, unit: CapacityUnit, setUnit: (unit: CapacityUnit) => void, effective: number | null) => <label className="grid gap-1.5">
    <span className="text-xs font-semibold text-zinc-700">{label}</span>
    <span className="flex gap-2">
      <input type="number" min="0.001" step="any" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder={effective === null ? "Not configured" : capacitySettingInput(effective).value} className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10" />
      <select value={unit} onChange={(event) => setUnit(event.target.value as CapacityUnit)} className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"><option value="MB">MB</option><option value="GB">GB</option></select>
    </span>
  </label>;

  return <details className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
    <summary className={summary}>Capacity settings</summary>
    <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("Database capacity", databaseValue, setDatabaseValue, databaseUnit, setDatabaseUnit, report.database_limit)}
        {field("Storage capacity", storageValue, setStorageValue, storageUnit, setStorageUnit, report.storage_limit)}
      </div>
      <p className="text-xs text-zinc-500">Leave a field blank to use its server environment value. If neither is configured, its meter remains unconfigured.</p>
      <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={saving} className={button}>{saving ? "Saving…" : "Save capacity"}</button><p role="status" aria-live="polite" className="text-xs text-zinc-700">{message}</p></div>
    </form>
  </details>;
}

function HealthCard({ title, bytesValue, limit, growth }: { title: string; bytesValue: number | null; limit: number | null; growth: string | null }) {
  const health = capacityHealth(bytesValue, limit);
  const percent = meterPercent(health.used);
  const tone = tones[health.status];
  return <section className={card} aria-label={`${title} health`}>
    <div className="flex items-start justify-between gap-3">
      <h3 className="text-sm font-semibold text-zinc-700">{title}</h3>
      {tone ? <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${tone.badge}`}>{health.status}</span> : null}
    </div>
    <p className="mt-2 text-3xl font-semibold tabular-nums text-zinc-950">{bytes(bytesValue)}</p>
    {percent !== null && limit !== null && tone ? <>
      <p className="mt-1 text-xs text-zinc-600">of {bytes(limit)} · {health.used!.toFixed(0)}% used</p>
      <div role="meter" aria-label={`${title} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100"><div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${percent}%` }} /></div>
    </> : <p className="mt-1 text-xs text-zinc-500">{bytesValue === null ? "Size could not be fully measured." : "Capacity limit not configured."}</p>}
    {growth ? <p className="mt-3 text-xs text-zinc-600">{growth} in the last 30 days</p> : null}
  </section>;
}

function GrowthChart({ points }: { points: GrowthPoint[] }) {
  if (points.length < 2) return <p className="rounded-md border border-dashed border-zinc-200 px-3 py-6 text-center text-xs text-zinc-500">{points.length ? "Growth trend starts after the next snapshot." : "Capture a snapshot to start the growth trend."}</p>;
  const w = 640, h = 160, pad = 8;
  const values = points.flatMap((point) => [point.database, point.storage ?? point.database]);
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const x = (i: number) => pad + i / (points.length - 1) * (w - pad * 2);
  const y = (v: number) => h - pad - (v - min) / span * (h - pad * 2);
  const line = (pick: (point: GrowthPoint) => number | null) => points.reduce<string>((path, point, i) => { const v = pick(point); return v === null ? path : `${path}${path ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; }, "");
  return <div>
    <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" role="img" aria-label="Database and Storage size over recorded snapshots" preserveAspectRatio="none">
      <path d={line((point) => point.database)} fill="none" stroke="#065f46" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <path d={line((point) => point.storage)} fill="none" stroke="#71717a" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="mt-1 flex justify-between text-xs text-zinc-500"><span>{shortDate(points[0].at)}</span><span>{shortDate(points[points.length - 1].at)}</span></div>
    <p className="mt-2 flex gap-4 text-xs text-zinc-600"><span><span className="inline-block h-0.5 w-4 bg-emerald-800 align-middle" /> Database size</span><span><span className="inline-block w-4 border-t-2 border-dashed border-zinc-500 align-middle" /> Storage size</span></p>
  </div>;
}

export function SystemCapacityDetails({ report, onReport }: { report: SystemCapacityReport; onReport?: (report: SystemCapacityReport) => void }) {
  const trend = capacityTrend(report);
  const supplierTables = report.tables.filter((table) => table.schema === "public" && table.name.startsWith("supplier_"));
  const sortedTables = [...report.tables].sort((a, b) => b.total_bytes - a.total_bytes);
  const topTables = sortedTables.slice(0, 8);
  const topMax = topTables[0]?.total_bytes || 1;
  const shares = bucketShares(report.buckets, report.storage_bytes);
  const known = (current: number | null, previous: number | null | undefined) => current !== null && previous !== null && previous !== undefined;
  const dbGrowth = known(report.database_bytes, trend.baseline?.database_bytes) ? capacityChange(report.database_bytes, trend.baseline?.database_bytes) : null;
  const storageGrowth = known(report.storage_bytes, trend.baseline?.storage_bytes) ? capacityChange(report.storage_bytes, trend.baseline?.storage_bytes) : null;
  const points = growthSeries(report);
  const forecast = storageForecast(report);
  return <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2">
      <HealthCard title="Database" bytesValue={report.database_bytes} limit={report.database_limit} growth={dbGrowth} />
      <HealthCard title="Storage" bytesValue={report.storage_bytes} limit={report.storage_limit} growth={storageGrowth} />
    </div>
    <section className={card} aria-label="Growth history">
      <h3 className="font-semibold text-zinc-900">Database &amp; Storage Growth</h3>
      <div className="mt-3"><GrowthChart points={points} /></div>
      <dl className="mt-4 grid gap-3 border-t border-zinc-100 pt-3 text-xs sm:grid-cols-4">
        <div><dt className="text-zinc-500">Latest snapshot</dt><dd className="font-semibold">{report.snapshots[0] ? date(report.snapshots[0].captured_at) : "None yet"}</dd></div>
        <div><dt className="text-zinc-500">Previous snapshot</dt><dd className="font-semibold">{report.snapshots[1] ? date(report.snapshots[1].captured_at) : "None yet"}</dd></div>
        <div><dt className="text-zinc-500">30-day database change</dt><dd className="font-semibold">{capacityChange(report.database_bytes, trend.baseline?.database_bytes)}</dd></div>
        <div><dt className="text-zinc-500">30-day Storage change</dt><dd className="font-semibold">{capacityChange(report.storage_bytes, trend.baseline?.storage_bytes)}</dd></div>
      </dl>
      {trend.baseline ? null : <p className="mt-2 text-xs text-zinc-500">30-day change becomes available when a snapshot is at least 30 days old.</p>}
      {trend.fastGrowth ? <p className="mt-2 text-xs font-medium text-amber-800">Growth watch: database size increased by at least 20% since the comparison snapshot. Review the largest consumers.</p> : null}
      {forecast ? <dl className="mt-3 grid gap-3 rounded-md bg-zinc-50 p-3 text-xs sm:grid-cols-4"><div><dt className="text-zinc-500">Average daily Storage growth</dt><dd className="font-semibold">{bytes(forecast.dailyBytes)}</dd></div><div><dt className="text-zinc-500">Average monthly growth</dt><dd className="font-semibold">{bytes(forecast.monthlyBytes)}</dd></div><div><dt className="text-zinc-500">Estimated to 70%</dt><dd className="font-semibold">{forecast.daysTo70 === null ? "Unknown" : `${forecast.daysTo70} days`}</dd></div><div><dt className="text-zinc-500">Estimated to 85%</dt><dd className="font-semibold">{forecast.daysTo85 === null ? "Unknown" : `${forecast.daysTo85} days`}</dd></div></dl> : <p className="mt-2 text-xs text-zinc-500">Not enough history for forecast. Configure Storage capacity and capture at least two snapshots spanning seven days.</p>}
    </section>

    <div className="grid gap-4 md:grid-cols-2">
      <section className={card} aria-label="Storage breakdown">
        <h3 className="font-semibold text-zinc-900">Storage breakdown</h3>
        {shares.length ? <ul className="mt-3 space-y-3">{shares.map((bucket) => <li key={bucket.name}>
          <div className="flex justify-between gap-2 text-xs"><span className="font-medium text-zinc-800">{bucket.name}</span><span className="tabular-nums text-zinc-600">{bucket.unknown_sizes ? "Unknown" : bytes(bucket.total_bytes)}{bucket.share === null ? "" : ` · ${bucket.share.toFixed(0)}%`} · {bucket.objects.toLocaleString("en-US")} objects</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-emerald-700" style={{ width: `${bucket.share ?? 0}%` }} /></div>
        </li>)}</ul> : <p className="mt-3 text-xs text-zinc-500">No Storage buckets.</p>}
      </section>
      <StorageCleanupAnalyzer report={report} onReport={onReport} />
      <section className={card} aria-label="Supplier Pricing footprint">
        <h3 className="font-semibold text-zinc-900">Supplier Pricing</h3>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-950">{bytes(report.supplier_bytes)}</p>
        <p className="text-xs text-zinc-500">including {bytes(report.supplier_index_bytes)} of indexes</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {([["Current", report.sources.current], ["Previous", report.sources.previous], ["Archived", report.sources.archived], ["Compacted", report.sources.compacted]] as const).map(([label, value]) => <div key={label} className="rounded-md bg-zinc-50 px-3 py-2"><dt className="text-zinc-500">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}
        </dl>
        {report.reclaimable.bytes > 0 ? <p className="mt-3 text-xs text-zinc-600">{bytes(report.reclaimable.bytes)} potentially reclaimable</p> : null}
      </section>
    </div>

    <div className="grid gap-4 md:grid-cols-2">
      <section className={card} aria-label="Largest tables">
        <h3 className="font-semibold text-zinc-900">Largest database tables</h3>
        <ul className="mt-3 space-y-3">{topTables.map((table) => <li key={`${table.schema}.${table.name}`}>
          <div className="flex justify-between gap-2 text-xs"><span className="truncate font-medium text-zinc-800">{table.name}</span><span className="shrink-0 tabular-nums text-zinc-600">{bytes(table.total_bytes)}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-emerald-700" style={{ width: `${table.total_bytes / topMax * 100}%` }} /></div>
          <p className="mt-0.5 text-xs text-zinc-500">Data {bytes(table.table_bytes)} · Indexes {bytes(table.index_bytes)} · ~{table.rows?.toLocaleString("en-US") ?? "Unknown"} rows</p>
        </li>)}</ul>
        {sortedTables.length > topTables.length ? <p className="mt-3 text-xs text-zinc-500">View all tables under Technical details.</p> : null}
      </section>
      <section className={`${card} self-start`} aria-label="Database reclaimable space">
        <h3 className="font-semibold text-zinc-900">Database reclaimable</h3>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-950">{bytes(report.reclaimable.bytes)}</p>
        <p className="mt-1 text-xs text-zinc-600">{report.reclaimable.bytes > 0 ? `${bytes(report.reclaimable.bytes)} safely reclaimable across ${report.reclaimable.items.toLocaleString("en-US")} finalized database staging chunks.` : "No safely reclaimable database technical data currently detected."}</p>
        <p className="mt-2 text-xs text-zinc-500">Database accounting only. Freed rows become reusable database space; physical database size may not shrink.</p>
      </section>
    </div>

    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-700">Technical details</h3>
      <details className="rounded-md border border-zinc-200 bg-white p-3"><summary className={summary}>Database tables</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><caption className="text-left text-zinc-500">Application relations by total size. Data includes TOAST and overhead; rows are planner estimates, unknown before statistics exist.</caption><thead><tr>{["Table / object", "Heap / data", "Indexes", "Total", "Approx rows"].map((title) => <th key={title} className={cell}>{title}</th>)}</tr></thead><tbody>{sortedTables.map((table) => <tr key={`${table.schema}.${table.name}`} className="border-t border-zinc-100"><td className={cell}>{table.schema}.{table.name}</td><td className={cell}>{bytes(table.table_bytes)}</td><td className={cell}>{bytes(table.index_bytes)}</td><td className={cell}>{bytes(table.total_bytes)}</td><td className={cell}>{table.rows?.toLocaleString("en-US") ?? "Unknown"}</td></tr>)}</tbody></table></div></details>
      <details className="rounded-md border border-zinc-200 bg-white p-3"><summary className={summary}>Largest indexes</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><caption className="text-left text-zinc-500">Top 50 by physical size</caption><thead><tr><th className={cell}>Index</th><th className={cell}>Table</th><th className={cell}>Size</th></tr></thead><tbody>{[...report.indexes].sort((a, b) => b.bytes - a.bytes).map((index) => <tr key={`${index.schema}.${index.name}`} className="border-t border-zinc-100"><td className={cell}>{index.schema}.{index.name}</td><td className={cell}>{index.table_name}</td><td className={cell}>{bytes(index.bytes)}</td></tr>)}</tbody></table></div></details>
      <details className="rounded-md border border-zinc-200 bg-white p-3"><summary className={summary}>Supplier Pricing breakdown</summary>
        <p className="mt-2 text-xs">Physical footprint: {bytes(report.supplier_bytes)} including {bytes(report.supplier_index_bytes)} of indexes. Per-table sizes include indexes; do not add the index total again. Full logical row size is not sampled.</p>
        <p className="mt-1 text-xs">Current active: {report.sources.current} · Previous: {report.sources.previous} · Archived: {report.sources.archived} · Upcoming: {report.sources.upcoming} · In progress: {report.sources.update_in_progress} · Unfinished: {report.sources.unfinished} · Compacted: {report.sources.compacted} (overlaps lifecycle states)</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><caption className="text-left text-zinc-500">Source versions, identities, matches, decisions, review units, remaining rows/cells and receipts/chunks · approximate rows</caption><thead><tr><th className={cell}>Object</th><th className={cell}>Approx rows</th><th className={cell}>Data</th><th className={cell}>Indexes</th><th className={cell}>Total</th></tr></thead><tbody>{supplierTables.map((table) => <tr key={table.name} className="border-t border-zinc-100"><td className={cell}>{table.name}</td><td className={cell}>{table.rows?.toLocaleString("en-US") ?? "Unknown"}</td><td className={cell}>{bytes(table.table_bytes)}</td><td className={cell}>{bytes(table.index_bytes)}</td><td className={cell}>{bytes(table.total_bytes)}</td></tr>)}</tbody></table></div>
      </details>
      <details id="storage-buckets" className="rounded-md border border-zinc-200 bg-white p-3"><summary className={summary}>Storage buckets</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><caption className="text-left text-zinc-500">Metadata only; no downloads. Missing sizes make totals unknown; known subtotals are shown separately.</caption><thead><tr>{["Bucket", "Objects", "Total", "Known subtotal", "Largest known object", "Missing sizes"].map((title) => <th key={title} className={cell}>{title}</th>)}</tr></thead><tbody>{report.buckets.map((bucket) => <tr key={bucket.name} className="border-t border-zinc-100"><td className={cell}>{bucket.name}</td><td className={cell}>{bucket.objects.toLocaleString("en-US")}</td><td className={cell}>{bucket.unknown_sizes ? "Unknown" : bytes(bucket.total_bytes)}</td><td className={cell}>{bytes(bucket.total_bytes)}</td><td className={cell}>{bytes(bucket.largest_bytes)}</td><td className={cell}>{bucket.unknown_sizes}</td></tr>)}</tbody></table>{!report.buckets.length ? <p className="text-xs text-zinc-500">No Storage buckets.</p> : null}</div></details>
    </div>
  </div>;
}

function bucket(report: SystemCapacityReport, name: string): CapacityBucket {
  return report.buckets.find((entry) => entry.name === name) ?? { name, objects: 0, total_bytes: 0, largest_bytes: null, unknown_sizes: 0 };
}

const cleanupBuckets = [
  { name: "supplier-price-sources", label: "Supplier price-source files" },
  { name: "product-images", label: "Product images" },
  { name: "quote-images", label: "Quote images" },
] as const;

export function StorageCleanupAnalyzer({ report, onReport }: { report: SystemCapacityReport; onReport?: (report: SystemCapacityReport) => void }) {
  const cleanup = report.storage_cleanup;
  const sourceBucket = bucket(report, "product-source-files");
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const totalStorage = report.storage_bytes ?? report.buckets.reduce((sum, entry) => sum + entry.total_bytes, 0);
  const reclaimable = cleanup?.reclaimable ?? { objects: 0, bytes: null };
  const temporary = cleanup?.temporary ?? { objects: 0, bytes: null };
  const review = cleanup?.review ?? [];
  const clean = () => {
    if (!cleanup || !cleanup.candidates.length || !window.confirm(`Delete ${cleanup.candidates.length} temporary Product Source QA PDFs and reclaim approximately ${bytes(cleanup.reclaimable.bytes)}?\n\nThese files are not referenced by saved Product data.`)) return;
    const reclaimed = cleanup.reclaimable.bytes;
    startTransition(async () => {
      const result = await cleanTemporaryProductSources(cleanup.candidates.map((candidate) => candidate.path));
      setMessage(result.ok ? `${cleanup.candidates.length} temporary Source QA files removed. ${bytes(reclaimed)} reclaimed.` : result.message);
      if (result.report) onReport?.(result.report);
    });
  };
  return <section className={`${card} md:col-span-2`} aria-label="Storage cleanup">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-zinc-900">STORAGE CLEANUP</h3><p className="mt-1 text-xs text-zinc-500">Storage files are evaluated separately from database reclaimable technical data.</p></div></div>
    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><div className="rounded-md bg-zinc-50 px-3 py-2"><dt className="text-zinc-500">Persistent Storage</dt><dd className="font-semibold tabular-nums">{bytes(totalStorage)}</dd></div><div className="rounded-md bg-zinc-50 px-3 py-2"><dt className="text-zinc-500">Safely reclaimable</dt><dd className="font-semibold tabular-nums">{bytes(reclaimable.bytes)}</dd></div>{temporary.objects > 0 ? <div className="rounded-md bg-zinc-50 px-3 py-2"><dt className="text-zinc-500">Potential after grace period</dt><dd className="font-semibold tabular-nums">{bytes(temporary.bytes)}</dd></div> : null}</dl>
    <section className="mt-4 rounded-md border border-emerald-200 bg-emerald-50/40 p-3" aria-label="Product Source QA PDFs cleanup">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-emerald-950">Product Source QA PDFs</h4><p className="mt-1 text-sm font-semibold tabular-nums text-zinc-950">{sourceBucket.unknown_sizes ? "Unknown size" : bytes(sourceBucket.total_bytes)} <span className="text-xs font-normal text-zinc-600">· {sourceBucket.objects.toLocaleString("en-US")} files</span></p></div><div className="flex gap-2"><button type="button" className={button} onClick={() => setReviewOpen((open) => !open)}>{reviewOpen ? "Hide files" : "Review files"}</button><button type="button" className={button} disabled={busy || cleanup?.status !== "available" || reclaimable.objects === 0} onClick={clean}>{busy ? "Cleaning…" : "Clean safe files"}</button></div></div>
      {cleanup ? <><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><div><dt className="text-zinc-500">Active / referenced</dt><dd className="font-semibold">{cleanup.active.objects}</dd></div><div><dt className="text-zinc-500">Protected by grace period</dt><dd className="font-semibold">{temporary.objects}</dd></div><div><dt className="text-zinc-500">Safe to clean</dt><dd className="font-semibold">{reclaimable.objects}</dd></div></dl><p className="mt-2 text-xs text-zinc-600">Reclaimable: <b>{bytes(reclaimable.bytes)}</b>. Unreferenced Source QA PDFs become eligible for cleanup after {cleanup.graceDays} days.</p>{reclaimable.objects === 0 ? <p className="mt-2 text-xs text-zinc-600">No files are currently eligible for cleanup.{temporary.objects ? ` ${temporary.objects} file${temporary.objects === 1 ? " is" : "s are"} within the ${cleanup.graceDays}-day grace period.` : ""}</p> : null}</> : <p className="mt-3 text-xs text-zinc-600">Cleanup analysis not available yet.</p>}
      {reviewOpen ? <div className="mt-3 max-h-64 overflow-y-auto rounded border border-emerald-100 bg-white p-2 text-xs"><p className="mb-2 font-semibold">Review files</p>{review.length ? <ul className="space-y-2">{review.map((file) => <li key={file.path} className="rounded bg-zinc-50 p-2"><p className="font-medium">{file.path.split("/").at(-1)}</p><p className="mt-1 text-zinc-600">{bytes(file.bytes)} · Uploaded {file.createdAt ? date(file.createdAt) : "Unknown"} · {file.ageDays === null ? "Age unknown" : `${file.ageDays} days old`}</p><p className="mt-1"><b>{file.state === "active" ? "Referenced" : file.state === "temporary" ? "Protected by grace period" : "Reclaimable"}</b> · {file.reason}</p></li>)}</ul> : <p className="text-zinc-500">No Source QA files are available to review.</p>}</div> : null}
    </section>
    <div className="mt-3 grid gap-2 md:grid-cols-3">{cleanupBuckets.map((entry) => { const usage = bucket(report, entry.name); const status = cleanup?.buckets.find((item) => item.bucket === entry.name); return <section key={entry.name} className="rounded-md border border-zinc-200 p-3 text-xs"><h4 className="font-semibold text-zinc-900">{entry.label}</h4><p className="mt-1 tabular-nums">{usage.unknown_sizes ? "Unknown size" : bytes(usage.total_bytes)} · {usage.objects.toLocaleString("en-US")} objects</p><p className="mt-2 text-zinc-600">{status?.status === "managed_elsewhere" ? status.detail : "Automatic cleanup not enabled."}</p><a href="#storage-buckets" className="mt-2 inline-block font-semibold text-emerald-900">View usage</a></section>; })}</div>
    <p className="mt-3 text-xs text-zinc-500">{cleanup?.quotationPdfNote ?? "Generated quotation and document PDFs are created on demand and are not stored persistently."}</p><p role="status" aria-live="polite" className="mt-2 text-xs text-zinc-700">{message || cleanup?.message}</p>
  </section>;
}
