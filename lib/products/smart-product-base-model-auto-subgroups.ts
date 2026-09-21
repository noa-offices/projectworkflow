import type { BaseModelPricingSubgroup } from "./base-model-pricing-groups";

export type AutoGroupableRow = { id: string; label: string | null; displayName: string | null; role?: string };

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

/**
 * Product-family label for NATIVE System groups. Width/depth/height tokens (W120, D 70, D145,2, ...) are removed
 * wherever they appear in the name (start, middle or end), "with Top-Access" / "Top Access" variants are normalized
 * to one "+ Top Access" suffix, plain-top wording and the "for <system>" reference are dropped (every row in a
 * native group belongs to the same System), and the product-type word (Desk, Bench, ...) moves after the series
 * name. Series names (Sigma_Q vs Sigma_L) and product types (Desk vs Bench) are preserved, and supplier codes are
 * never consulted.
 */
const SIZE_TOKEN = /(?<![A-Za-z0-9_])[WDH]\s*\d+(?:[.,]\d+)?(?:\s*(?:MM|CM))?(?![A-Za-z0-9_])/gi;
const DANGLING_SIZE_LETTER = /(?<![A-Za-z0-9_])[WDH](?![A-Za-z0-9_])/g;
const TOP_ACCESS = /(?:(?:\bwith|\bw\/)\s*)?\btop[\s-]*access\b/i;
const PLAIN_TOP = /\bplain(?:\s+tops?)?\b/i;
const FOR_SYSTEM_CLAUSE = /\s+for\s+.*$/i;
const PRODUCT_TYPE_FIRST = /^(desk|bench|table|cabinet|pedestal|credenza|workstation|return)\s+(\S.*)$/i;
const EDGE_NOISE = /^[\s\-–—,+/]+|[\s\-–—,+/]+$/g;

export function deriveProductFamilyLabel(name: string): string {
  const original = name.trim();
  const topAccess = TOP_ACCESS.test(original);
  let label = original.replace(TOP_ACCESS, " ").replace(PLAIN_TOP, " ").replace(SIZE_TOKEN, " ").replace(DANGLING_SIZE_LETTER, " ");
  label = label.replace(/\s+/g, " ").replace(EDGE_NOISE, "").replace(FOR_SYSTEM_CLAUSE, "").replace(EDGE_NOISE, "");
  label = deriveVisualSubgroupFamilyLabel(label).replace(EDGE_NOISE, "");
  if (!label) return original;
  const reordered = label.match(PRODUCT_TYPE_FIRST);
  if (reordered) label = `${reordered[2]} ${reordered[1]}`;
  return topAccess ? `${label} + Top Access` : label;
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
export function inferBaseModelVisualSubgroups<TRow extends AutoGroupableRow>(rows: readonly TRow[], deriveFamily: (name: string) => string = deriveVisualSubgroupFamilyLabel): BaseModelPricingSubgroup[] {
  const familyOrder: string[] = [];
  const rowIdsByFamily = new Map<string, string[]>();
  rows.forEach((row) => {
    if (row.role === "system_base") return;
    const name = (row.displayName ?? row.label ?? "").trim();
    if (!name) return;
    const family = deriveFamily(name);
    if (!family || /^\d+$/.test(family)) return;
    if (!rowIdsByFamily.has(family)) { rowIdsByFamily.set(family, []); familyOrder.push(family); }
    rowIdsByFamily.get(family)?.push(row.id);
  });
  return familyOrder
    .filter((family) => (rowIdsByFamily.get(family) ?? []).length >= 2)
    .map((family, index) => ({ id: `auto-${familySlug(family)}`, subgroup_name: family, sort_order: index, is_active: true, row_ids: rowIdsByFamily.get(family) ?? [] }));
}

/**
 * Initial Main Product family organization for a NATIVE System group: one subgroup per commercial product
 * family (all widths/depths together). system_base rows never participate. Used only when seeding a fresh
 * review; existing reviewed subgroup state is never overwritten by the caller.
 */
export function inferNativeMainProductFamilies<TRow extends AutoGroupableRow>(rows: readonly TRow[]): BaseModelPricingSubgroup[] {
  return inferBaseModelVisualSubgroups(rows, deriveProductFamilyLabel);
}

/**
 * Add More JSON into a reopened native System group: new Main Product rows join an existing family whose name matches
 * their normalized family label, or start a new family when at least two new rows share one. system_base rows and
 * unmatched single rows are left alone (they stay in "Other models"). Existing assignments are never changed.
 */
export function assignNewRowsToNativeFamilies<TRow extends AutoGroupableRow>(subgroups: readonly BaseModelPricingSubgroup[], groupRows: readonly TRow[], newRowIds: readonly string[]): BaseModelPricingSubgroup[] {
  const already = new Set(subgroups.flatMap((subgroup) => subgroup.row_ids));
  const fresh = new Set(newRowIds);
  const familyOf = (row: TRow) => { const name = (row.displayName ?? row.label ?? "").trim(); return name ? deriveProductFamilyLabel(name) : ""; };
  const candidates = groupRows.filter((row) => fresh.has(row.id) && !already.has(row.id) && row.role !== "system_base" && familyOf(row));
  const next = subgroups.map((subgroup) => ({ ...subgroup, row_ids: [...subgroup.row_ids] }));
  const unmatched = new Map<string, string[]>();
  candidates.forEach((row) => {
    const family = familyOf(row);
    const existing = next.find((subgroup) => subgroup.subgroup_name.trim().toLowerCase() === family.toLowerCase());
    if (existing) existing.row_ids.push(row.id);
    else unmatched.set(family, [...(unmatched.get(family) ?? []), row.id]);
  });
  unmatched.forEach((ids, family) => {
    if (ids.length < 2) return;
    const base = `auto-${familySlug(family)}`;
    let id = base; let suffix = 2;
    while (next.some((subgroup) => subgroup.id === id)) { id = `${base}-${suffix}`; suffix += 1; }
    next.push({ id, subgroup_name: family, sort_order: next.length, is_active: true, row_ids: ids });
  });
  return next;
}
