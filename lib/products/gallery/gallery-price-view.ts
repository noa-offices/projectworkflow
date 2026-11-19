import { formatMoney } from "@/lib/currencies";
import { supplierFamilyStatusLabels } from "@/lib/products/supplier-family-status";
import type { getGalleryPricesAction } from "./gallery-actions";
import { fullDetailHref } from "./gallery-view";

type PriceResponse = Awaited<ReturnType<typeof getGalleryPricesAction>>;
type PriceEntries = Extract<PriceResponse, { ok: true }>["prices"];
export type GalleryPriceEntry = PriceEntries[string];
export type GalleryPriceState = GalleryPriceEntry | "loading" | undefined;

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
const badges = {
  current: { label: supplierFamilyStatusLabels.price_checked, tone: "ok" },
  needs_check: { label: supplierFamilyStatusLabels.update_available, tone: "warning" },
} as const;

export function galleryPriceView(templateId: string, price: GalleryPriceState) {
  if (!price) return null;
  if (price === "loading") return { kind: "loading" } as const;
  if (price.status === "needs_configure") return { kind: "configure", href: fullDetailHref(templateId) } as const;
  if (!price.sourceTotals.length) return null;
  const { checkedAt, checkedByName, state } = price.priceCheck;
  const checked = checkedAt && Number.isFinite(Date.parse(checkedAt))
    ? `Checked on ${dateFormat.format(new Date(checkedAt))}${checkedByName ? ` by ${checkedByName}` : ""}`
    : null;
  const badge = state.key === "current" || state.key === "needs_check" ? badges[state.key] : null;
  return { kind: "priced", amount: price.sourceTotals.map(({ currency, amount }) => formatMoney(currency, amount)).join(" + "), badge, checked } as const;
}

export async function fetchGalleryPriceBatches(ids: string[], fetch: (ids: string[]) => Promise<PriceResponse>): Promise<PriceEntries> {
  const distinct = [...new Set(ids)];
  const pending: Array<Promise<PriceResponse>> = [];
  for (let offset = 0; offset < distinct.length; offset += 60) {
    const batch = distinct.slice(offset, offset + 60);
    pending.push(Promise.resolve().then(() => fetch(batch)));
  }
  const results = await Promise.allSettled(pending);
  return Object.assign({}, ...results.flatMap((result) =>
    result.status === "fulfilled" && result.value.ok ? [result.value.prices] : []));
}
