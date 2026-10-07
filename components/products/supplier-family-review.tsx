"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FamilyOverview, FamilyRow, FamilySection, SupplierSourceInspectorDetail, SourceTierPanel, SourceTierTask, SourceMappedTier } from "@/lib/products/supplier-price-repository";
import { bulkApplySupplierChangedPrices, bulkConfirmSupplierUnchanged, bulkExcludeSupplierMissing, saveSupplierDimension, replaceSupplierDimension, archiveSupplierDimension, refreshSupplierReviewAfterMapping, supplierSourceInspectorDetails } from "@/app/products/price-updates/supplier-sources/actions";

// ProjectWorkflow patterns: white card, light border and shadow, emerald primary, zinc secondary.
const card = "rounded-lg border border-zinc-200 bg-white shadow-sm";
const input = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const secondary = "inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const badge = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold";
const th = "px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500";
const statusLabel: Record<string, [string, string, string]> = {
  ready: ["✓", "Ready", "border-emerald-200 bg-emerald-50 text-emerald-900"],
  completed: ["✓", "Completed", "border-emerald-200 bg-emerald-50 text-emerald-900"],
  needs_review: ["●", "Needs review", "border-amber-200 bg-amber-50 text-amber-900"],
  needs_attention: ["⚠", "Needs attention", "border-red-200 bg-red-50 text-red-900"],
};

/** Selection helpers are pure so the bounded behavior is testable without rendering. */
export const selectAllKeys = (keys: string[], limit: number) => ({ keys: keys.slice(0, limit), truncated: keys.length > limit });
export const toggleKey = (current: string[], key: string, on: boolean, limit: number) =>
  on ? (current.includes(key) || current.length >= limit ? current : [...current, key]) : current.filter((item) => item !== key);
export const supplierKeyChunks = (keys: string[], limit: number) => Array.from({ length: Math.ceil(keys.length / limit) }, (_, index) => keys.slice(index * limit, (index + 1) * limit));
export async function runSupplierKeyChunks<T>(keys: string[], limit: number, work: (chunk: string[]) => Promise<T>) {
  const results: T[] = [];
  for (const chunk of supplierKeyChunks(keys, limit)) results.push(await work(chunk));
  return results;
}

export const optionalSupplierRuleId = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return !trimmed || trimmed === "undefined" || trimmed === "null" ? undefined : trimmed;
};

export type FamilyLink = { template_id: string; href: string };

export function suggestSupplierTier(label: string, dimensions: string[]) {
  const comparable = (value: string) => value.trim().toLowerCase().replace(/^(?:cat|category|tier)[\s_-]+/, "").replace(/[^a-z0-9]/g, "");
  const candidates = dimensions.filter((dimension) => comparable(dimension) === comparable(label));
  return candidates.length === 1 ? candidates[0] : "";
}
type MappingChange = (work: () => Promise<unknown>) => Promise<void>;

function FinishCodes({ codes }: { codes: string[] }) {
  return codes.length ? <details className="text-xs text-zinc-600"><summary className="cursor-pointer">View finish codes</summary><p className="mt-1 break-words">{codes.join(", ")}</p></details> : null;
}

function UnmappedSupplierTier({ task, brandId, approver, busy, onChangeAction }: { task: SourceTierTask; brandId: string; approver: boolean; busy: boolean; onChangeAction: MappingChange }) {
  const [dimension, setDimension] = useState(() => suggestSupplierTier(task.label, task.dimensions));
  return <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3"><div className="flex flex-wrap items-center gap-2"><strong>{task.label}</strong><span className="text-xs text-zinc-600">Scope: {task.scopeName} · Affects {task.affected} Product rows</span></div>
    <div className="flex flex-wrap items-center gap-2"><label className="text-xs">Suggested Product category <select aria-label={`Product category for ${task.label}`} className={input} value={dimension} disabled={!approver || busy} onChange={(event) => setDimension(event.target.value)}><option value="">Choose category / tier</option>{task.dimensions.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
    {approver ? <button type="button" className={primary} disabled={busy || !dimension} onClick={() => void onChangeAction(() => saveSupplierDimension({ brand_id: brandId, template_id: optionalSupplierRuleId(task.templateId), group_id: optionalSupplierRuleId(task.groupId), raw_labels: task.rawLabels, finish_codes: task.finishCodes, dimension_code: dimension }))}>Save mapping</button> : null}</div>
    <FinishCodes codes={task.finishCodes} /><details className="text-xs"><summary className="cursor-pointer">View affected codes</summary><p className="mt-1 font-mono">{task.codes.join(", ")}</p></details></div>;
}

function MappedSupplierTier({ item, brandId, approver, busy, onChangeAction }: { item: SourceMappedTier; brandId: string; approver: boolean; busy: boolean; onChangeAction: MappingChange }) {
  const { rule } = item; const [editing, setEditing] = useState(false); const [dimension, setDimension] = useState(rule.dimension_code);
  return <div className="space-y-2 border-t border-zinc-100 py-2"><div className="flex flex-wrap items-center gap-2"><strong>{item.label}</strong><span aria-hidden="true">→</span>{editing ? <><select aria-label={`Edit Product category for ${item.label}`} className={input} value={dimension} disabled={busy} onChange={(event) => setDimension(event.target.value)}><option value="">Choose category / tier</option>{item.dimensions.map((code) => <option key={code} value={code}>{code}</option>)}</select><button type="button" className={primary} disabled={busy || !dimension} onClick={() => void onChangeAction(async () => { await replaceSupplierDimension(rule.id, brandId, dimension); setEditing(false); })}>Save changes</button><button type="button" className={secondary} disabled={busy} onClick={() => setEditing(false)}>Cancel</button></> : <span>{rule.dimension_code}</span>}<span className="text-xs text-zinc-600">Scope: {item.scopeName} · Affects {item.affected} Product rows</span>
    {approver && !editing ? <><button type="button" className={secondary} disabled={busy} onClick={() => { setDimension(rule.dimension_code); setEditing(true); }}>Edit</button><button type="button" className={secondary} disabled={busy} onClick={() => { if (window.confirm(`Unmap ${item.label} → ${rule.dimension_code}?`)) void onChangeAction(() => archiveSupplierDimension(rule.id)); }}>Unmap</button></> : null}</div><FinishCodes codes={rule.finish_codes} /></div>;
}

export function SupplierTierMappingPanel({ panel, brandId, sourceId, batchId, approver }: { panel: SourceTierPanel; brandId: string; sourceId: string; batchId?: string; approver: boolean }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function change(work: () => Promise<unknown>) {
    if (!approver || busy) return;
    setBusy(true); setMessage(""); let saved = false;
    try {
      await work(); saved = true;
      const result = await refreshSupplierReviewAfterMapping(sourceId, batchId);
      if (result.id) {
        setMessage("Mapping updated. Review updated.");
        const params = new URLSearchParams({ brand: brandId, source: sourceId, batch: result.id, view: "family" });
        router.push(`/products/price-updates/supplier-sources?${params}`);
      } else setMessage("Mapping updated for future comparisons.");
      router.refresh();
    } catch (error) {
      setMessage(`${saved ? "Mapping updated, but the review could not be refreshed. " : ""}${error instanceof Error ? error.message : "Could not update mapping."}`);
      if (saved) router.refresh();
    } finally { setBusy(false); }
  }
  return <section id="supplier-tier-mapping" className={`${card} space-y-3 p-4`} aria-label="Supplier tier mapping"><h4 className="text-sm font-semibold">Supplier tier mapping</h4><div className="flex gap-2 text-xs"><span className="rounded bg-amber-50 px-2 py-1 text-amber-900">{panel.unmapped.length} unmapped</span><span className="rounded bg-emerald-50 px-2 py-1 text-emerald-900">{panel.mapped.length} mapped</span>{panel.ambiguous.length ? <span className="rounded bg-red-50 px-2 py-1 text-red-900">{panel.ambiguous.length} conflicts</span> : null}</div>
    {panel.unmapped.map((task) => <UnmappedSupplierTier key={task.key} task={task} brandId={brandId} approver={approver} busy={busy} onChangeAction={change} />)}
    {panel.ambiguous.map((task) => <p key={task.key} className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900">{task.label} · {task.scopeName}: existing mappings need review. Edit or unmap the conflicting rules below.</p>)}
    <details className="text-sm"><summary className="cursor-pointer font-medium">Mapped Supplier tiers ({panel.mapped.length})</summary><div className="mt-2">{panel.mapped.map((item) => <MappedSupplierTier key={`${item.rule.id}:${item.rule.dimension_code}`} item={item} brandId={brandId} approver={approver} busy={busy} onChangeAction={change} />)}</div></details><p role="status" aria-live="polite" className="text-xs">{message}</p></section>;
}

export function SupplierFamilyList({ overview, links, approverNote, advancedHref, supplierOnlyHref, continueHref }: { overview: FamilyOverview; links: FamilyLink[]; approverNote?: string; advancedHref: string; supplierOnlyHref: string; continueHref?: string }) {
  const { totals, families, supplierOnly } = overview;
  const href = new Map(links.map((link) => [link.template_id, link.href]));
  return <div className="space-y-3">
    <section className={`${card} overflow-hidden`} aria-label="Product families">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-950">{totals.families} {totals.families === 1 ? "Family" : "Families"}</h3>
        <Link href={advancedHref} className={secondary}>Advanced / Technical Review</Link>
      </div>
      {approverNote ? <p className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-600">{approverNote}</p> : null}
      {families.length ? <div className="overflow-x-auto"><table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50"><tr className="text-left"><th className={th}>Family</th><th className={`${th} text-right`}>Items</th><th className={`${th} text-right`}>Changed</th><th className={`${th} text-right`}>Same</th><th className={`${th} text-right`}>Missing</th><th className={`${th} text-right`}>Needs attention</th><th className={th}>Status</th><th className={th}><span className="sr-only">Open</span></th></tr></thead>
        <tbody className="divide-y divide-zinc-100">{families.map((family) => { const [icon, label, tone] = statusLabel[family.status]; return <tr key={family.template_id} className="transition hover:bg-zinc-50">
          <th scope="row" className="px-3 py-2 text-left font-semibold text-zinc-950">{family.template_name}</th>
          <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{family.items}</td>
          {([family.changed, family.same, family.missing, family.attention] as const).map((count, index) => <td key={index} className={`px-3 py-2 text-right tabular-nums ${count ? "font-semibold text-zinc-950" : "text-zinc-400"}`}>{count}</td>)}
          <td className="px-3 py-2"><span className={`${badge} ${tone}`}><span aria-hidden="true">{icon}</span>{label}</span></td>
          <td className="px-3 py-2 text-right"><Link href={href.get(family.template_id) ?? "#"} className={secondary} aria-label={`Review family ${family.template_name}`}>Review family</Link></td>
        </tr>; })}</tbody></table></div>
        : <p className="px-4 py-10 text-center text-sm text-zinc-500">No Product Families in this comparison. Check the source scope in Advanced Review.</p>}
    </section>
    <details className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm"><summary className="cursor-pointer list-none text-zinc-700"><span className="font-medium">Supplier-only items: {supplierOnly.unmatched.toLocaleString("en-US")}</span> <span className="text-xs text-zinc-500">· Informational only — not part of Product review</span></summary>
      <p className="mt-2 text-xs text-zinc-600">Items in the Supplier source that ProjectWorkflow does not carry. They never block completion and create no Products.{supplierOnly.companions ? ` ${supplierOnly.companions} referenced companion note(s) are kept as evidence.` : ""}</p>
      <Link href={supplierOnlyHref} className={`${secondary} mt-2`}>View in Advanced Review</Link></details>
    {continueHref ? <div className="flex justify-end"><Link href={continueHref} className={primary}>Continue to Complete Review</Link></div> : null}
  </div>;
}

type Tab = { section: FamilySection; label: string; count: number; href: string };
export function SupplierFamilyTable({ batchId, familyName, section, tabs, rows, truncated, approver, batchOpen, limit, backHref, detailsHref, sourceId, sourceTitle, sourceDefinitionName, basisBlocked = false, familyUnchangedKeys = [], familyUnchangedAction = "confirm" }: {
  batchId: string; brandId: string; familyName: string; section: FamilySection; tabs: Tab[]; rows: FamilyRow[]; truncated: boolean; approver: boolean; batchOpen: boolean; limit: number; backHref: string; detailsHref: string; sourceId: string; sourceTitle: string; sourceDefinitionName?: string; basisBlocked?: boolean; familyUnchangedKeys?: string[]; familyUnchangedAction?: "confirm" | "finish";
}) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]); const [asking, setAsking] = useState(false); const [reason, setReason] = useState(""); const [detailRow, setDetailRow] = useState<FamilyRow | null>(null); const [sourceDetail, setSourceDetail] = useState<SupplierSourceInspectorDetail | null>(null); const [detailBusy, setDetailBusy] = useState(false);
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
  const columns = section === "attention" ? ["Code", "Item", "Issue", "Recommended action", "", ""] : ["Code", "Item / size", "Current", "Supplier", "Change", "", ""];
  const openInspector = (code: string) => window.dispatchEvent(new CustomEvent("supplier-source-inspector", { detail: { code } }));
  const confirmFamilyUnchanged = async () => { await runSupplierKeyChunks(familyUnchangedKeys, limit, (keys) => bulkConfirmSupplierUnchanged(batchId, keys)); return { message: `${familyUnchangedKeys.length} unchanged price${familyUnchangedKeys.length === 1 ? "" : "s"} confirmed.` }; };
  async function reviewDetails(row: FamilyRow) { setDetailRow(row); setSourceDetail(null); if (!row.sourceIdentityKey) return; setDetailBusy(true); try { setSourceDetail(await supplierSourceInspectorDetails(sourceId, row.sourceIdentityKey)); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load source details."); } finally { setDetailBusy(false); } }
  return <div className="space-y-3">
    <div className={`${card} flex flex-wrap items-start justify-between gap-3 p-4`}>
      <div><Link href={backHref} className="text-xs font-semibold text-zinc-600 underline-offset-2 hover:underline">← Back to Family Review</Link><h3 className="mt-1 text-base font-semibold text-zinc-950">{familyName}</h3>
        <p className="text-xs text-zinc-500">{tabs[0].count} Changed · {tabs[1].count} Same · {tabs[2].count} Missing{tabs[3].count ? ` · ${tabs[3].count} Needs attention` : ""}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={secondary} onClick={() => openInspector("")}>View extracted data</button><Link href={detailsHref} className={secondary}>Advanced / Technical Review</Link></div>
    </div>
    {basisBlocked ? <section className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" aria-label="Price basis blocker"><p>Price basis must be confirmed for {sourceDefinitionName ?? sourceTitle} before prices can be applied.</p><a href="#supplier-price-basis" className="mt-2 inline-block font-semibold underline">Confirm source price basis</a></section> : null}
    {!basisBlocked && familyUnchangedKeys.length ? <section className={`${card} flex flex-wrap items-center justify-between gap-3 border-emerald-200 bg-emerald-50 p-4`} aria-label="Family unchanged action"><div><h4 className="font-semibold text-emerald-950">{familyUnchangedAction === "finish" ? "Changed prices are already reviewed" : "This Family has no price changes or blockers"}</h4><p className="text-sm text-emerald-900">{familyUnchangedKeys.length} unchanged price{familyUnchangedKeys.length === 1 ? "" : "s"} can be confirmed together.</p></div>{approver && batchOpen ? <button type="button" className={primary} disabled={busy} onClick={() => void run(confirmFamilyUnchanged)}>{familyUnchangedAction === "finish" ? "Finish family review" : "Confirm family unchanged"}</button> : <p className="text-xs text-emerald-900">An approver can confirm this Family unchanged.</p>}</section> : null}
    <nav aria-label="Family sections" className="inline-flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">{tabs.map((tab) => <Link key={tab.section} href={tab.href} aria-current={tab.section === section ? "page" : undefined}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${tab.section === section ? "bg-emerald-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>{tab.label}<span className={`rounded-full px-1.5 text-xs tabular-nums ${tab.section === section ? "bg-white/20" : "bg-zinc-100 text-zinc-700"}`}>{tab.count}</span></Link>)}</nav>
    <p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>
    {!approver && section !== "attention" && rows.length ? <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">An approver applies, confirms or excludes items.</p> : null}
    <section className={`${card} overflow-hidden`}>
      {canAct ? <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"><button type="button" className={secondary} disabled={busy} onClick={() => setSelected(pick.keys)}>Select all</button><button type="button" className={secondary} disabled={busy || !selected.length} onClick={() => setSelected([])}>Clear selection</button><span aria-live="polite" className="tabular-nums text-zinc-600">{selected.length} selected</span>{pick.truncated ? <span className="text-xs text-zinc-500">Up to {limit} items at a time.</span> : null}</div> : null}
      {rows.length ? <div className="overflow-x-auto"><table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50"><tr className="text-left">{canAct ? <th className={`${th} w-10`}><span className="sr-only">Select</span></th> : null}{columns.map((title, index) => <th key={index} className={`${th} ${["Current", "Supplier", "Change"].includes(title) ? "text-right" : ""}`}>{title || <span className="sr-only">Details</span>}</th>)}</tr></thead>
        <tbody className="divide-y divide-zinc-100">{rows.map((row) => <tr key={row.key} className={`align-top transition hover:bg-zinc-50 ${selected.includes(row.key) ? "bg-emerald-50/60" : ""}`}>
          {canAct ? <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4 accent-emerald-900" aria-label={`Select ${row.code} ${row.item}`} disabled={busy || !row.selectable || (!selected.includes(row.key) && selected.length >= limit)} checked={selected.includes(row.key)} onChange={(event) => setSelected((current) => toggleKey(current, row.key, event.target.checked, limit))} /></td> : null}
          <td className="px-3 py-2 font-mono text-xs font-semibold text-zinc-950">{row.code}</td><td className="px-3 py-2 text-zinc-700">{row.item}</td>
          {section === "attention" ? <><td className="px-3 py-2"><span className={`${badge} border-amber-200 bg-amber-50 text-amber-900`}><span aria-hidden="true">⚠</span>{row.issue}</span></td><td className="px-3 py-2 text-xs text-zinc-600">{row.action}</td><td className="px-3 py-2 text-right"><button type="button" className={secondary} onClick={() => openInspector(row.productCode)}>View source</button></td><td className="px-3 py-2 text-right"><button type="button" className={secondary} onClick={() => void reviewDetails(row)}>Review details</button></td></>
            : <><td className="px-3 py-2 text-right tabular-nums text-zinc-700">{row.current}</td><td className="px-3 py-2 text-right tabular-nums text-zinc-950">{row.supplier}</td><td className={`px-3 py-2 text-right tabular-nums ${section === "changed" && !row.selectable ? "font-semibold text-emerald-800" : section === "changed" ? "font-semibold text-zinc-950" : "text-zinc-500"}`}>{row.change}</td></>}
          {section !== "attention" ? <><td className="px-3 py-2 text-right"><button type="button" className={secondary} onClick={() => openInspector(row.productCode)}>View source</button></td><td className="px-3 py-2 text-right"><button type="button" className={secondary} onClick={() => void reviewDetails(row)}>Review details</button></td></> : null}
        </tr>)}</tbody></table>{truncated ? <p className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500">Showing the first 500 items. Apply or confirm these, then refresh for the rest.</p> : null}</div>
        : <p className="px-4 py-10 text-center text-sm text-zinc-500">{{ changed: "No price changes waiting in this Family.", same: "No unchanged prices waiting for confirmation.", missing: "Nothing missing from the Supplier source.", attention: "Nothing needs attention in this Family." }[section]}</p>}
    </section>
    {detailRow ? <section className={`${card} space-y-3 p-4`} aria-label="Supplier review details"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold text-zinc-950">Review details</h4><p className="text-xs text-zinc-500">{familyName} · {detailRow.item}</p></div><button type="button" className={secondary} onClick={() => { setDetailRow(null); setSourceDetail(null); }}>Close details</button></div><div className="grid gap-3 text-sm md:grid-cols-2"><div><h5 className="font-semibold text-zinc-800">Product</h5><dl className="mt-1 grid gap-1"><div><dt className="text-zinc-500">Product / Supplier code</dt><dd className="font-mono">{detailRow.productCode}</dd></div><div><dt className="text-zinc-500">Current Product price</dt><dd>{detailRow.current}</dd></div><div><dt className="text-zinc-500">Product price field</dt><dd>{detailRow.productPriceField || "—"}</dd></div><div><dt className="text-zinc-500">Category / tier</dt><dd>{detailRow.productDimension || "—"}</dd></div></dl></div><div><h5 className="font-semibold text-zinc-800">Supplier source</h5>{!detailRow.sourceIdentityKey ? <p className="mt-1 text-zinc-700">No Supplier identity exists for this Product target. This is why it is listed as Missing.</p> : detailBusy ? <p className="mt-1 text-zinc-600">Loading Supplier evidence…</p> : sourceDetail ? <dl className="mt-1 grid gap-1"><div><dt className="text-zinc-500">Supplier source</dt><dd>{sourceDefinitionName || "Supplier source"}</dd></div><div><dt className="text-zinc-500">Price list</dt><dd>{sourceTitle}</dd></div><div><dt className="text-zinc-500">Supplier code</dt><dd className="font-mono">{sourceDetail.code}</dd></div><div><dt className="text-zinc-500">Supplier price</dt><dd>{sourceDetail.price === null ? "Invalid" : `${sourceDetail.currency} ${sourceDetail.price}`}</dd></div><div><dt className="text-zinc-500">Price field / dimension</dt><dd>{sourceDetail.priceField} · {sourceDetail.dimension || "scalar"}</dd></div><div><dt className="text-zinc-500">Source rows</dt><dd>{sourceDetail.sourceRowCount}</dd></div></dl> : <p className="mt-1 text-zinc-600">Supplier details are unavailable.</p>}</div></div>{sourceDetail ? <><div className="flex flex-wrap gap-2 text-xs">{sourceDetail.finishes.length ? <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1">Finishes: {sourceDetail.finishes.join(", ")}</span> : null}{sourceDetail.warnings.length ? <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">Warnings: {sourceDetail.warnings.join(", ")}</span> : null}</div><div><h5 className="font-semibold text-zinc-800">Source evidence</h5>{sourceDetail.evidence.length ? <div className="mt-1 grid gap-2 md:grid-cols-2">{sourceDetail.evidence.map((evidence) => <div key={`${evidence.sheet}:${evidence.sourceRowNumber}`} className="rounded border border-zinc-200 bg-zinc-50 p-2 text-xs"><strong>{evidence.sheet}, row {evidence.sourceRowNumber}</strong>{evidence.fullCode ? <div>Full code: {evidence.fullCode}</div> : null}{evidence.articleCode ? <div>Article code: {evidence.articleCode}</div> : null}{evidence.description ? <div>Description: {evidence.description}</div> : null}{evidence.finishCode ? <div>Finish: {evidence.finishCode}</div> : null}{evidence.categoryLabel ? <div>Category / tier: {evidence.categoryLabel}</div> : null}{evidence.dimensionLabel ? <div>Dimension: {evidence.dimensionLabel}</div> : null}{evidence.rawPrice ? <div>Raw price: {evidence.rawPrice}</div> : null}</div>)}</div> : <p className="mt-1 text-xs text-zinc-600">No representative evidence is available for this legacy identity.</p>}</div></> : null}{detailRow.classification === "needs_dimension_mapping" ? <Link className="text-xs font-semibold underline" href="#supplier-tier-mapping">Manage Supplier tier mapping above</Link> : null}<div className="flex flex-wrap gap-2"><button type="button" className={secondary} onClick={() => openInspector(detailRow.productCode)}>Check source</button>{section === "attention" ? <Link className={secondary} href={`${detailsHref}&status=${detailRow.classification}&code=${encodeURIComponent(detailRow.code)}`}>Open Advanced mapping</Link> : null}</div></section> : null}
    {canAct && act && selected.length ? <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-300 bg-white p-3 shadow-lg" role="region" aria-label="Bulk action">
      {asking ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (!reason.trim()) { setMessage("Enter a reason before excluding."); return; } void run(() => bulkExcludeSupplierMissing(batchId, selected, reason)); }}>
        <label className="grid gap-1 text-xs font-medium text-zinc-700">Reason for excluding {selected.length} selected item{selected.length === 1 ? "" : "s"}<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={4000} required className={`${input} w-72`} /></label>
        <button type="button" className={secondary} disabled={busy} onClick={() => { setAsking(false); setReason(""); }}>Cancel</button><button className={primary} disabled={busy}>Exclude {selected.length} item{selected.length === 1 ? "" : "s"}</button></form>
        : <><span className="text-sm font-semibold tabular-nums text-zinc-950">{selected.length} selected</span><button type="button" className={primary} disabled={busy} onClick={() => void act.go()}>{act.label}</button><button type="button" className={secondary} disabled={busy} onClick={() => setSelected([])}>Clear</button></>}
    </div> : null}
  </div>;
}

/** Five scan-friendly cards. Colors carry meaning and the label always says it in words too. */
export function SupplierBrandProgress({ overview }: { overview: FamilyOverview }) {
  const { totals } = overview;
  const cards: Array<[string, string | number, string, string]> = [
    ["Families ready", `${totals.ready} / ${totals.families}`, "border-emerald-200 bg-emerald-50 text-emerald-950", "Nothing left to do"],
    ["Changed remaining", totals.changed, "border-sky-200 bg-sky-50 text-sky-950", "Prices to apply"],
    ["Same to confirm", totals.same, totals.same ? "border-amber-200 bg-amber-50 text-amber-950" : "border-zinc-200 bg-white text-zinc-950", "Unchanged prices"],
    ["Missing to review", totals.missing, totals.missing ? "border-amber-200 bg-amber-50 text-amber-950" : "border-zinc-200 bg-white text-zinc-950", "Not in Supplier list"],
    ["Needs attention", totals.attention, totals.attention ? "border-red-200 bg-red-50 text-red-950" : "border-zinc-200 bg-white text-zinc-950", "Blocks completion"],
  ];
  return <section aria-label="Brand review progress"><h3 className="sr-only">Brand Review Progress</h3>
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">{cards.map(([label, value, tone, helper]) => <div key={label} className={`flex min-h-[5.5rem] flex-col justify-between rounded-lg border p-3 shadow-sm ${tone}`}><dt className="text-xs font-semibold">{label}</dt><dd className="text-2xl font-semibold tabular-nums">{value}</dd><span className="text-[11px] opacity-70">{helper}</span></div>)}</dl>
  </section>;
}
