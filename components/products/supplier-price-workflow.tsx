import Link from "next/link";
import type { ReviewBatch, SourceVersion } from "@/lib/products/supplier-price-contracts";
import type { FamilyOverview } from "@/lib/products/supplier-price-repository";
import { SupplierArchiveButton } from "@/components/products/supplier-price-workspace-controls";

const card = "rounded-lg border border-zinc-200 bg-white shadow-sm";
const badge = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold";
const linkButton = "inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800";
const smallButton = "inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800";
const primaryLink = "inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
const th = "px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500";
const basisLabel = (basis: string) => basis === "list" ? "List prices" : basis === "net" ? "Net prices" : "Price basis not set";
const coverageLabel = (scope: string) => scope === "complete" ? "Complete Brand Review" : scope === "selected_templates" ? "Selected Families Review" : "Partial Review";
const reviewStatus = (status: string) => status === "completed" ? "Completed" : status === "review" ? "In progress" : status === "archived" ? "Previous review" : "Preparing";
const count = (value: number) => value.toLocaleString("en-US");

export type WorkflowStep = 1 | 2 | 3;
const stepNames = ["Import", "Family Review", "Complete"] as const;

/** Import → Family Review → Complete, plus one compact line of source context. */
export function SupplierWorkflowHeader({ brandName, source, batch, step, links }: {
  brandName: string; source?: SourceVersion; batch?: ReviewBatch; step: WorkflowStep; links: { steps: [string, string, string]; history: string; advanced: string };
}) {
  const title = source ? (source.title.toLowerCase().startsWith(brandName.toLowerCase()) ? source.title : `${brandName} — ${source.title}`) : `${brandName} — Supplier price list`;
  return <header className={`${card} space-y-3 p-4`}>
    <nav aria-label="Supplier price list steps"><ol className="flex flex-wrap items-center gap-2 text-sm">{stepNames.map((name, index) => {
      const number = (index + 1) as WorkflowStep; const state = number < step ? "done" : number === step ? "current" : "todo"; const enabled = number === 1 || Boolean(source && (number === 2 || batch));
      const mark = state === "done" ? "✓" : state === "current" ? "●" : "○";
      const tone = state === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : state === "current" ? "border-emerald-900 bg-emerald-900 text-white" : "border-zinc-200 bg-white text-zinc-500";
      const body = <><span aria-hidden="true">{mark}</span> {number} {name}<span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (current step)" : " (not started)"}</span></>;
      const shape = `inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-semibold ${tone}`;
      return <li key={name} className="flex items-center gap-2">{index ? <span aria-hidden="true" className="h-px w-4 bg-zinc-300" /> : null}{enabled ? <Link href={links.steps[index]} aria-current={state === "current" ? "step" : undefined} className={`${shape} transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800`}>{body}</Link>
        : <span className={shape}>{body}</span>}</li>;
    })}</ol></nav>
    {source ? <div className="flex flex-wrap items-start justify-between gap-3 border-t border-zinc-100 pt-3">
      <div className="min-w-0"><h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{source.currency} · {source.basis === "list" ? "List" : source.basis === "net" ? "Net" : "Basis not set"} · {source.status === "imported" ? "Imported" : source.status === "archived" ? "Archived" : "Import not finished"}{batch ? ` · ${coverageLabel(batch.scope)}` : ""}</p></div>
      <p className="flex gap-2"><a href={links.history} className={smallButton}>Price list history</a><a href={links.advanced} className={smallButton}>Advanced tools</a></p>
    </div> : null}
  </header>;
}

/** Step 1b: what was imported, and only the warnings that need a decision. */
export function SupplierImportSummary({ brandName, source, families, warnings, continueHref, detailsHref, uploading }: {
  brandName: string; source: SourceVersion; families: number | null; warnings: number | null; continueHref: string; detailsHref: string; uploading?: boolean;
}) {
  const ok = source.status === "imported";
  return <section className={`${card} space-y-3 p-4`} aria-label="Import summary">
    <div><p className="text-xs text-zinc-500">{brandName}</p><h3 className="text-base font-semibold text-zinc-950">{source.title}</h3><p className={`${badge} mt-1 ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{ok ? "✓ Imported successfully" : uploading ? "Import in progress" : "Import not finished — import the same file again to resume"}</p></div>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([["Source rows", count(source.stored_rows)], ["Supplier items", count(source.identity_count)], ["Currency", source.currency], ["Prices", basisLabel(source.basis)]] as const).map(([label, value]) =>
      <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2"><dt className="text-xs text-zinc-500">{label}</dt><dd className="text-lg font-semibold tabular-nums text-zinc-950">{value}</dd></div>)}</dl>
    {families !== null ? <p className="text-sm">{families} Product {families === 1 ? "family" : "families"} found</p> : null}
    {warnings ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">⚠ {warnings} source-data {warnings === 1 ? "issue" : "issues"} to look at during review.</p> : null}
    <div className="flex flex-wrap gap-2">{ok ? <Link href={continueHref} className={primaryLink}>Continue to Family Review</Link> : null}<Link href={detailsHref} className={linkButton}>View import details</Link></div>
  </section>;
}

/** Technical import facts, kept one click away from the summary. */
export function SupplierImportDetails({ source, workingFileUrl }: { source: SourceVersion; workingFileUrl?: string }) {
  return <details className={`${card} p-4 text-xs`} open><summary className="cursor-pointer text-sm font-semibold text-zinc-950">Import details</summary>
    <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">{[["File", source.filename], ["Raw rows", count(source.stored_rows)], ["Price cells", count(source.stored_cells)], ["Commercial identities", count(source.identity_count)], ...(source.effective_from ? [["Effective date", source.effective_from]] : []), ...(source.received_at ? [["Received date", source.received_at]] : [])].map(([label, value]) =>
      <div key={label}><dt className="text-zinc-500">{label}</dt><dd className="break-words font-semibold">{value}</dd></div>)}</dl>
    {workingFileUrl ? <a className="mt-2 inline-block font-medium underline" href={workingFileUrl} target="_blank" rel="noopener noreferrer">Download retained working source</a> : null}
    <p className="mt-2 break-words text-zinc-500">SHA-256 {source.file_hash}. {source.original_reference ? `Original reference: ${source.original_reference}` : ""}</p></details>;
}

export type PriceListTab = "current" | "import" | "history";
/** Current price list / Import new / History: the three areas of this screen. */
export function SupplierTabs({ tab, hrefs }: { tab: PriceListTab; hrefs: Record<PriceListTab, string> }) {
  const items: Array<[PriceListTab, string]> = [["current", "Current price list"], ["import", "Import new"], ["history", "History"]];
  return <nav aria-label="Price list sections" className="inline-flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">{items.map(([key, label]) =>
    <Link key={key} href={hrefs[key]} aria-current={tab === key ? "page" : undefined} className={`rounded-md px-4 py-1.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${tab === key ? "bg-emerald-900 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"}`}>{label}</Link>)}</nav>;
}

export type CurrentPriceList = { title: string; currency: string | null; basis: string | null; baselineDate: string | null; families: number | null; href: string | null };
/** The Brand's active complete baseline first; otherwise a plain invitation to import. */
export function SupplierCurrentPriceList({ brandName, current, inProgress, importHref }: { brandName: string; current: CurrentPriceList | null; inProgress: { title: string; href: string } | null; importHref: string }) {
  return <section className={`${card} space-y-3 p-4`} aria-label="Current price list">
    <div><p className="text-xs text-zinc-500">{brandName}</p><h3 className="text-base font-semibold text-zinc-950">Current Price List</h3></div>
    {current ? <>
      <div><p className="text-lg font-semibold text-zinc-950">{current.title}</p>
        <p className="text-xs text-zinc-500">{[current.currency, current.basis === "list" ? "List" : current.basis === "net" ? "Net" : null].filter(Boolean).join(" · ")}</p></div>
      <ul className="space-y-1 text-sm text-zinc-700"><li><span className={`${badge} border-emerald-200 bg-emerald-50 text-emerald-900`}>✓ Brand baseline active</span></li>{current.families !== null ? <li>{current.families} Product {current.families === 1 ? "family" : "families"} reviewed</li> : null}{current.baselineDate ? <li>Baseline: {current.baselineDate}</li> : null}</ul>
      {current.href ? <Link href={current.href} className={linkButton}>View review</Link> : null}
    </> : <>
      <p className="text-sm">No completed Brand price list yet.</p>
      <Link href={importHref} className={primaryLink}>Import new price list</Link>
    </>}
    {inProgress ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p>Review in progress: <span className="font-medium">{inProgress.title}</span></p><Link href={inProgress.href} className={`mt-2 ${primaryLink}`}>Continue review</Link></div> : null}
  </section>;
}

export type HistoryRow = { id: string; title: string; date: string; status: "current" | "archived" | "unfinished"; coverage: string; baseline: string; viewHref: string; downloadUrl?: string };
const historyStatus = { current: ["Current", "border-emerald-200 bg-emerald-50 text-emerald-900"], archived: ["Archived", "border-zinc-200 bg-zinc-100 text-zinc-600"], unfinished: ["Unfinished import", "border-amber-200 bg-amber-50 text-amber-900"] } as const;
/** Price-list history. Archive hides a list but deletes nothing; used lists are never deleted. */
export function SupplierHistoryTable({ rows, showArchived, archivedCount, toggleHref, pagerHrefs, canArchive, reviews, currentBatchId, reviewHref, newReviewHref }: {
  rows: HistoryRow[]; showArchived: boolean; archivedCount: number; toggleHref: string; pagerHrefs: { previous: string; next: string }; canArchive: boolean;
  reviews: ReviewBatch[]; currentBatchId?: string; reviewHref: (id: string) => string; newReviewHref?: string;
}) {
  const visible = rows.filter((row) => showArchived || row.status !== "archived");
  return <section className="space-y-3" aria-label="Price list history">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold text-zinc-950">History</h3>
      {archivedCount ? <Link href={toggleHref} className={smallButton}>{showArchived ? "Hide archived" : `Show archived (${archivedCount})`}</Link> : null}</div>
    <div className={`${card} overflow-hidden`}><div className="overflow-x-auto"><table className="min-w-full divide-y divide-zinc-200 text-sm"><thead className="bg-zinc-50"><tr className="text-left"><th className={th}>Price list</th><th className={th}>Date</th><th className={th}>Status</th><th className={th}>Coverage</th><th className={th}>Baseline</th><th className={th}>Actions</th></tr></thead>
      <tbody className="divide-y divide-zinc-100">{visible.map((row) => { const [label, tone] = historyStatus[row.status]; return <tr key={row.id} className="align-top transition hover:bg-zinc-50">
        <th scope="row" className="px-3 py-2 text-left font-semibold text-zinc-950">{row.title}</th><td className="px-3 py-2 tabular-nums text-zinc-600">{row.date}</td><td className="px-3 py-2"><span className={`${badge} ${tone}`}>{label}</span></td><td className="px-3 py-2 text-zinc-700">{row.coverage}</td><td className="px-3 py-2 text-zinc-700">{row.baseline}</td>
        <td className="px-3 py-2"><details className="relative"><summary className={`${smallButton} cursor-pointer list-none`} aria-label={`Actions for ${row.title}`}>⋯</summary>
          <ul className="absolute right-0 z-10 mt-1 w-40 space-y-1 rounded-md border border-zinc-200 bg-white p-2 text-xs font-semibold shadow-lg"><li><Link className="block rounded px-2 py-1 text-zinc-700 hover:bg-zinc-100" href={row.viewHref}>View</Link></li>
            {row.downloadUrl ? <li><a className="block rounded px-2 py-1 text-zinc-700 hover:bg-zinc-100" href={row.downloadUrl} target="_blank" rel="noopener noreferrer">Download</a></li> : null}
            {canArchive && row.status !== "archived" ? <li className="border-t border-zinc-100 pt-1"><SupplierArchiveButton sourceId={row.id} title={row.title} /></li> : null}</ul></details></td></tr>; })}</tbody></table></div>
      {visible.length === 0 ? <p className="px-4 py-10 text-center text-sm text-zinc-500">No price lists to show.</p> : null}</div>
    <p className="flex justify-between text-xs"><Link href={pagerHrefs.previous} className={smallButton}>Previous price lists</Link><Link href={pagerHrefs.next} className={smallButton}>Next price lists</Link></p>
    {reviews.length ? <div className={`${card} p-4`}><h4 className="text-sm font-semibold text-zinc-950">Reviews of the selected price list</h4>
      <ul className="mt-2 space-y-1 text-sm">{reviews.map((item) => <li key={item.id} className="flex items-center gap-2"><Link className="font-medium underline-offset-2 hover:underline" href={reviewHref(item.id)} aria-current={item.id === currentBatchId ? "true" : undefined}>{coverageLabel(item.scope)}</Link> <span className={`${badge} border-zinc-200 bg-zinc-50`}>{reviewStatus(item.status)}</span></li>)}</ul>
      {newReviewHref ? <Link href={newReviewHref} className={`${smallButton} mt-3`}>Start a new review</Link> : null}</div> : null}
  </section>;
}

/** Shown once a review is completed. Families with excluded items are left for separate verification. */
export function SupplierFinishScreen({ brandName, title, baselineDate, overview, priceUpdatesHref, summaryHref }: { brandName: string; title: string; baselineDate: string | null; overview: FamilyOverview | null; priceUpdatesHref: string; summaryHref: string }) {
  const unchecked = overview?.families.filter((family) => family.excluded > 0).length ?? 0, checked = (overview?.families.length ?? 0) - unchecked;
  return <section className={`${card} space-y-2 border-emerald-200 p-4`} aria-label="Review completed">
    <p className="text-xs text-zinc-500">{brandName}</p><h3 className="text-base font-semibold text-zinc-950">{title}</h3>
    <p className={`${badge} border-emerald-200 bg-emerald-50 text-emerald-900`}>✓ Review completed. Brand price baseline activated.</p>
    {overview ? <ul className="space-y-0.5 text-sm text-zinc-700"><li>{checked} Product {checked === 1 ? "family" : "families"} checked</li>{unchecked ? <li>{unchecked} {unchecked === 1 ? "Family still needs" : "Families still need"} separate price verification</li> : null}</ul> : null}
    {baselineDate ? <p className="text-sm">Baseline date: <span className="font-semibold">{baselineDate}</span></p> : null}
    <div className="flex flex-wrap gap-2 pt-1"><Link href={priceUpdatesHref} className={primaryLink}>Back to Price Updates</Link><Link href={summaryHref} className={linkButton}>View review summary</Link></div>
  </section>;
}

/** Plain-language results for the Complete step. The authoritative checks stay on the server. */
export function SupplierCompleteSummary({ overview, reviewHref }: { overview: FamilyOverview; reviewHref: string }) {
  const { totals, finished, families } = overview;
  const needsReview = families.filter((family) => family.status === "needs_review").length, attention = families.filter((family) => family.status === "needs_attention").length;
  const open = totals.changed + totals.same + totals.missing + totals.attention;
  const cards: Array<[string, number, string]> = [["Ready", totals.ready, "border-emerald-200 bg-emerald-50 text-emerald-950"], ["Needs review", needsReview, needsReview ? "border-amber-200 bg-amber-50 text-amber-950" : "border-zinc-200 bg-white text-zinc-950"], ["Needs attention", attention, attention ? "border-red-200 bg-red-50 text-red-950" : "border-zinc-200 bg-white text-zinc-950"],
    ["Prices updated", finished.applied, "border-sky-200 bg-sky-50 text-sky-950"], ["Unchanged prices confirmed", finished.confirmed, "border-zinc-200 bg-white text-zinc-950"], ["Items not listed by Supplier (excluded)", finished.excluded, "border-zinc-200 bg-white text-zinc-950"]];
  return <section className="space-y-3 text-sm" aria-label="Review results">
    <h3 className="text-base font-semibold text-zinc-950">{totals.families} {totals.families === 1 ? "Family" : "Families"}</h3>
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-6">{cards.map(([label, value, tone]) => <div key={label} className={`flex min-h-[5.5rem] flex-col justify-between rounded-lg border p-3 shadow-sm ${tone}`}><dt className="text-xs font-semibold">{label}</dt><dd className="text-2xl font-semibold tabular-nums">{value}</dd></div>)}</dl>
    {open ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950" role="status"><p className="font-semibold">{open} {open === 1 ? "item still needs" : "items still need"} a decision before you can complete.</p>
      <ul className="mt-1 list-inside list-disc text-xs">{totals.changed ? <li>{totals.changed} changed {totals.changed === 1 ? "price" : "prices"} to apply</li> : null}{totals.same ? <li>{totals.same} unchanged {totals.same === 1 ? "price" : "prices"} to confirm</li> : null}{totals.missing ? <li>{totals.missing} {totals.missing === 1 ? "item" : "items"} missing from the Supplier list</li> : null}{totals.attention ? <li>{totals.attention} {totals.attention === 1 ? "item needs" : "items need"} attention</li> : null}</ul>
      <Link href={reviewHref} className={`${smallButton} mt-2`}>Review items</Link></div> : <p className={`${badge} border-emerald-200 bg-emerald-50 text-emerald-900`}>✓ Everything is resolved. You can complete this review.</p>}
  </section>;
}
