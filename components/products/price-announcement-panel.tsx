"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { announcePriceChangeAction, endPriceAnnouncementAction } from "./price-announcement-actions";
import { announcementBanner, officialListText, oneOpenNoticeText, type AnnouncementView } from "@/lib/products/price-announcements";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
const field = "h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs font-normal outline-none focus:border-emerald-800";
const button = `inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 ${focusRing}`;

/**
 * The Brand's price change notice on the Price Updates screens: the banner, and for price approvers the add, cancel and close controls.
 * A notice is a record only: nothing here changes a price. All rules live in the database functions.
 */
export function BrandPriceAnnouncementPanel({ brandId, brandName, announcement, canManage, today }: { brandId: string; brandName: string; announcement: AnnouncementView | null | undefined; canManage: boolean; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState(""), [date, setDate] = useState(today), [note, setNote] = useState(""), [approximate, setApproximate] = useState(true);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const run = (work: () => Promise<void>, done: string) => start(async () => {
    setMessage("");
    try { await work(); setMessage(done); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save."); }
  });
  const end = (how: "cancel" | "close") => {
    if (!announcement) return;
    if (!window.confirm(how === "cancel" ? "Cancel this price change notice? The record is kept. Items already quoted keep their price." : "Close this price change notice? The record is kept. Items already quoted keep their price.")) return;
    run(() => endPriceAnnouncementAction(announcement.id, how), how === "cancel" ? "Notice cancelled." : "Notice closed.");
  };
  if (!announcement && !canManage) return null;
  return <div className="space-y-2 text-xs" aria-label={`Price change notice for ${brandName}`}>
    {announcement?.state === "active" ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-sky-950">
      <p className="min-w-0 font-medium" data-testid="announcement-banner">{announcementBanner(announcement)}{announcement.note ? ` ${announcement.note}` : ""}</p>
      {canManage ? <button type="button" disabled={pending} className={button} onClick={() => end("cancel")}>Cancel notice</button> : null}
    </div> : null}
    {announcement?.state === "official_list_received" ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-zinc-700">
      <p className="min-w-0 font-medium" data-testid="announcement-official">{officialListText}</p>
      {canManage ? <button type="button" disabled={pending} className={button} onClick={() => end("close")}>Close notice</button> : null}
    </div> : null}
    {canManage ? <button type="button" className={button} disabled={Boolean(announcement)} title={announcement ? oneOpenNoticeText : undefined} aria-expanded={open} onClick={() => setOpen((value) => !value)}>Announce price change</button> : null}
    {canManage && !announcement && open ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); run(async () => { await announcePriceChangeAction({ brandId, percent, effectiveFrom: date, note, approximate }); setOpen(false); setPercent(""); setNote(""); }, "Notice saved. No price was changed."); }}>
      <label className="grid gap-1 font-semibold text-zinc-700">Percent<input type="text" inputMode="decimal" required value={percent} placeholder="3 or -2.5" onChange={(event) => setPercent(event.target.value)} className={`${field} w-24`} /></label>
      <label className="grid gap-1 font-semibold text-zinc-700">Effective date<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={field} /></label>
      <label className="grid min-w-40 flex-1 gap-1 font-semibold text-zinc-700">Note<input type="text" maxLength={200} value={note} placeholder="For example: supplier email of 3 Nov" onChange={(event) => setNote(event.target.value)} className={field} /></label>
      <label className="flex h-8 items-center gap-1.5 font-semibold text-zinc-700"><input type="checkbox" checked={approximate} onChange={(event) => setApproximate(event.target.checked)} className="accent-emerald-900" />Approximate</label>
      <button type="submit" disabled={pending} className={button}>{pending ? "Saving…" : "Save notice"}</button>
    </form> : null}
    {message ? <p role="status" className="text-zinc-700">{message}</p> : null}
  </div>;
}
