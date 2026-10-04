import Link from "next/link";
import type { ReviewBatch, SourceVersion } from "@/lib/products/supplier-price-contracts";
import type { FamilyOverview } from "@/lib/products/supplier-price-repository";

const badge = "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium";
const linkButton = "inline-block rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium";
const primaryLink = "inline-block rounded border border-zinc-800 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white";
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
  return <header className="space-y-3 border-b border-zinc-200 pb-3">
    <nav aria-label="Supplier price list steps"><ol className="flex flex-wrap gap-2 text-sm">{stepNames.map((name, index) => {
      const number = (index + 1) as WorkflowStep; const state = number < step ? "done" : number === step ? "current" : "todo"; const enabled = number === 1 || Boolean(source && (number === 2 || batch));
      const mark = state === "done" ? "✓" : state === "current" ? "●" : "○";
      const body = <><span aria-hidden="true">{mark}</span> {number} {name}<span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (current step)" : " (not started)"}</span></>;
      return <li key={name}>{enabled ? <Link href={links.steps[index]} aria-current={state === "current" ? "step" : undefined} className={`inline-block rounded border px-3 py-1.5 ${state === "current" ? "border-zinc-800 bg-zinc-800 font-medium text-white" : "border-zinc-300 bg-white"}`}>{body}</Link>
        : <span className="inline-block rounded border border-zinc-200 px-3 py-1.5 text-zinc-500">{body}</span>}</li>;
    })}</ol></nav>
    {source ? <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="min-w-0"><h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-zinc-600">{source.currency} · {source.basis === "list" ? "List" : source.basis === "net" ? "Net" : "Basis not set"} · {source.status === "imported" ? "Imported" : source.status === "archived" ? "Archived" : "Import not finished"}{batch ? ` · ${coverageLabel(batch.scope)}` : ""}</p></div>
      <p className="flex gap-3 text-xs"><a href={links.history} className="underline">Price list history</a><a href={links.advanced} className="underline">Advanced tools</a></p>
    </div> : null}
  </header>;
}

/** Step 1b: what was imported, and only the warnings that need a decision. */
export function SupplierImportSummary({ brandName, source, families, warnings, continueHref, detailsHref, uploading }: {
  brandName: string; source: SourceVersion; families: number | null; warnings: number | null; continueHref: string; detailsHref: string; uploading?: boolean;
}) {
  const ok = source.status === "imported";
  return <section className="space-y-3 rounded border border-zinc-300 bg-white p-4" aria-label="Import summary">
    <div><p className="text-xs text-zinc-600">{brandName}</p><h3 className="text-base font-semibold">{source.title}</h3><p className={`mt-1 text-sm font-medium ${ok ? "text-emerald-800" : "text-amber-800"}`}>{ok ? "Imported successfully" : uploading ? "Import in progress" : "Import not finished — import the same file again to resume"}</p></div>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([["Source rows", count(source.stored_rows)], ["Supplier items", count(source.identity_count)], ["Currency", source.currency], ["Prices", basisLabel(source.basis)]] as const).map(([label, value]) =>
      <div key={label}><dt className="text-xs text-zinc-600">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>
    {families !== null ? <p className="text-sm">{families} Product {families === 1 ? "family" : "families"} found</p> : null}
    {warnings ? <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm" role="status">{warnings} source-data {warnings === 1 ? "issue" : "issues"} to look at during review.</p> : null}
    <div className="flex flex-wrap gap-2">{ok ? <Link href={continueHref} className={primaryLink}>Continue to Family Review</Link> : null}<Link href={detailsHref} className={linkButton}>View import details</Link></div>
  </section>;
}

/** Technical import facts, kept one click away from the summary. */
export function SupplierImportDetails({ source, workingFileUrl }: { source: SourceVersion; workingFileUrl?: string }) {
  return <details className="rounded border border-zinc-200 p-3 text-xs" open><summary className="cursor-pointer font-medium">Import details</summary>
    <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">{[["File", source.filename], ["Raw rows", count(source.stored_rows)], ["Price cells", count(source.stored_cells)], ["Commercial identities", count(source.identity_count)], ...(source.effective_from ? [["Effective date", source.effective_from]] : []), ...(source.received_at ? [["Received date", source.received_at]] : [])].map(([label, value]) =>
      <div key={label}><dt className="text-zinc-500">{label}</dt><dd className="break-words font-semibold">{value}</dd></div>)}</dl>
    {workingFileUrl ? <a className="mt-2 inline-block font-medium underline" href={workingFileUrl} target="_blank" rel="noopener noreferrer">Download retained working source</a> : null}
    <p className="mt-2 break-words text-zinc-500">SHA-256 {source.file_hash}. {source.original_reference ? `Original reference: ${source.original_reference}` : ""}</p></details>;
}

/** Older price lists and reviews, collapsed by default. */
export function SupplierPriceListHistory({ sources, reviews, currentSourceId, currentBatchId, sourceHref, reviewHref, newReviewHref, pagerHrefs }: {
  sources: SourceVersion[]; reviews: ReviewBatch[]; currentSourceId?: string; currentBatchId?: string; sourceHref: (id: string) => string; reviewHref: (id: string) => string; newReviewHref?: string; pagerHrefs: { previous: string; next: string };
}) {
  return <details id="history" className="rounded border border-zinc-200 p-3 text-sm"><summary className="cursor-pointer font-medium">Price list history</summary>
    <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b bg-zinc-50"><th className="p-2">Price list</th><th className="p-2">Status</th><th className="p-2">Prices</th><th className="p-2 text-right">Items</th></tr></thead>
      <tbody>{sources.map((item) => <tr key={item.id} className={`border-b ${item.id === currentSourceId ? "bg-zinc-100" : ""}`}><th scope="row" className="p-2 font-medium"><Link className="underline" href={sourceHref(item.id)} aria-current={item.id === currentSourceId ? "true" : undefined}>{item.title}</Link></th>
        <td className="p-2">{item.status === "imported" ? "Imported" : item.status === "archived" ? "Archived" : "Not finished"}</td><td className="p-2">{item.currency} · {item.basis}</td><td className="p-2 text-right tabular-nums">{count(item.identity_count)}</td></tr>)}</tbody></table>
      {sources.length === 0 ? <p className="p-3 text-center text-zinc-600">No price lists imported yet.</p> : null}</div>
    <p className="mt-1 flex justify-between text-xs"><Link href={pagerHrefs.previous} className="underline">Previous price lists</Link><Link href={pagerHrefs.next} className="underline">Next price lists</Link></p>
    {reviews.length ? <div className="mt-3"><h3 className="text-xs font-semibold">Reviews of this price list</h3>
      <ul className="mt-1 space-y-1 text-xs">{reviews.map((item) => <li key={item.id}><Link className="underline" href={reviewHref(item.id)} aria-current={item.id === currentBatchId ? "true" : undefined}>{coverageLabel(item.scope)}</Link> <span className={`${badge} border-zinc-200 bg-zinc-50`}>{reviewStatus(item.status)}</span></li>)}</ul>
      {newReviewHref ? <Link href={newReviewHref} className="mt-2 inline-block text-xs underline">Start a new review</Link> : null}</div> : null}
  </details>;
}

/** Shown once a review is completed. Families with excluded items are left for separate verification. */
export function SupplierFinishScreen({ brandName, title, baselineDate, overview, priceUpdatesHref, summaryHref }: { brandName: string; title: string; baselineDate: string | null; overview: FamilyOverview | null; priceUpdatesHref: string; summaryHref: string }) {
  const unchecked = overview?.families.filter((family) => family.excluded > 0).length ?? 0, checked = (overview?.families.length ?? 0) - unchecked;
  return <section className="space-y-2 rounded border border-emerald-200 bg-emerald-50 p-4" aria-label="Review completed">
    <p className="text-xs text-zinc-600">{brandName}</p><h3 className="text-base font-semibold">{title}</h3>
    <p className="font-medium text-emerald-900">Review completed. Brand price baseline activated.</p>
    {overview ? <ul className="text-sm"><li>{checked} Product {checked === 1 ? "family" : "families"} checked</li>{unchecked ? <li>{unchecked} {unchecked === 1 ? "Family still needs" : "Families still need"} separate price verification</li> : null}</ul> : null}
    {baselineDate ? <p className="text-sm">Baseline date: <span className="font-semibold">{baselineDate}</span></p> : null}
    <div className="flex flex-wrap gap-2"><Link href={priceUpdatesHref} className={primaryLink}>Back to Price Updates</Link><Link href={summaryHref} className={linkButton}>View review summary</Link></div>
  </section>;
}

/** Plain-language results for the Complete step. The authoritative checks stay on the server. */
export function SupplierCompleteSummary({ overview, reviewHref }: { overview: FamilyOverview; reviewHref: string }) {
  const { totals, finished, families } = overview;
  const needsReview = families.filter((family) => family.status === "needs_review").length, attention = families.filter((family) => family.status === "needs_attention").length;
  const open = totals.changed + totals.same + totals.missing + totals.attention;
  return <section className="space-y-2 rounded border border-zinc-300 p-3 text-sm" aria-label="Review results">
    <h3 className="font-semibold">{totals.families} {totals.families === 1 ? "Family" : "Families"}</h3>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">{([["Ready", totals.ready], ["Needs review", needsReview], ["Needs attention", attention], ["Prices updated", finished.applied], ["Unchanged prices confirmed", finished.confirmed], ["Items not listed by Supplier (excluded)", finished.excluded]] as const).map(([label, value]) =>
      <div key={label}><dt className="text-xs text-zinc-600">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>
    {open ? <div className="rounded border border-amber-300 bg-amber-50 p-2" role="status"><p className="font-medium">{open} {open === 1 ? "item still needs" : "items still need"} a decision before you can complete.</p>
      <ul className="mt-1 list-inside list-disc text-xs">{totals.changed ? <li>{totals.changed} changed {totals.changed === 1 ? "price" : "prices"} to apply</li> : null}{totals.same ? <li>{totals.same} unchanged {totals.same === 1 ? "price" : "prices"} to confirm</li> : null}{totals.missing ? <li>{totals.missing} {totals.missing === 1 ? "item" : "items"} missing from the Supplier list</li> : null}{totals.attention ? <li>{totals.attention} {totals.attention === 1 ? "item needs" : "items need"} attention</li> : null}</ul>
      <Link href={reviewHref} className="mt-1 inline-block text-xs underline">Review items</Link></div> : <p className="text-emerald-800">Everything is resolved. You can complete this review.</p>}
  </section>;
}
