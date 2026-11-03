"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { releaseManualPriceListAction } from "./manual-price-check-actions";

export type ManualReleaseRow = { id: string; effectiveFrom: string; note: string; createdByName?: string };
const field = "h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-emerald-800";
const button = "inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50";

/**
 * Small control on a Brand's price-update card. It shows the Brand's price check method (read only; it is changed on the Brands page).
 * Everyone who can read the card sees the release history of a manual Brand; only price approvers (canManage) get the buttons.
 * All rules live in the database functions.
 */
export function ManualPriceCheckPanel({ brandId, brandName, manual, releases, canManage, today }: { brandId: string; brandName: string; manual: boolean; releases: ManualReleaseRow[]; canManage: boolean; today: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const run = (work: () => Promise<void>, done: string) => start(async () => {
    setMessage("");
    try { await work(); setMessage(done); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save."); }
  });
  return <div className="space-y-2 border-t border-zinc-100 pt-3 text-xs" aria-label={`Manual price check for ${brandName}`}>
    <p className="text-zinc-700" data-testid="price-check-method">Price check method: <span className="font-semibold text-zinc-900">{manual ? "Manual" : "Codes"}</span>{canManage ? <> · <Link href={`/products/brands?brand=${brandId}&editBrand=${brandId}`} className="font-semibold text-emerald-900 underline">Edit brand</Link></> : null}</p>
    {manual ? <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-zinc-800">Manual price check</p>
        {canManage ? <button type="button" className={button} onClick={() => setOpen((value) => !value)}>New price list released</button> : null}
      </div>
      {open && canManage ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); run(async () => { await releaseManualPriceListAction(brandId, date, note); setOpen(false); setNote(""); }, "Release recorded. Products show Price update due from that date."); }}>
        <label className="grid gap-1 font-semibold text-zinc-700">Effective date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={field} /></label>
        <label className="grid min-w-40 flex-1 gap-1 font-semibold text-zinc-700">Note<input type="text" maxLength={200} value={note} placeholder="For example: Colan 2026.1.15 list" onChange={(event) => setNote(event.target.value)} className={field} /></label>
        <button type="submit" disabled={pending} className={button}>{pending ? "Saving…" : "Save release"}</button>
      </form> : null}
      {releases.length ? <ul className="space-y-0.5 text-zinc-600">{releases.slice(0, 5).map((release) => <li key={release.id}>{release.effectiveFrom}{release.note ? ` · ${release.note}` : ""}{release.createdByName ? ` · by ${release.createdByName}` : ""}{release.effectiveFrom > today ? " · not started yet" : ""}</li>)}{releases.length > 5 ? <li>and {releases.length - 5} older</li> : null}</ul> : <p className="text-zinc-500">No price list released yet.</p>}
    </> : null}
    {message ? <p role="status" className="text-zinc-700">{message}</p> : null}
  </div>;
}
