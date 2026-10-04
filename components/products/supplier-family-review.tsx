"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FamilyOverview, FamilyRow, FamilySection } from "@/lib/products/supplier-price-repository";
import { bulkApplySupplierChangedPrices, bulkConfirmSupplierUnchanged, bulkExcludeSupplierMissing } from "@/app/products/price-updates/supplier-sources/actions";

const input = "rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm";
const button = "rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const primary = "rounded border border-zinc-800 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const badge = "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium";
const statusLabel: Record<string, [string, string]> = {
  ready: ["Ready", "border-emerald-200 bg-emerald-50 text-emerald-800"],
  completed: ["Completed", "border-emerald-200 bg-emerald-50 text-emerald-800"],
  needs_review: ["Needs review", "border-amber-200 bg-amber-50 text-amber-800"],
  needs_attention: ["Needs attention", "border-red-200 bg-red-50 text-red-800"],
};

/** Selection helpers are pure so the bounded behavior is testable without rendering. */
export const selectAllKeys = (keys: string[], limit: number) => ({ keys: keys.slice(0, limit), truncated: keys.length > limit });
export const toggleKey = (current: string[], key: string, on: boolean, limit: number) =>
  on ? (current.includes(key) || current.length >= limit ? current : [...current, key]) : current.filter((item) => item !== key);

export type FamilyLink = { template_id: string; href: string };

export function SupplierFamilyList({ overview, links, approverNote, advancedHref, supplierOnlyHref }: { overview: FamilyOverview; links: FamilyLink[]; approverNote?: string; advancedHref: string; supplierOnlyHref: string }) {
  const { totals, families, supplierOnly } = overview;
  const href = new Map(links.map((link) => [link.template_id, link.href]));
  return <div className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="font-semibold">{totals.families} {totals.families === 1 ? "Family" : "Families"}</h3>
      <Link href={advancedHref} className="text-xs underline">Advanced / Technical Review</Link>
    </div>
    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">{([["Ready", totals.ready], ["Changed", totals.changed], ["Same to confirm", totals.same], ["Missing to review", totals.missing], ["Needs attention", totals.attention]] as const).map(([label, value]) =>
      <div key={label} className={`rounded border p-2 ${value > 0 && label !== "Ready" ? "border-amber-300 bg-amber-50" : "border-zinc-200"}`}><dt>{label}</dt><dd className="text-base font-semibold tabular-nums">{value}</dd></div>)}</dl>
    {approverNote ? <p className="text-xs text-zinc-600">{approverNote}</p> : null}
    {families.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-xs">
      <thead><tr className="border-b bg-zinc-50"><th className="p-2">Family</th><th className="p-2 text-right">Items</th><th className="p-2 text-right">Changed</th><th className="p-2 text-right">Same</th><th className="p-2 text-right">Missing</th><th className="p-2 text-right">Needs attention</th><th className="p-2">Status</th><th className="p-2"><span className="sr-only">Open</span></th></tr></thead>
      <tbody>{families.map((family) => { const [label, tone] = statusLabel[family.status]; return <tr key={family.template_id} className="border-b">
        <th scope="row" className="p-2 font-semibold">{family.template_name}</th>
        <td className="p-2 text-right tabular-nums">{family.items}</td>
        {([family.changed, family.same, family.missing, family.attention] as const).map((count, index) => <td key={index} className={`p-2 text-right tabular-nums ${count ? "font-semibold" : "text-zinc-400"}`}>{count}</td>)}
        <td className="p-2"><span className={`${badge} ${tone}`}>{label}</span></td>
        <td className="p-2 text-right"><Link href={href.get(family.template_id) ?? "#"} className="underline" aria-label={`Review family ${family.template_name}`}>Review family</Link></td>
      </tr>; })}</tbody></table></div>
      : <p className="rounded border border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-600">No Product Families in this comparison. Check the source scope in Advanced Review.</p>}
    <details className="rounded border border-zinc-200 p-2 text-xs"><summary className="cursor-pointer">Supplier-only items: {supplierOnly.unmatched.toLocaleString("en-US")}</summary>
      <p className="mt-1 text-zinc-600">Items in the Supplier source that ProjectWorkflow does not carry. Informational only; they never block completion and create no Products.{supplierOnly.companions ? ` ${supplierOnly.companions} referenced companion note(s) are kept as evidence.` : ""}</p>
      <Link href={supplierOnlyHref} className="mt-1 inline-block underline">View in Advanced Review</Link></details>
  </div>;
}

type Tab = { section: FamilySection; label: string; count: number; href: string };
export function SupplierFamilyTable({ batchId, familyName, section, tabs, rows, truncated, approver, batchOpen, limit, backHref, detailsHref }: {
  batchId: string; familyName: string; section: FamilySection; tabs: Tab[]; rows: FamilyRow[]; truncated: boolean; approver: boolean; batchOpen: boolean; limit: number; backHref: string; detailsHref: string;
}) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]); const [asking, setAsking] = useState(false); const [reason, setReason] = useState("");
  const selectable = rows.filter((row) => row.selectable).map((row) => row.key);
  const canAct = approver && batchOpen && section !== "attention" && selectable.length > 0;
  async function run(work: () => Promise<{ message: string }>) { setBusy(true); setMessage(""); try { const result = await work(); setSelected([]); setAsking(false); setReason(""); setMessage(result.message); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed."); } finally { setBusy(false); } }
  const act = {
    changed: { label: `Apply ${selected.length} price${selected.length === 1 ? "" : "s"}`, go: () => run(() => bulkApplySupplierChangedPrices(batchId, selected)) },
    same: { label: `Confirm ${selected.length} unchanged`, go: () => run(() => bulkConfirmSupplierUnchanged(batchId, selected)) },
    missing: { label: `Exclude ${selected.length} from this source`, go: () => setAsking(true) },
    attention: null,
  }[section];
  const pick = selectAllKeys(selectable, limit);
  const columns = section === "attention" ? ["Code", "Item", "Issue", "Recommended action", ""] : ["Code", "Item / size", "Current", "Supplier", "Change"];
  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><div><Link href={backHref} className="text-xs underline">← Back to Family Review</Link><h3 className="text-base font-semibold">{familyName}</h3><p className="text-xs text-zinc-600">{tabs[0].count} Changed · {tabs[1].count} Same · {tabs[2].count} Missing{tabs[3].count ? ` · ${tabs[3].count} Needs attention` : ""}</p></div><Link href={detailsHref} className="text-xs underline">Advanced / Technical Review</Link></div>
    <nav aria-label="Family sections" className="flex flex-wrap gap-1">{tabs.map((tab) => <Link key={tab.section} href={tab.href} aria-current={tab.section === section ? "page" : undefined} className={`rounded border px-3 py-1.5 text-sm ${tab.section === section ? "border-zinc-800 bg-zinc-800 font-medium text-white" : "border-zinc-300 bg-white"}`}>{tab.label} <span className="tabular-nums">{tab.count}</span></Link>)}</nav>
    <p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>
    {!approver && section !== "attention" && rows.length ? <p className="text-xs text-zinc-600">An approver applies, confirms or excludes items.</p> : null}
    {canAct ? <div className="flex flex-wrap items-center gap-2 text-sm"><button type="button" className={button} disabled={busy} onClick={() => setSelected(pick.keys)}>Select all</button><button type="button" className={button} disabled={busy || !selected.length} onClick={() => setSelected([])}>Clear selection</button><span aria-live="polite" className="tabular-nums">{selected.length} selected</span>{pick.truncated ? <span className="text-xs text-zinc-600">Up to {limit} items at a time.</span> : null}</div> : null}
    {rows.length ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-xs">
      <thead><tr className="border-b bg-zinc-50">{canAct ? <th className="w-8 p-2"><span className="sr-only">Select</span></th> : null}{columns.map((title, index) => <th key={index} className={`p-2 ${["Current", "Supplier", "Change"].includes(title) ? "text-right" : ""}`}>{title || <span className="sr-only">Details</span>}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key} className={`border-b align-top ${selected.includes(row.key) ? "bg-amber-50" : ""}`}>
        {canAct ? <td className="p-2"><input type="checkbox" aria-label={`Select ${row.code} ${row.item}`} disabled={busy || !row.selectable || (!selected.includes(row.key) && selected.length >= limit)} checked={selected.includes(row.key)} onChange={(event) => setSelected((current) => toggleKey(current, row.key, event.target.checked, limit))} /></td> : null}
        <td className="p-2 font-mono font-semibold">{row.code}</td><td className="p-2">{row.item}</td>
        {section === "attention" ? <><td className="p-2">{row.issue}</td><td className="p-2 text-zinc-600">{row.action}</td><td className="p-2"><Link className="underline" href={`${detailsHref}&status=${row.classification}&code=${encodeURIComponent(row.code)}`}>Review details</Link></td></>
          : <><td className="p-2 text-right tabular-nums">{row.current}</td><td className="p-2 text-right tabular-nums">{row.supplier}</td><td className={`p-2 text-right tabular-nums ${section === "changed" && !row.selectable ? "text-emerald-800" : section === "changed" ? "font-medium" : "text-zinc-600"}`}>{row.change}</td></>}
      </tr>)}</tbody></table>{truncated ? <p className="p-2 text-xs text-zinc-600">Showing the first 500 items. Apply or confirm these, then refresh for the rest.</p> : null}</div>
      : <p className="rounded border border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-600">{{ changed: "No price changes waiting in this Family.", same: "No unchanged prices waiting for confirmation.", missing: "Nothing missing from the Supplier source.", attention: "Nothing needs attention in this Family." }[section]}</p>}
    {canAct && act && selected.length ? <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded border border-zinc-300 bg-white p-3 shadow-sm" role="region" aria-label="Bulk action">
      {asking ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (!reason.trim()) { setMessage("Enter a reason before excluding."); return; } void run(() => bulkExcludeSupplierMissing(batchId, selected, reason)); }}>
        <label className="grid gap-1 text-xs">Reason for excluding {selected.length} selected item{selected.length === 1 ? "" : "s"}<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={4000} required className={`${input} w-72`} /></label>
        <button type="button" className={button} disabled={busy} onClick={() => { setAsking(false); setReason(""); }}>Cancel</button><button className={primary} disabled={busy}>Exclude {selected.length} item{selected.length === 1 ? "" : "s"}</button></form>
        : <><span className="text-sm tabular-nums">{selected.length} selected</span><button type="button" className={primary} disabled={busy} onClick={() => void act.go()}>{act.label}</button><button type="button" className={button} disabled={busy} onClick={() => setSelected([])}>Clear</button></>}
    </div> : null}
  </div>;
}

export function SupplierBrandProgress({ overview }: { overview: FamilyOverview }) {
  const { totals } = overview;
  return <section className="space-y-1 rounded border border-zinc-300 p-3 text-sm" aria-label="Brand review progress">
    <h3 className="font-semibold">Brand Review Progress</h3>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-5">{([["Families ready", `${totals.ready} / ${totals.families}`], ["Changed remaining", totals.changed], ["Same to confirm", totals.same], ["Missing to review", totals.missing], ["Needs attention", totals.attention]] as const).map(([label, value]) =>
      <div key={label}><dt className="text-xs text-zinc-600">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>
  </section>;
}
