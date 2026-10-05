"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupplierCoverageConflict, SupplierCoverageSuggestionRow } from "@/lib/products/supplier-price-contracts";
import type { SupplierCoverageDefinition, SupplierFamilyCoverageRow, SupplierPreviousSource } from "@/lib/products/supplier-price-repository";
import { archiveSupplierSourceDefinition, assignFamiliesToSupplierSource, confirmSupplierCoverage, createSupplierSourceDefinition, deleteSupplierSourceDefinition, linkSupplierSourceDefinition, renameSupplierSourceDefinition, resolveSupplierCoverageConflict, archiveSupplierSource, deletePreviousSupplierSource } from "@/app/products/price-updates/supplier-sources/actions";

// Same ProjectWorkflow patterns as the rest of Supplier Pricing: white card, light border, emerald primary, amber attention, red only for a real conflict.
const card = "rounded-lg border border-zinc-200 bg-white shadow-sm";
const input = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const button = "inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const badge = "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium";
const th = "px-3 py-2 text-left text-xs font-semibold text-zinc-500";

export type SourceOption = { id: string; name: string; familyCount: number };
export type SourceChoice = { value: string; newName: string }; // value: "" none yet, "new", or a source id

async function attempt(setBusy: (busy: boolean) => void, setMessage: (message: string) => void, work: () => Promise<void>) {
  setBusy(true); setMessage("");
  try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save."); } finally { setBusy(false); }
}

/** Import form field: pick a recurring Supplier source or start a new one. The import profile stays a separate, technical choice. */
export function SupplierSourceField({ options, choice, onChangeAction, profileTitle }: { options: SourceOption[]; choice: SourceChoice; onChangeAction: (choice: SourceChoice) => void; profileTitle: string }) {
  return <div className="grid gap-2 sm:col-span-2 xl:col-span-3">
    <label className="grid gap-1 text-xs"><span className="font-medium">Supplier source</span>
      <select value={choice.value} onChange={(event) => onChangeAction({ ...choice, value: event.target.value })} className={input} aria-label="Supplier source">
        <option value="">Choose a Supplier source</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}<option value="new">New source</option></select>
      <span className="text-zinc-500">A source groups recurring price lists with the same Family coverage.</span></label>
    {choice.value === "new" ? <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs"><span className="font-medium">Source name</span><input value={choice.newName} onChange={(event) => onChangeAction({ ...choice, newName: event.target.value })} placeholder="LAS Furniture" className={input} /></label>
      <div className="grid gap-1 text-xs"><span className="font-medium">Import profile</span><span className="rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm">{profileTitle || "Chosen below"}</span></div>
      <p className="text-xs text-zinc-500 sm:col-span-2">Use one source for each recurring price-list type, such as Furniture, Chairs or Accessories. The import profile only tells ProjectWorkflow how to read the file.</p></div> : null}
  </div>;
}

function statusOf(row: SupplierCoverageSuggestionRow) {
  if (row.isNewFamily) return ["New Family", "border-amber-200 bg-amber-50 text-amber-900"] as const;
  if (row.previouslyCovered) return ["Previously covered", "border-emerald-200 bg-emerald-50 text-emerald-900"] as const;
  if (row.foundRatio >= 0.8 && row.foundTargetCodes > 0) return ["Strong match", "border-emerald-200 bg-emerald-50 text-emerald-900"] as const;
  if (row.foundTargetCodes > 0) return ["Partial match", "border-amber-200 bg-amber-50 text-amber-900"] as const;
  return ["No matching codes", "border-zinc-200 bg-zinc-50 text-zinc-700"] as const;
}
const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** Which other active sources already cover each Family, so a conflict is visible before saving. */
export type OtherCoverage = Record<string, string[]>;

function CoverageTable({ rows, checked, onToggle, editable, others }: { rows: SupplierCoverageSuggestionRow[]; checked: Set<string>; onToggle: (id: string) => void; editable: boolean; others: OtherCoverage }) {
  return <div className="overflow-x-auto"><table className="min-w-full divide-y divide-zinc-200 text-sm"><thead className="bg-zinc-50"><tr><th className={th}>Family</th><th className={th}>Codes found</th><th className={th}>Coverage</th><th className={th}>Status</th><th className={th}>Include</th></tr></thead>
    <tbody className="divide-y divide-zinc-100">{rows.map((row) => { const [label, tone] = statusOf(row); const clash = checked.has(row.templateId) ? others[row.templateId] : undefined; return <tr key={row.templateId} className="align-top">
      <th scope="row" className="px-3 py-2 text-left font-semibold text-zinc-950">{row.templateName}{clash?.length ? <span className="mt-0.5 block text-xs font-normal text-amber-800">Also covered by {clash.join(", ")}. Saving creates a coverage conflict to resolve before review.</span> : null}</th>
      <td className="px-3 py-2 tabular-nums">{row.foundTargetCodes} / {row.totalTargetCodes}</td><td className="px-3 py-2 tabular-nums">{percent(row.foundRatio)}</td>
      <td className="px-3 py-2"><span className={`${badge} ${tone}`}>{label}</span></td>
      <td className="px-3 py-2"><input type="checkbox" checked={checked.has(row.templateId)} disabled={!editable} onChange={() => onToggle(row.templateId)} aria-label={`Include ${row.templateName}`} className="h-4 w-4 accent-emerald-800" /></td></tr>; })}</tbody></table></div>;
}

/** Step 2 of the flow: confirm which Families this Supplier source covers. Shown after import and when editing coverage. */
export function SupplierCoverageSetup({ brandId, source, definition, rows, definitions, others, approver, editing, editHref, doneHref, laterHref, conflicts }: {
  brandId: string; source: { id: string; title: string }; definition: { id: string; name: string; profileTitle: string | null; coveredIds: string[] } | null; rows: SupplierCoverageSuggestionRow[]; definitions: SourceOption[]; others: OtherCoverage;
  approver: boolean; editing: boolean; editHref: string; doneHref: string; laterHref: string; conflicts: SupplierCoverageConflict[];
}) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const confirmed = definition ? definition.coveredIds.length > 0 : false;
  const [checked, setChecked] = useState(() => new Set(rows.filter((row) => row.previouslyCovered || (!row.isNewFamily && row.suggested)).map((row) => row.templateId)));
  const [choice, setChoice] = useState<SourceChoice>({ value: "", newName: "" });
  const status = <p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>;
  if (!definition) return <section className={`${card} space-y-3 p-4`} aria-label="Supplier source"><div><h3 className="text-base font-semibold text-zinc-950">Supplier source</h3>
    <p className="text-xs text-zinc-500">This price list is not linked to a Supplier source yet, so a review would cover the whole Brand.</p></div>{status}
    {approver ? <><SupplierSourceField options={definitions} choice={choice} onChangeAction={setChoice} profileTitle="" />
      <button type="button" disabled={busy || !choice.value || (choice.value === "new" && !choice.newName.trim())} className={primary} onClick={() => void attempt(setBusy, setMessage, async () => {
        const id = choice.value === "new" ? (await createSupplierSourceDefinition(brandId, choice.newName)).id : choice.value;
        await linkSupplierSourceDefinition(source.id, id); router.refresh(); })}>Use this Supplier source</button></> : <p className="text-sm text-zinc-600">An approver chooses the Supplier source.</p>}</section>;
  const covered = rows.filter((row) => definition.coveredIds.includes(row.templateId)).length;
  if (confirmed && !editing) return <section className={`${card} space-y-2 p-4`} aria-label="Family coverage"><h3 className="text-base font-semibold text-zinc-950">Coverage confirmed</h3>
    <p className="text-sm text-zinc-700">{definition.name} covers {covered} {covered === 1 ? "Family" : "Families"}{rows.length - covered > 0 ? `; ${rows.length - covered} ${rows.length - covered === 1 ? "Family is" : "Families are"} not covered.` : "."}</p>
    {conflicts.length ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-950" role="alert"><p className="font-semibold">Resolve Family coverage conflicts before starting this review.</p><ul className="mt-1 list-inside list-disc text-xs">{conflicts.map((conflict) => <li key={conflict.templateId}>{conflict.templateName}: {conflict.definitions.map((item) => item.definitionName).join(", ")}</li>)}</ul></div> : null}
    {approver ? <Link href={editHref} className={button}>Edit coverage</Link> : null}</section>;
  return <section className={`${card} space-y-3 p-4`} aria-label="Suggested Family coverage"><div><h3 className="text-base font-semibold text-zinc-950">{confirmed ? "Edit Family coverage" : "Suggested Family coverage"}</h3>
    <p className="text-xs text-zinc-500">ProjectWorkflow compared the extracted Supplier codes with your Product Families. {definition.name} will review only the Families you include.</p></div>
    {status}<CoverageTable rows={rows} checked={checked} editable={approver} others={others} onToggle={(id) => setChecked((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; })} />
    {approver ? <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !checked.size} className={primary} onClick={() => void attempt(setBusy, setMessage, async () => { await confirmSupplierCoverage(definition.id, [...checked]); router.push(doneHref); router.refresh(); })}>Confirm Family coverage</button>
      <Link href={laterHref} className={button.replace("h-8", "h-9")}>Review later</Link></div> : <p className="text-sm text-zinc-600">An approver confirms Family coverage.</p>}</section>;
}

/** One quiet line at the top of Family Review. */
export function SupplierCoverageContext({ sourceName, covered, notCovered }: { sourceName: string; covered: string[]; notCovered: number }) {
  return <details className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700"><summary className="cursor-pointer">Reviewing {covered.length} covered {covered.length === 1 ? "Family" : "Families"} from {sourceName}</summary>
    <p className="mt-1">{covered.join(", ")}</p>{notCovered ? <p className="mt-1 text-zinc-500">{notCovered} other {notCovered === 1 ? "Family is" : "Families are"} not part of this price list and are not reviewed here.</p> : null}</details>;
}

/** Source, coverage, import profile and price list at a glance (Current price list header). */
export function SupplierSourceSummary({ sourceName, coveredCount, profileTitle, priceList, approver, editHref, detailsHref, advancedHref }: { sourceName: string | null; coveredCount: number; profileTitle: string | null; priceList: string; approver: boolean; editHref: string; detailsHref: string; advancedHref: string }) {
  return <section className={`${card} flex flex-wrap items-start justify-between gap-3 p-4`} aria-label="Supplier source"><dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
    <div><dt className="text-xs text-zinc-500">Supplier source</dt><dd className="font-semibold text-zinc-950">{sourceName ?? "Not set (whole Brand)"}</dd></div>
    <div><dt className="text-xs text-zinc-500">Coverage</dt><dd className="font-semibold text-zinc-950">{sourceName ? `${coveredCount} ${coveredCount === 1 ? "Family" : "Families"}` : "All Families"}</dd></div>
    <div><dt className="text-xs text-zinc-500">Import profile</dt><dd>{profileTitle ?? "Saved with the price list"}</dd></div>
    <div><dt className="text-xs text-zinc-500">Price list</dt><dd>{priceList}</dd></div></dl>
    <p className="flex flex-wrap gap-2">{approver && sourceName ? <Link href={editHref} className={button}>Edit coverage</Link> : null}<Link href={detailsHref} className={button}>View extracted data</Link>{approver ? <Link href={advancedHref} className={button}>Advanced tools</Link> : null}</p></section>;
}

function ConflictRow({ conflict, brandId, approver }: { conflict: SupplierCoverageConflict; brandId: string; approver: boolean }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [keep, setKeep] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  return <li className="space-y-1 text-sm"><p><span className="font-semibold">{conflict.templateName}</span> is covered by: {conflict.definitions.map((item) => item.definitionName).join(", ")}</p>
    {approver ? open ? <div className="space-y-1 rounded-md border border-red-200 bg-white p-2 text-xs"><p className="font-medium">Choose which source should cover this Family.</p>
      {conflict.definitions.map((item) => <label key={item.definitionId} className="flex items-center gap-2"><input type="radio" name={`keep-${conflict.templateId}`} checked={keep === item.definitionId} onChange={() => setKeep(item.definitionId)} className="accent-emerald-800" />{item.definitionName}</label>)}
      <p role="status" className="text-amber-800">{message}</p>
      <button type="button" disabled={busy || !keep} className={button} onClick={() => void attempt(setBusy, setMessage, async () => { await resolveSupplierCoverageConflict(brandId, conflict.templateId, keep); router.refresh(); })}>Save choice</button></div>
      : <button type="button" className={button} onClick={() => setOpen(true)}>Resolve conflict</button> : null}</li>;
}

/** Brand overview: several current sources are normal; uncovered Families and conflicts are configuration issues, not pricing errors. */
export function SupplierSourcesOverview({ definitions, brandId, approver, editCoverageHref }: { definitions: SupplierCoverageDefinition[]; brandId: string; approver: boolean; editCoverageHref: (id: string) => string }) {
  const active = definitions.filter((definition) => definition.isActive);
  if (!active.length) return null;
  return <section className={`${card} space-y-2 p-4`} aria-label="Supplier sources"><h3 className="text-base font-semibold text-zinc-950">Current Supplier sources</h3>
    <ul className="divide-y divide-zinc-100 text-sm">{active.map((definition) => <li key={definition.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span className="font-semibold text-zinc-950">{definition.name}</span>
      <span className="text-xs text-zinc-600">{definition.families.length} {definition.families.length === 1 ? "Family" : "Families"} · {definition.latest ? `Latest: ${definition.latest.title}` : "No price list yet"}</span>
      <span className={`${badge} ${definition.latest ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-zinc-200 bg-zinc-50 text-zinc-700"}`}>{definition.latest ? "Current" : "Waiting for a price list"}</span>{approver ? <SupplierSourceMenu brandId={brandId} definition={definition} editCoverageHref={editCoverageHref(definition.id)} /> : null}</li>)}</ul></section>;
}
function SupplierSourceMenu({ brandId, definition, editCoverageHref }: { brandId: string; definition: SupplierCoverageDefinition; editCoverageHref: string }) {
  const router = useRouter(); const [mode, setMode] = useState<"" | "rename" | "archive" | "delete">(""); const [name, setName] = useState(definition.name); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function run(work: () => Promise<unknown>) { setBusy(true); setMessage(""); try { await work(); setMode(""); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save."); } finally { setBusy(false); } }
  return <><details className="relative"><summary className={`${button} cursor-pointer list-none`} aria-label={`Actions for ${definition.name}`}>•••</summary><div className="absolute right-0 z-10 mt-1 w-56 space-y-1 rounded-md border border-zinc-200 bg-white p-2 shadow-lg"><button type="button" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-100" onClick={() => setMode("rename")}>Rename</button><Link className="block rounded px-2 py-1 text-xs hover:bg-zinc-100" href={editCoverageHref}>Edit coverage</Link><button type="button" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-100" onClick={() => setMode("archive")}>Archive</button>{definition.canDelete ? <button type="button" className="block w-full rounded px-2 py-1 text-left text-xs text-red-800 hover:bg-red-50" onClick={() => setMode("delete")}>Delete</button> : <p className="px-2 py-1 text-xs text-zinc-500">Cannot delete a source with imported price lists or review history.</p>}</div></details>
    {mode === "rename" ? <form className="basis-full rounded border border-zinc-200 bg-zinc-50 p-2" onSubmit={(event) => { event.preventDefault(); void run(() => renameSupplierSourceDefinition(brandId, definition.id, name)); }}><label className="grid gap-1 text-xs">Source name<input value={name} onChange={(event) => setName(event.target.value)} className={input} /></label><div className="mt-2 flex gap-2"><button disabled={busy} className={button}>Save</button><button type="button" className={button} onClick={() => setMode("")}>Cancel</button></div></form> : null}
    {mode === "archive" ? <div className="basis-full rounded border border-amber-200 bg-amber-50 p-2 text-sm"><p>Archive {definition.name}?</p><p className="text-xs">This source will stop appearing as an active option. Existing price lists and review history are kept.</p><button disabled={busy} className={`${button} mt-2`} onClick={() => void run(() => archiveSupplierSourceDefinition(brandId, definition.id))}>Archive source</button> <button className={button} onClick={() => setMode("")}>Cancel</button></div> : null}
    {mode === "delete" ? <div className="basis-full rounded border border-red-200 bg-red-50 p-2 text-sm"><p>Delete {definition.name}?</p><p className="text-xs">This source has no imported price lists or review history. This action cannot be undone.</p><button disabled={busy} className={`${button} mt-2`} onClick={() => void run(() => deleteSupplierSourceDefinition(brandId, definition.id))}>Delete source</button> <button className={button} onClick={() => setMode("")}>Cancel</button></div> : null}{message ? <p className="basis-full text-xs text-amber-800">{message}</p> : null}</>;
}

type FamilyRow = SupplierFamilyCoverageRow;
type RowStatus = "conflict" | "previous" | "strong" | "partial" | "none" | "unknown";
const rowStatus = (row: FamilyRow): RowStatus => row.currentSources.length > 1 ? "conflict" : row.foundRatio === null ? (row.currentSources.length ? "previous" : "unknown") : row.foundTargetCodes === 0 ? (row.currentSources.length ? "previous" : "none")
  : row.foundRatio >= 0.8 ? "strong" : "partial";
const statusLabel: Record<RowStatus, [string, string]> = {
  conflict: ["Coverage conflict", "border-red-200 bg-red-50 text-red-900"], previous: ["Previously covered", "border-emerald-200 bg-emerald-50 text-emerald-900"], strong: ["Strong match", "border-emerald-200 bg-emerald-50 text-emerald-900"],
  partial: ["Partial match", "border-amber-200 bg-amber-50 text-amber-900"], none: ["No matching codes", "border-zinc-200 bg-zinc-50 text-zinc-700"], unknown: ["Not compared yet", "border-zinc-200 bg-zinc-50 text-zinc-700"],
};
const categoryOf = (row: FamilyRow) => [row.mainCategory, row.subCategory].filter(Boolean).join(" / ") || "No category";
const sourceOf = (row: FamilyRow) => row.currentSources.length > 1 ? "Conflict" : row.currentSources[0]?.definitionName ?? "Unassigned";
type Chip = "all" | "suggested" | "none" | "unassigned";
// Pure selection and filtering rules, exported so they can be tested without a browser.
export const suggestedSelection = (rows: FamilyRow[]) => new Set(rows.filter((row) => row.suggested).map((row) => row.templateId));
export const filterCoverageRows = (rows: FamilyRow[], filters: { category: string; status: string; chip: Chip }) => rows.filter((row) => (!filters.category || categoryOf(row) === filters.category) && (!filters.status || rowStatus(row) === filters.status)
  && (filters.chip === "all" || (filters.chip === "suggested" && row.suggested) || (filters.chip === "none" && rowStatus(row) === "none") || (filters.chip === "unassigned" && !row.currentSources.length)));
/** Selected Families another source already covers: assigning would overlap, so it is shown before saving. */
export const coverageClashes = (rows: FamilyRow[], selected: Set<string>, targetId: string) => rows.filter((row) => selected.has(row.templateId) && row.currentSources.length && row.currentSources.every((source) => source.definitionId !== targetId));

/** First-time and ongoing coverage setup: every active Family in one compact table with bulk assignment to a Supplier source. */
export function SupplierFamilyCoverageSetup({ brandId, rows, sources, profiles, approver, referenceTitle }: { brandId: string; rows: FamilyRow[]; sources: SourceOption[]; profiles: Array<{ id: string; title: string }>; approver: boolean; referenceTitle: string | null }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [category, setCategory] = useState(""); const [status, setStatus] = useState(""); const [chip, setChip] = useState<Chip>("all");
  const [target, setTarget] = useState(sources.length === 1 ? sources[0].id : ""); const [newName, setNewName] = useState(""); const [profileId, setProfileId] = useState(profiles.length === 1 ? profiles[0].id : "");
  const categories = [...new Set(rows.map(categoryOf))].sort(); const statuses = [...new Set(rows.map(rowStatus))];
  const visible = filterCoverageRows(rows, { category, status, chip });
  const covered = rows.filter((row) => row.currentSources.length).length, conflicts = rows.filter((row) => row.currentSources.length > 1).length;
  const targetName = target === "new" ? newName.trim() : sources.find((source) => source.id === target)?.name ?? "";
  const clashes = coverageClashes(rows, selected, target);
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const chips: Array<[Chip, string]> = [["all", "All"], ["suggested", "Suggested"], ["none", "No match"], ["unassigned", "Unassigned"]];
  if (!rows.length) return null;
  return <section className={`${card} space-y-3 p-4`} aria-label="Family Coverage Setup">
    <div><h3 className="text-base font-semibold text-zinc-950">Family Coverage Setup</h3><p className="text-xs text-zinc-500">Choose which Supplier source is responsible for each Product Family.{referenceTitle ? ` Codes found are compared with ${referenceTitle}.` : " Import a price list to see how many codes each Family has."}</p></div>
    <p className="text-sm text-zinc-700" aria-label="Coverage totals">{rows.length} Families · {covered} covered · {rows.length - covered} uncovered · {rows.filter((row) => row.suggested).length} suggested · {conflicts} {conflicts === 1 ? "conflict" : "conflicts"}</p>
    <p role="status" aria-live="polite" className="text-sm text-emerald-900">{message}</p>
    <div className="flex flex-wrap items-end gap-2 text-xs">
      <label className="grid gap-1 font-medium">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className={input}><option value="">All categories</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="grid gap-1 font-medium">Status<select value={status} onChange={(event) => setStatus(event.target.value)} className={input}><option value="">All statuses</option>{statuses.map((key) => <option key={key} value={key}>{statusLabel[key][0]}</option>)}</select></label>
      <span className="flex flex-wrap gap-1" role="group" aria-label="Quick filters">{chips.map(([key, label]) => <button key={key} type="button" aria-pressed={chip === key} onClick={() => setChip(key)} className={`${button} ${chip === key ? "border-emerald-800 bg-emerald-50 text-emerald-950" : ""}`}>{label}</button>)}</span>
      {approver ? <span className="flex flex-wrap gap-1"><button type="button" className={button} onClick={() => setSelected(suggestedSelection(rows))}>Select suggested</button>
        <button type="button" className={button} onClick={() => setSelected(new Set(visible.map((row) => row.templateId)))}>Select all</button><button type="button" className={button} onClick={() => setSelected(new Set())}>Clear selection</button></span> : null}
    </div>
    {approver && selected.size ? <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm" aria-label="Bulk assignment">
      <p className="font-semibold text-emerald-950">{selected.size} {selected.size === 1 ? "Family" : "Families"} selected</p>
      <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs font-medium">Assign selected to<select value={target} onChange={(event) => setTarget(event.target.value)} className={input} aria-label="Assign selected to"><option value="">Choose a Supplier source</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}<option value="new">Create new source</option></select></label>
        {target === "new" ? <><label className="grid gap-1 text-xs font-medium">Source name<input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="LAS Furniture" className={input} /></label>
          <label className="grid gap-1 text-xs font-medium">Import profile<select value={profileId} onChange={(event) => setProfileId(event.target.value)} className={input}><option value="">No profile linked</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title}</option>)}</select></label></> : null}
        <button type="button" disabled={busy || !target || (target === "new" && !newName.trim())} className={primary} onClick={() => void attempt(setBusy, setMessage, async () => {
          const count = selected.size; const result = await assignFamiliesToSupplierSource(brandId, target === "new" ? { newName: newName.trim(), profileId: profileId || undefined } : { definitionId: target }, [...selected]);
          setSelected(new Set()); setNewName(""); setTarget(result.definitionId); setMessage(`${count} ${count === 1 ? "Family" : "Families"} assigned to ${result.name}.`); router.refresh(); })}>{target === "new" ? "Create and assign" : `Assign ${selected.size} ${selected.size === 1 ? "Family" : "Families"}`}</button>
        <button type="button" className={button.replace("h-8", "h-9")} onClick={() => setSelected(new Set())}>Clear</button></div>
      {clashes.length && targetName ? <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-950" role="alert"><span className="font-semibold">Coverage conflict.</span> {clashes.map((row) => `${row.templateName} is already covered by ${row.currentSources.map((source) => source.definitionName).join(", ")}`).join("; ")}. Assigning keeps both until you resolve it.</p> : null}
    </div> : null}
    <div className="overflow-x-auto"><table className="min-w-full divide-y divide-zinc-200 text-sm"><thead className="bg-zinc-50"><tr>{approver ? <th className={th}><span className="sr-only">Select</span></th> : null}<th className={th}>Family</th><th className={th}>Library category</th><th className={th}>Codes found</th><th className={th}>Coverage</th><th className={th}>Status</th><th className={th}>Current source</th></tr></thead>
      <tbody className="divide-y divide-zinc-100">{visible.map((row) => { const key = rowStatus(row); const [label, tone] = statusLabel[key]; return <Fragment key={row.templateId}><tr className="align-top">
        {approver ? <td className="px-3 py-2"><input type="checkbox" checked={selected.has(row.templateId)} onChange={() => toggle(row.templateId)} aria-label={`Select ${row.templateName}`} className="h-4 w-4 accent-emerald-800" /></td> : null}
        <th scope="row" className="px-3 py-2 text-left font-semibold text-zinc-950">{row.templateName}</th><td className="px-3 py-2 text-zinc-700">{categoryOf(row)}</td>
        <td className="px-3 py-2 tabular-nums">{row.foundTargetCodes === null ? "—" : `${row.foundTargetCodes} / ${row.totalTargetCodes}`}</td><td className="px-3 py-2 tabular-nums">{row.foundRatio === null ? "—" : percent(row.foundRatio)}</td>
        <td className="px-3 py-2"><span className={`${badge} ${tone}`}>{label}</span></td><td className={`px-3 py-2 ${key === "conflict" ? "font-semibold text-red-900" : row.currentSources.length ? "text-zinc-950" : "text-zinc-500"}`}>{sourceOf(row)}</td></tr>
        {key === "conflict" ? <tr><td colSpan={approver ? 7 : 6} className="bg-red-50 px-3 py-2"><ConflictRow brandId={brandId} approver={approver} conflict={{ templateId: row.templateId, templateName: row.templateName, definitions: row.currentSources }} /></td></tr> : null}</Fragment>; })}</tbody></table>
      {!visible.length ? <p className="px-3 py-6 text-center text-sm text-zinc-500">No Families match these filters.</p> : null}</div>
  </section>;
}

/** After a newer price list of the same Supplier source is imported: keep the previous one, archive it, or delete it when nothing must be retained. */
export function SupplierPreviousPriceList({ currentSourceId, previous, canReview, canDelete }: { currentSourceId: string; previous: SupplierPreviousSource[]; canReview: boolean; canDelete: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [confirming, setConfirming] = useState("");
  if (!previous.length) return null;
  return <section className={`${card} space-y-3 p-4`} aria-label="Previous price list"><div><h3 className="text-base font-semibold text-zinc-950">Previous price list</h3>
    <p className="text-xs text-zinc-500">What should happen to the previous version? Keeping it is the default; nothing is deleted unless you choose it.</p></div>
    <p role="status" aria-live="polite" className="text-sm text-emerald-900">{message}</p>
    <ul className="divide-y divide-zinc-100 text-sm">{previous.map((item) => <li key={item.source_id} className="space-y-2 py-2">
      <p className="flex flex-wrap items-center gap-2"><span className="font-semibold text-zinc-950">{item.title}</span><span className="text-xs text-zinc-500">{String(item.created_at).slice(0, 10)} · {item.status === "archived" ? "Archived" : "Kept for history"}</span></p>
      {item.safe_to_delete ? null : <p className="text-xs text-amber-900">{item.reasons.includes("This previous price list contains review history that must be retained.") ? "This previous price list contains review history that must be retained." : item.reasons.join(" ")}</p>}
      {canReview ? <p className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => setMessage(`${item.title} is kept for history.`)}>Keep for history</button>
        {item.status !== "archived" ? <button type="button" className={button} disabled={busy} onClick={() => void attempt(setBusy, setMessage, async () => { await archiveSupplierSource(item.source_id); setMessage(`${item.title} archived. Its data and review history are kept.`); router.refresh(); })}>Archive previous price list</button> : null}
        {canDelete ? confirming === item.source_id
          ? <><button type="button" className={`${button} border-red-300 text-red-900`} disabled={busy || !item.safe_to_delete} onClick={() => void attempt(setBusy, setMessage, async () => { await deletePreviousSupplierSource(currentSourceId, item.source_id); setConfirming(""); setMessage(`${item.title} deleted from the database. The original file stays in Storage.`); router.refresh(); })}>Confirm delete</button><button type="button" className={button} onClick={() => setConfirming("")}>Cancel</button></>
          : <button type="button" className={button} disabled={busy || !item.safe_to_delete} title={item.safe_to_delete ? undefined : "This previous price list contains review history that must be retained."} onClick={() => setConfirming(item.source_id)}>Delete previous source data</button> : null}
      </p> : null}
    </li>)}</ul></section>;
}
