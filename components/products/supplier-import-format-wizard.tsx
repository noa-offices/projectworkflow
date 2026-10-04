"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseSupplierFile } from "@/lib/products/supplier-price-file";
import { commercialSupplierIdentities, normalizeSupplierRows } from "@/lib/products/supplier-price-import";
import { assertSupplierProfile, type PriceBasis, type SupplierProfile } from "@/lib/products/supplier-price-contracts";
import { saveSupplierProfile } from "@/app/products/price-updates/supplier-sources/actions";

// ProjectWorkflow patterns: white card, light border and shadow, emerald primary, zinc secondary.
const card = "rounded-lg border border-zinc-200 bg-white shadow-sm";
const input = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const button = "inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const stepNames = ["Upload sample", "Map columns", "Price settings", "Test import"] as const;

export type CodeStructure = "simple" | "article_finish" | "matrix";
export type FormatChoices = {
  fullCode: string; articleCode: string; price: string; category: string; description: string;
  currency: "AED" | "EUR" | "USD"; basis: Exclude<PriceBasis, "unknown">; structure: CodeStructure; articleLength: number; finishLength: number;
};
const issueWords: Record<string, string> = {
  missing_code: "Missing Supplier code", numeric_or_non_text_code: "Code stored as a number, not text", unexpected_full_code_length: "Code length differs from the format", article_full_code_disagreement: "Article code and full code disagree",
  missing_text_article: "Missing article code", numeric_or_non_text_article: "Article code stored as a number", non_text_dimension: "Category is not text", invalid_price: "Price is missing or not a plain number", conflicting_source_prices: "Same item listed with different prices",
};

/** Builds the existing import-profile shape from plain choices. Users never see or write this JSON. */
export function buildImportProfile(choices: FormatChoices): SupplierProfile {
  const profile: SupplierProfile = {
    strategy: choices.structure === "article_finish" ? "article_plus_finish" : "exact",
    full_code_column: choices.fullCode,
    price_columns: [{ column: choices.price, price_field: "unit_price" }],
    currency: choices.currency, basis: choices.basis,
  };
  if (choices.structure === "article_finish") {
    if (choices.articleCode) profile.article_code_column = choices.articleCode;
    profile.article_length = choices.articleLength; profile.finish_length = choices.finishLength; profile.validated_article_fallback = true;
  }
  if (choices.category && choices.structure !== "simple") profile.category_column = choices.category;
  if (choices.description) profile.description_column = choices.description;
  assertSupplierProfile(profile);
  return profile;
}

/** Friendly counts from the same normalisation the real import uses. */
export function testImportProfile(rows: Parameters<typeof normalizeSupplierRows>[0], profile: SupplierProfile) {
  const identities = commercialSupplierIdentities(normalizeSupplierRows(rows, profile), profile);
  const valid = identities.filter((item) => item.issues.length === 0 && item.price !== null);
  const problems = new Map<string, number>();
  for (const item of identities) for (const issue of item.issues) problems.set(issueWords[issue] ?? "Needs a look", (problems.get(issueWords[issue] ?? "Needs a look") ?? 0) + 1);
  return { items: identities.length, valid: valid.length, attention: identities.length - valid.length, problems: [...problems.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) };
}

const guess = (headers: string[], words: string[]) => headers.find((header) => words.some((word) => header.toLowerCase().replace(/[^a-z0-9]/g, "").includes(word))) ?? "";

export function SupplierImportFormatWizard({ brandName, brandId, approver, doneHref }: { brandName: string; brandId: string; approver: boolean; doneHref: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof parseSupplierFile>>>([]); const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [choices, setChoices] = useState<FormatChoices>({ fullCode: "", articleCode: "", price: "", category: "", description: "", currency: "EUR", basis: "list", structure: "simple", articleLength: 6, finishLength: 3 });
  const [title, setTitle] = useState(`${brandName} standard price list`); const [result, setResult] = useState<ReturnType<typeof testImportProfile> | null>(null);
  const headers = rows.length ? Object.keys(rows[0].values) : [];
  const set = <K extends keyof FormatChoices>(key: K, value: FormatChoices[K]) => setChoices((current) => ({ ...current, [key]: value }));
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Something went wrong."); } finally { setBusy(false); } }
  if (!approver) return <section className={`${card} p-4 text-sm`}><h3 className="text-base font-semibold text-zinc-950">Set up import profile</h3><p className="mt-1">An approver sets up import profiles for a Brand.</p></section>;
  const column = (label: string, key: "fullCode" | "articleCode" | "price" | "category" | "description", required: boolean, help?: string) =>
    <div key={key} className="grid items-center gap-2 py-2 sm:grid-cols-[15rem_1fr]"><label htmlFor={`map-${key}`} className="text-sm font-medium text-zinc-800">{label}{required ? "" : " (optional)"}{help ? <span className="block text-xs font-normal text-zinc-500">{help}</span> : null}</label>
      <select id={`map-${key}`} value={choices[key]} onChange={(event) => set(key, event.target.value)} required={required} className={input}><option value="">{required ? "Choose column" : "Not used"}</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></div>;
  const ready = choices.fullCode && choices.price && (choices.structure !== "matrix" || choices.category) && (choices.structure !== "article_finish" || (choices.articleLength > 0 && choices.finishLength > 0));
  return <section className={`${card} space-y-4 p-4`} aria-label="Import profile setup">
    <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold" aria-label="Setup steps">{stepNames.map((name, index) => { const number = index + 1; const state = number < step ? "done" : number === step ? "current" : "todo";
      return <li key={name} className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 ${state === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : state === "current" ? "border-emerald-900 bg-emerald-900 text-white" : "border-zinc-200 text-zinc-500"}`} aria-current={state === "current" ? "step" : undefined}><span aria-hidden="true">{state === "done" ? "✓" : number}</span>{name}</li>; })}</ol>
    <div><h3 className="text-base font-semibold text-zinc-950">Set up import profile</h3><p className="text-xs text-zinc-500">{brandName} · step {step} of 4. Pick the columns of a sample price list; nothing is imported yet.</p></div>
    <p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>
    {step === 1 ? <div className="space-y-2"><label className="grid gap-1 text-xs"><span className="font-medium">Sample price list file</span>
      <input type="file" accept=".xlsx,.csv,.json" className={input} onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void run(async () => {
        const parsed = await parseSupplierFile(file); if (!parsed.length) throw Error("The sample has no data rows."); const names = Object.keys(parsed[0].values);
        setRows(parsed); setResult(null);
        setChoices((current) => ({ ...current, fullCode: guess(names, ["codicearticolo", "fullcode", "suppliercode", "itemcode", "code"]), articleCode: guess(names, ["nomefile", "article"]), price: guess(names, ["prezzo", "price", "unitprice"]), category: guess(names, ["categoria", "category", "tessuto"]), description: guess(names, ["descri", "description"]) }));
      }); }} /></label>
      {rows.length ? <p className="text-sm">{rows.length.toLocaleString("en-US")} rows and {headers.length} columns found.</p> : null}
      <button type="button" disabled={busy || !rows.length} className={primary} onClick={() => setStep(2)}>Next: choose columns</button></div> : null}
    {step === 2 ? <div className="space-y-3"><div className="divide-y divide-zinc-100 rounded-md border border-zinc-200 px-3"><div className="grid gap-2 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 sm:grid-cols-[15rem_1fr]"><span>Purpose</span><span>Source column</span></div>
      {column("Full Supplier code", "fullCode", true)}{column("Product / article code", "articleCode", false, "Used when the code is an article plus a finish.")}
      {column("Price", "price", true)}{column("Category / upholstery / dimension", "category", false)}{column("Description", "description", false)}</div>
      <div className="flex gap-2"><button type="button" className={button} onClick={() => setStep(1)}>Back</button><button type="button" disabled={!choices.fullCode || !choices.price} className={primary} onClick={() => setStep(3)}>Next: price settings</button></div></div> : null}
    {step === 3 ? <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs"><span className="font-medium">Currency</span><select value={choices.currency} onChange={(event) => set("currency", event.target.value as FormatChoices["currency"])} className={input}>{["AED", "EUR", "USD"].map((code) => <option key={code}>{code}</option>)}</select></label>
      <label className="grid gap-1 text-xs"><span className="font-medium">Price basis</span><select value={choices.basis} onChange={(event) => set("basis", event.target.value as FormatChoices["basis"])} className={input}><option value="list">List</option><option value="net">Net</option></select></label>
      <label className="grid gap-1 text-xs sm:col-span-2"><span className="font-medium">Code structure</span><select value={choices.structure} onChange={(event) => set("structure", event.target.value as CodeStructure)} className={input}>
        <option value="simple">Simple article code</option><option value="article_finish">Article + finish</option><option value="matrix">Category / matrix</option></select>
        <span className="text-zinc-600">For anything more complex, use Advanced import settings.</span></label>
      {choices.structure === "article_finish" ? <><label className="grid gap-1 text-xs"><span className="font-medium">Article code length</span><input type="number" min={1} value={choices.articleLength} onChange={(event) => set("articleLength", Number(event.target.value))} className={input} /></label>
        <label className="grid gap-1 text-xs"><span className="font-medium">Finish code length</span><input type="number" min={1} value={choices.finishLength} onChange={(event) => set("finishLength", Number(event.target.value))} className={input} /></label></> : null}
      {choices.structure === "matrix" && !choices.category ? <p className="text-xs text-amber-800 sm:col-span-2">Choose the category column in the previous step.</p> : null}
      <label className="grid gap-1 text-xs sm:col-span-2"><span className="font-medium">Profile name</span><input value={title} onChange={(event) => setTitle(event.target.value)} className={input} /></label></div>
      <div className="flex gap-2"><button type="button" className={button} onClick={() => setStep(2)}>Back</button><button type="button" disabled={busy || !ready || !title.trim()} className={primary} onClick={() => void run(async () => { setResult(testImportProfile(rows, buildImportProfile(choices))); setStep(4); })}>Test import</button></div></div> : null}
    {step === 4 && result ? <div className="space-y-3"><dl className="grid grid-cols-3 gap-3 text-sm"><div><dt className="text-xs text-zinc-600">Supplier items detected</dt><dd className="font-semibold tabular-nums">{result.items.toLocaleString("en-US")}</dd></div>
      <div><dt className="text-xs text-zinc-600">Valid</dt><dd className="font-semibold tabular-nums">{result.valid.toLocaleString("en-US")}</dd></div><div><dt className="text-xs text-zinc-600">Need attention</dt><dd className={`font-semibold tabular-nums ${result.attention ? "text-amber-800" : ""}`}>{result.attention.toLocaleString("en-US")}</dd></div></dl>
      {result.problems.length ? <ul className="list-inside list-disc text-xs">{result.problems.map(([label, count]) => <li key={label}>{count} × {label}</li>)}</ul> : null}
      {result.valid === 0 ? <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">No valid items were found. Go back and check the columns.</p> : null}
      <div className="flex gap-2"><button type="button" className={button} onClick={() => setStep(3)}>Back</button>
        <button type="button" disabled={busy || result.valid === 0} className={primary} onClick={() => void run(async () => { await saveSupplierProfile(brandId, title.trim(), buildImportProfile(choices)); router.push(doneHref); router.refresh(); })}>Save import profile</button></div></div> : null}
  </section>;
}
