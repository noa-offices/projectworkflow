import type { SupabaseClient } from "@supabase/supabase-js";

// Manual price check mode (Brands with no Supplier codes). Pure rules first, then the thin database reads and writes.
// The rules are used by the shared status resolver (supplier-family-status.ts); no screen decides status on its own.

export type PriceCheckMode = "supplier_codes" | "manual";
export type ManualPriceRelease = { id: string; brandId: string; effectiveFrom: string; note: string; createdByName?: string; createdAt: string };
/** The newest sign-off for one release and one product. */
export type ManualPriceCheckFact = { releaseId: string; templateId: string; pricingVersion: string; checkedAt: string; checkedByName?: string };
export type ManualBrandState = { brandId: string; releases: ManualPriceRelease[]; checks: ManualPriceCheckFact[] };
export type ManualPriceState = Map<string, ManualBrandState>;

export type ManualFamilyStatus =
  | { status: "legacy_manual"; detail: string }
  | { status: "price_update_due"; release: ManualPriceRelease; detail: string }
  | { status: "price_checked"; release: ManualPriceRelease; checkedAt: string; checkedByName?: string; detail: string }
  | { status: "edited_since_check"; release: ManualPriceRelease; checkedAt: string; detail: string };

/** Newest first: release date, then when it was recorded, then id. */
function newestFirst(a: ManualPriceRelease, b: ManualPriceRelease) {
  return b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}
/** The latest release whose effective date has passed (the business date counts). Future releases are ignored. */
export function latestPassedManualRelease(releases: ManualPriceRelease[], businessDate: string): ManualPriceRelease | null {
  return [...releases].filter((release) => release.effectiveFrom <= businessDate).sort(newestFirst)[0] ?? null;
}
/** The next release that has not started yet, if any. */
export function upcomingManualRelease(releases: ManualPriceRelease[], businessDate: string): ManualPriceRelease | null {
  return [...releases].filter((release) => release.effectiveFrom > businessDate).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

const shortDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
const releaseName = (release: ManualPriceRelease) => release.note ? `${release.note} (from ${shortDate(release.effectiveFrom)})` : `Price list from ${shortDate(release.effectiveFrom)}`;

/**
 * Status of ONE product of a manual Brand.
 * - no release has started yet: "Manual price check"
 * - latest started release, no check for it: "Price update due" (a check for an older release does not count)
 * - checked for it, product pricing version unchanged: "Price checked"
 * - checked for it, but the pricing version changed since: "Edited since check"
 * `pricingVersion` is the product's current version; when unknown a check is ignored, so the product stays due.
 */
export function resolveManualFamilyStatus(input: { state: ManualBrandState | undefined; templateId: string; pricingVersion: string | null; businessDate: string }): ManualFamilyStatus {
  const release = input.state ? latestPassedManualRelease(input.state.releases, input.businessDate) : null;
  if (!input.state || !release) return { status: "legacy_manual", detail: "Manual price check" };
  const check = input.pricingVersion === null ? undefined : input.state.checks.filter((item) => item.releaseId === release.id && item.templateId === input.templateId).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  if (!check) return { status: "price_update_due", release, detail: `New price list: ${releaseName(release)}. Check this product's prices.` };
  if (check.pricingVersion === input.pricingVersion) return { status: "price_checked", release, checkedAt: check.checkedAt, ...(check.checkedByName ? { checkedByName: check.checkedByName } : {}), detail: `${releaseName(release)}: checked on ${shortDate(check.checkedAt)}${check.checkedByName ? ` by ${check.checkedByName}` : ""}` };
  return { status: "edited_since_check", release, checkedAt: check.checkedAt, detail: `${releaseName(release)}: product prices changed after the check on ${shortDate(check.checkedAt)}` };
}

// ---- Database reads and writes (SECURITY DEFINER functions only) ----
type StateRow = {
  brand_ids?: string[];
  releases?: Array<{ id: string; brand_id: string; effective_from: string; note: string; created_by_name?: string | null; created_at: string }>;
  checks?: Array<{ release_id: string; template_id: string; pricing_version: string; checked_at: string; checked_by_name?: string | null }>;
};
export function manualPriceStateFromRows(rows: StateRow[]): ManualPriceState {
  const state: ManualPriceState = new Map();
  for (const row of rows) for (const brandId of row.brand_ids ?? []) if (!state.has(brandId)) state.set(brandId, { brandId, releases: [], checks: [] });
  const brandOfRelease = new Map<string, string>();
  for (const row of rows) for (const release of row.releases ?? []) {
    const brand = state.get(release.brand_id); if (!brand) continue;
    brandOfRelease.set(release.id, release.brand_id);
    brand.releases.push({ id: release.id, brandId: release.brand_id, effectiveFrom: String(release.effective_from).slice(0, 10), note: release.note ?? "", ...(release.created_by_name?.trim() ? { createdByName: release.created_by_name.trim() } : {}), createdAt: release.created_at });
  }
  for (const row of rows) for (const check of row.checks ?? []) {
    const brand = state.get(brandOfRelease.get(check.release_id) ?? ""); if (!brand) continue;
    brand.checks.push({ releaseId: check.release_id, templateId: check.template_id, pricingVersion: String(check.pricing_version), checkedAt: check.checked_at, ...(check.checked_by_name?.trim() ? { checkedByName: check.checked_by_name.trim() } : {}) });
  }
  return state;
}
/** Manual Brands among these, with releases and checks. Before the migration, or for roles that cannot read it, this reads as "no manual Brands". */
export async function loadManualPriceState(client: SupabaseClient, brandIds: string[]): Promise<ManualPriceState> {
  const rows: StateRow[] = [];
  const unique = [...new Set(brandIds)];
  for (let from = 0; from < unique.length; from += 50) {
    const { data, error } = await client.rpc("brand_price_manual_state", { p_brand_ids: unique.slice(from, from + 50) });
    if (error && ["PGRST202", "42883", "42501"].includes(error.code ?? "")) return new Map();
    if (error) throw Error(error.message);
    rows.push((data ?? {}) as StateRow);
  }
  return manualPriceStateFromRows(rows);
}
export async function setBrandPriceCheckMode(client: SupabaseClient, brandId: string, mode: PriceCheckMode) {
  const { error } = await client.rpc("brand_price_check_mode_set", { p_brand_id: brandId, p_mode: mode });
  if (error) throw Error(error.message);
}
export async function addManualPriceRelease(client: SupabaseClient, input: { brandId: string; effectiveFrom: string; note: string }) {
  const { error } = await client.rpc("brand_price_release_add", { p_brand_id: input.brandId, p_effective_from: input.effectiveFrom, p_note: input.note });
  if (error) throw Error(error.message);
}
export async function markManualPriceChecked(client: SupabaseClient, input: { templateId: string; releaseId: string; expectedPricingVersion: string }) {
  const { error } = await client.rpc("brand_price_release_check_set", { p_template_id: input.templateId, p_release_id: input.releaseId, p_expected_pricing_version: input.expectedPricingVersion });
  if (error) throw Error(error.message);
}
