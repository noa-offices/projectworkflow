import type { BaseModelPricingSubgroup } from "./base-model-pricing-groups";

export type AutoGroupableRow = { id: string; label: string | null; displayName: string | null };

/**
 * Strips only a trailing variable size/dimension token (e.g. " - 120", " 140x80", " W120", " 35 MM")
 * from a commercial name, one token at a time, to derive a stable presentation family label.
 * Never touches leading or interior words, so meaningful distinctions (Q vs L, Desk vs Bench,
 * COMBY vs P58, Top Access vs not) are always preserved.
 */
const TRAILING_VARIANT_TOKEN = /(?:^|[-–—\s([])\s*W?\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?){0,3}\)?\s*(?:MM|CM)?\s*$/i;

export function deriveVisualSubgroupFamilyLabel(name: string): string {
  let label = name.trim();
  for (;;) {
    const next = label.replace(TRAILING_VARIANT_TOKEN, "").trim().replace(/[-–—,]+$/, "").trim();
    if (next === label || !next) return next || label;
    label = next;
  }
}

function familySlug(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "family";
}

/**
 * Infers an INITIAL review-only visual-subgroup organization for Base/Model rows that have no
 * explicit subgroup assignment yet. Only ever called when the reviewed draft has zero existing
 * subgroups for the route (see GROUPING SOURCE PRIORITY: explicit metadata is always authoritative
 * and is never overwritten by this). Groups only form when at least two rows share the exact same
 * derived family label; every other row is left out entirely so it falls through to Ungrouped —
 * ambiguous or single-occurrence names are never forced into a group.
 */
export function inferBaseModelVisualSubgroups<TRow extends AutoGroupableRow>(rows: readonly TRow[]): BaseModelPricingSubgroup[] {
  const familyOrder: string[] = [];
  const rowIdsByFamily = new Map<string, string[]>();
  rows.forEach((row) => {
    const name = (row.displayName ?? row.label ?? "").trim();
    if (!name) return;
    const family = deriveVisualSubgroupFamilyLabel(name);
    if (!family || /^\d+$/.test(family)) return;
    if (!rowIdsByFamily.has(family)) { rowIdsByFamily.set(family, []); familyOrder.push(family); }
    rowIdsByFamily.get(family)?.push(row.id);
  });
  return familyOrder
    .filter((family) => (rowIdsByFamily.get(family) ?? []).length >= 2)
    .map((family, index) => ({ id: `auto-${familySlug(family)}`, subgroup_name: family, sort_order: index, is_active: true, row_ids: rowIdsByFamily.get(family) ?? [] }));
}
