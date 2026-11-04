import type { SupabaseClient } from "@supabase/supabase-js";

// Announced price change notices. A notice is only a record: nothing here changes a library price. Pure rules first, then the thin database
// reads and writes (SECURITY DEFINER functions only). The quotation option uses the rules below to raise ONE item's price.

export type AnnouncementFacts = { priceCheckMode: "supplier_codes" | "manual"; latestSupplierList: string | null; latestManualRelease: string | null };
export type AnnouncementRow = { id: string; brandId: string; percent: number; effectiveFrom: string; note: string; approximate: boolean; createdByName?: string };
/** active: sales see the badge and the quotation tick box. official_list_received: only the Price Updates screens show it, so it can be closed. */
export type AnnouncementState = "active" | "official_list_received";
export type AnnouncementView = AnnouncementRow & { state: AnnouncementState };

/**
 * The official list has arrived when the Brand has a list on or after the notice date: an imported Supplier price list for a Brand with codes,
 * a recorded "New price list released" for a manual Brand. Each Brand is judged by its own method only.
 */
export function officialListReceived(notice: Pick<AnnouncementRow, "effectiveFrom">, facts: AnnouncementFacts | undefined): boolean {
  if (!facts) return false;
  const latest = facts.priceCheckMode === "manual" ? facts.latestManualRelease : facts.latestSupplierList;
  return Boolean(latest) && latest!.slice(0, 10) >= notice.effectiveFrom.slice(0, 10);
}
export const announcementView = (notice: AnnouncementRow, facts: AnnouncementFacts | undefined): AnnouncementView => ({ ...notice, state: officialListReceived(notice, facts) ? "official_list_received" : "active" });

const shortDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
/** 3 -> "3", 2.5 -> "2.5", 2.125 -> "2.125". The sign is left to the caller. */
const plainPercent = (percent: number) => String(Number(Math.abs(percent).toFixed(3)));
/** "+3%" or "-2.5%". */
export const signedPercent = (percent: number) => `${percent < 0 ? "-" : "+"}${plainPercent(percent)}%`;

type Wording = Pick<AnnouncementRow, "percent" | "effectiveFrom" | "approximate">;
/** "Price rise of about 3% announced from 1 Dec 2026 (approximate). New price list not received yet." */
export function announcementBanner(notice: Wording): string {
  const kind = notice.percent < 0 ? "Price drop" : "Price rise";
  return `${kind} of ${notice.approximate ? "about " : ""}${plainPercent(notice.percent)}% announced from ${shortDate(notice.effectiveFrom)}${notice.approximate ? " (approximate)" : ""}. New price list not received yet.`;
}
/** "+3% announced from 1 Dec 2026". Information only. */
export const announcementBadge = (notice: Pick<AnnouncementRow, "percent" | "effectiveFrom">) => `${signedPercent(notice.percent)} announced from ${shortDate(notice.effectiveFrom)}`;
const qualifier = (notice: Pick<AnnouncementRow, "approximate">) => notice.approximate ? " (approximate)" : "";
/** "Add announced +3% (approximate)". */
export const announcementTickText = (notice: Pick<AnnouncementRow, "percent" | "approximate">) => `Add announced ${signedPercent(notice.percent)}${qualifier(notice)}`;
/** "Includes announced +3% (approximate)". Recorded on the quotation item. */
export const announcementItemNote = (notice: Pick<AnnouncementRow, "percent" | "approximate">) => `Includes announced ${signedPercent(notice.percent)}${qualifier(notice)}`;
export const officialListText = "Official list received. Close this notice when you are ready.";
export const oneOpenNoticeText = "This Brand already has an open notice. Cancel or close it before adding another.";

/** The form's percent: signed, not 0, more than -100, at most 100, at most 3 decimals. Returns the number, or the reason it is refused. */
export function parseAnnouncementPercent(value: unknown): { percent: number } | { error: string } {
  const text = String(value ?? "").trim().replace(/%$/, "").trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return { error: "Enter the percent as a number, for example 3 or -2.5." };
  const percent = Number(text);
  if (percent === 0 || percent <= -100 || percent > 100) return { error: "Enter a percent other than 0, between -99.999 and 100." };
  if (Number(percent.toFixed(3)) !== percent) return { error: "Use at most 3 decimals." };
  return { percent };
}

/** Half up to 2 decimals, without binary fraction surprises (1.515 becomes 1.52). */
export function roundHalfUp2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Number((value * 100).toPrecision(12))) / 100;
}
/** One supplier amount with the percent added: 319.00 at 3% is 328.57. */
export const withAnnouncedPercent = (amount: number, percent: number) => roundHalfUp2(amount * (100000 + Math.round(percent * 1000)) / 100000);

export type AnnouncedTotals = { original: Record<string, number>; uplifted: Record<string, number>; delta: Record<string, number> };
/**
 * Applies the percent to the supplier totals per currency, before conversion, discount or profit. `excluded` holds amounts of linked products of
 * another Brand: they are part of the total, but this Brand's notice does not touch them.
 */
export function announcedTotals(input: { totals: Record<string, number>; excluded?: Record<string, number>; percent: number }): AnnouncedTotals {
  const original: Record<string, number> = {}, uplifted: Record<string, number> = {}, delta: Record<string, number> = {};
  for (const [currency, amount] of Object.entries(input.totals)) {
    const excluded = input.excluded?.[currency] ?? 0;
    const after = roundHalfUp2(withAnnouncedPercent(Math.max(amount - excluded, 0), input.percent) + excluded);
    original[currency] = roundHalfUp2(amount); uplifted[currency] = after; delta[currency] = roundHalfUp2(after - amount);
  }
  return { original, uplifted, delta };
}
/** What the percent adds to the quotation price before the quotation rounding: each currency's change at its rate (AED is 1). */
export function announcedQuotationDelta(delta: Record<string, number>, rates: Record<string, unknown> | ReadonlyMap<string, unknown>): number {
  const rate = (currency: string) => { const raw = rates instanceof Map ? rates.get(currency) : (rates as Record<string, unknown>)[currency]; const parsed = Number(raw); return Number.isFinite(parsed) ? parsed : 0; };
  return Object.entries(delta).reduce((total, [currency, amount]) => total + (currency === "AED" ? amount : amount * rate(currency)), 0);
}

/** Stored in the item's source_component_data, so the quotation can explain its price later. Old items simply do not have it. */
export type AnnouncedPriceChangeSnapshot = {
  notice_id: string; percent: number; approximate: boolean; effective_from: string; note: string; note_text: string;
  original_totals: Record<string, number>; uplifted_totals: Record<string, number>;
};
export function announcedSnapshot(notice: Pick<AnnouncementRow, "id" | "percent" | "approximate" | "effectiveFrom" | "note">, totals: AnnouncedTotals): AnnouncedPriceChangeSnapshot {
  return { notice_id: notice.id, percent: notice.percent, approximate: notice.approximate, effective_from: notice.effectiveFrom, note: notice.note, note_text: announcementItemNote(notice), original_totals: totals.original, uplifted_totals: totals.uplifted };
}
/** The recorded uplift of an item, or null for items without one (including all older items and drafts). */
export function announcedSnapshotOf(sourceComponentData: unknown): AnnouncedPriceChangeSnapshot | null {
  if (!sourceComponentData || typeof sourceComponentData !== "object") return null;
  const value = (sourceComponentData as { announced_price_change?: unknown }).announced_price_change;
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<AnnouncedPriceChangeSnapshot>;
  return typeof snapshot.notice_id === "string" && typeof snapshot.percent === "number" ? snapshot as AnnouncedPriceChangeSnapshot : null;
}

// ---- Database reads and writes (SECURITY DEFINER functions only) ----
type StateRow = {
  notices?: Array<{ id: string; brand_id: string; percent: number | string; effective_from: string; note: string; approximate: boolean; created_by_name?: string | null }>;
  brands?: Array<{ brand_id: string; price_check_mode: string; latest_supplier_list: string | null; latest_manual_release: string | null }>;
};
export function announcementViewsFromRows(rows: StateRow[]): Map<string, AnnouncementView> {
  const facts = new Map<string, AnnouncementFacts>();
  for (const row of rows) for (const brand of row.brands ?? []) facts.set(brand.brand_id, { priceCheckMode: brand.price_check_mode === "manual" ? "manual" : "supplier_codes", latestSupplierList: brand.latest_supplier_list, latestManualRelease: brand.latest_manual_release });
  const views = new Map<string, AnnouncementView>();
  for (const row of rows) for (const notice of row.notices ?? []) {
    views.set(notice.brand_id, announcementView({ id: notice.id, brandId: notice.brand_id, percent: Number(notice.percent), effectiveFrom: String(notice.effective_from).slice(0, 10), note: notice.note ?? "", approximate: notice.approximate !== false, ...(notice.created_by_name?.trim() ? { createdByName: notice.created_by_name.trim() } : {}) }, facts.get(notice.brand_id)));
  }
  return views;
}
/** The open notice of each Brand. Before the migration is applied, or for roles that cannot read it, there simply are none. */
export async function loadBrandPriceAnnouncements(client: SupabaseClient, brandIds: string[]): Promise<Map<string, AnnouncementView>> {
  const rows: StateRow[] = [];
  const unique = [...new Set(brandIds)];
  for (let from = 0; from < unique.length; from += 50) {
    const { data, error } = await client.rpc("brand_price_announcements_state", { p_brand_ids: unique.slice(from, from + 50) });
    if (error && ["PGRST202", "42883", "42501"].includes(error.code ?? "")) return new Map();
    if (error) throw Error(error.message);
    rows.push((data ?? {}) as StateRow);
  }
  return announcementViewsFromRows(rows);
}
export async function addBrandPriceAnnouncement(client: SupabaseClient, input: { brandId: string; percent: number; effectiveFrom: string; note: string; approximate: boolean }) {
  const { error } = await client.rpc("brand_price_announcement_add", { p_brand_id: input.brandId, p_percent: input.percent, p_effective_from: input.effectiveFrom, p_note: input.note, p_approximate: input.approximate });
  if (error) throw Error(error.message);
}
export async function endBrandPriceAnnouncement(client: SupabaseClient, id: string, how: "cancel" | "close") {
  const { error } = await client.rpc(how === "cancel" ? "brand_price_announcement_cancel" : "brand_price_announcement_close", { p_id: id });
  if (error) throw Error(error.message);
}
