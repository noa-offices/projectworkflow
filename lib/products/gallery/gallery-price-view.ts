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

const reasonTexts: Record<string, string> = {
  unresolved_choices: "Some saved choices changed in the product",
  invalid_recipe: "Some saved choices changed in the product",
  retired_template: "This product is no longer active",
  ambiguous_precedence: "Modular and workstation pricing both apply",
  unresolved_linked_product: "A linked product could not be resolved",
};
export const configureReasonText = (reason?: string) => (reason && Object.hasOwn(reasonTexts, reason) ? reasonTexts[reason] : null) || "Price cannot be calculated here";

type AedPart = { amounts: string[]; notes: string[]; missing: string[]; noRate: boolean } | null;
/** Decides which lines the price box shows, and which one is the large headline. */
export function galleryPriceLayout(sourceTotals: ReadonlyArray<{ currency: string; amount: number }>, aed: AedPart) {
  const source = sourceTotals.map(({ currency, amount }) => formatMoney(currency, amount));
  if (aed && !aed.noRate && aed.amounts.length === 1 && !aed.missing.length) {
    return { headline: aed.amounts[0], lines: source, notes: aed.notes, muted: [] as string[] };
  }
  if (aed && !aed.noRate) {
    return { headline: null, lines: [...source, ...aed.amounts], notes: aed.notes, muted: aed.missing.map((c) => `No rate for ${c}`) };
  }
  return { headline: source.join(" + "), lines: [] as string[], notes: [] as string[], muted: aed?.noRate ? ["No rate set"] : [] };
}

/** The compact list row: one bold amount on the left, the rest small and muted on the right. */
export function galleryPriceRow(layout: ReturnType<typeof galleryPriceLayout>) {
  if (layout.headline) return { primary: layout.headline, secondary: layout.lines.length ? layout.lines.join(" + ") : layout.muted[0] ?? "" };
  const [first = "", ...rest] = layout.lines;
  return { primary: first, secondary: rest.join(" + ") };
}

export function galleryPriceView(templateId: string, price: GalleryPriceState) {
  if (!price) return null;
  if (price === "loading") return { kind: "loading" } as const;
  if (price.status === "needs_configure") return { kind: "configure", href: fullDetailHref(templateId), reason: configureReasonText("reason" in price ? price.reason : undefined) } as const;
  if (!price.sourceTotals.length) return null;
  const { checkedAt, checkedByName, state } = price.priceCheck;
  const checked = checkedAt && Number.isFinite(Date.parse(checkedAt))
    ? `Checked on ${dateFormat.format(new Date(checkedAt))}${checkedByName ? ` by ${checkedByName}` : ""}`
    : null;
  const badge = state.key === "current" || state.key === "needs_check" ? badges[state.key] : null;
  return { kind: "priced", amount: price.sourceTotals.map(({ currency, amount }) => formatMoney(currency, amount)).join(" + "), badge, checked } as const;
}

export async function fetchGalleryListFacts(ids: string[], fetch: (ids: string[]) => Promise<PriceResponse>): Promise<{ prices: PriceEntries; dimensions: Record<string, string> }> {
  const distinct = [...new Set(ids)];
  const pending: Array<Promise<PriceResponse>> = [];
  for (let offset = 0; offset < distinct.length; offset += 60) {
    const batch = distinct.slice(offset, offset + 60);
    pending.push(Promise.resolve().then(() => fetch(batch)));
  }
  const results = await Promise.allSettled(pending);
  const ok = results.flatMap((result) => result.status === "fulfilled" && result.value.ok ? [result.value] : []);
  return {
    prices: Object.assign({}, ...ok.map((value) => value.prices)),
    dimensions: Object.assign({}, ...ok.map((value) => value.dimensions ?? {})),
  };
}

/** Prices only (one action per normal page, split over 60). */
export async function fetchGalleryPriceBatches(ids: string[], fetch: (ids: string[]) => Promise<PriceResponse>): Promise<PriceEntries> {
  return (await fetchGalleryListFacts(ids, fetch)).prices;
}
