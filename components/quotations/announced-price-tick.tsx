import { announcementItemNote, announcementTickText, type AnnouncementView } from "@/lib/products/price-announcements";

/**
 * The quotation option for one product: off by default. Ticking raises this item's price only; the library price is never changed.
 * `upliftedTotals` is the supplier price with the percent, before conversion. `blockedReason` disables it (the user kept a fixed quote price).
 */
export function AnnouncedPriceTick({ announcement, checked, onChange, upliftedTotals, blockedReason, formatAmount }: {
  announcement: AnnouncementView | null | undefined; checked: boolean; onChange: (checked: boolean) => void; upliftedTotals?: Record<string, number> | null; blockedReason?: string | null; formatAmount: (currency: string, amount: number) => string;
}) {
  if (!announcement || announcement.state !== "active") return null;
  return <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-sky-950" data-testid="announced-price-tick">
    <label className="flex items-start gap-2 font-semibold">
      <input type="checkbox" checked={checked} disabled={Boolean(blockedReason)} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 accent-emerald-900" />
      {announcementTickText(announcement)}
    </label>
    {blockedReason ? <p className="mt-1 text-[11px]">{blockedReason}</p> : null}
    {checked && upliftedTotals ? <p className="mt-1 text-[11px]">{announcementItemNote(announcement)}. Supplier price: {Object.entries(upliftedTotals).map(([currency, amount]) => formatAmount(currency, amount)).join(" + ")}. The library price is not changed.</p> : null}
  </div>;
}
