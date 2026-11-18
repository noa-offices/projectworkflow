/**
 * My Collection duplicate warning (PR 7). PURE: no I/O, no React, never throws.
 * A duplicate is a WARNING, never a block: the same item at a different price is legitimate. The server finds it with
 * the caller's own rows (see the services) and returns it as data; the browser never decides "no duplicate".
 * Prices are only ever those of the CALLER'S OWN existing item; another user's price is never involved.
 */
import { normaliseSearchKey } from "./collection-view";

export type DuplicateKind = "custom_item" | "setup";

export type DuplicateInfo = {
  id: string;
  kind: DuplicateKind;
  /** The existing item's name and brand (the caller's own). */
  name: string;
  brand: string;
  /** Custom items: the existing item has the SAME price and currency as the new one. */
  samePrice?: boolean;
  /** Custom items: the existing item's own price (shown when it differs). */
  existingPrice?: { currency: string; amount: number };
  savedAt: string | null;
  /** Why it matched: same brand and name, or the same item code. */
  reason: "name" | "code" | "recipe";
};

/** Trim, lower case, ignore spaces, dashes, underscores and dots ("Acme-Office" = "acme office"). */
export function normaliseDuplicateKey(value: unknown): string {
  return normaliseSearchKey(value);
}

// ── Custom items ─────────────────────────────────────────────────────────────────────────────────────────────
export type CustomCandidate = {
  brandName: unknown;
  itemName: unknown;
  itemCode?: unknown;
  sellingPrice?: unknown;
  currency?: unknown;
};
export type ExistingCustomItem = {
  id: string;
  brandName: string;
  itemName: string;
  itemCode?: string | null;
  sellingPrice: number | string;
  currency: string;
  priceSavedAt?: string | null;
  createdAt?: string | null;
};

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function upper(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/**
 * Same owner (the list only holds the owner's rows), same normalised brand AND item name; or both have an item code and the
 * codes are equal after normalising (even when the names differ a little). The item being edited never matches itself.
 */
export function findCustomDuplicate(candidate: CustomCandidate, existing: readonly ExistingCustomItem[], excludeId?: string | null): DuplicateInfo | null {
  try {
    const brand = normaliseDuplicateKey(candidate.brandName);
    const name = normaliseDuplicateKey(candidate.itemName);
    const code = normaliseDuplicateKey(candidate.itemCode);
    const others = existing.filter((item) => item && item.id !== excludeId);
    const byName = brand && name ? others.find((item) => normaliseDuplicateKey(item.brandName) === brand && normaliseDuplicateKey(item.itemName) === name) : undefined;
    const byCode = !byName && code ? others.find((item) => normaliseDuplicateKey(item.itemCode) === code) : undefined;
    const match = byName ?? byCode;
    if (!match) return null;
    const newPrice = numberOrNull(candidate.sellingPrice);
    const oldPrice = numberOrNull(match.sellingPrice);
    const samePrice = newPrice !== null && oldPrice !== null && newPrice === oldPrice && upper(candidate.currency) === upper(match.currency);
    return {
      id: match.id,
      kind: "custom_item",
      name: match.itemName,
      brand: match.brandName,
      samePrice,
      ...(!samePrice && oldPrice !== null ? { existingPrice: { currency: upper(match.currency), amount: oldPrice } } : {}),
      savedAt: match.priceSavedAt ?? match.createdAt ?? null,
      reason: byName ? "name" : "code",
    };
  } catch {
    return null;
  }
}

// ── Configured setups ────────────────────────────────────────────────────────────────────────────────────────
/** Above this many characters of canonical JSON the comparison is skipped (no warning). Recipes are capped at 64 KB anyway. */
export const SETUP_COMPARE_MAX_CHARS = 70_000;
const MAX_DEPTH = 24;
/** Display and bookkeeping only: never part of what a setup IS. Everything else counts as content, even if unclear. */
const RECIPE_IGNORED_KEYS = new Set(["display", "selected_image"]);
const SPEC_IGNORED_KEYS = new Set(["generated_specification_hash"]);

function canonicalise(value: unknown, depth: number, ignored?: ReadonlySet<string>): unknown {
  if (depth > MAX_DEPTH) throw new Error("too deep");
  if (Array.isArray(value)) {
    const items = value.map((entry) => canonicalise(entry, depth + 1));
    // A list of plain ids or numbers has no meaningful order (for example skipped group ids); lists of objects keep theirs.
    return items.every((entry) => typeof entry === "string" || typeof entry === "number")
      ? [...items].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))
      : items;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => !ignored?.has(key))
        .sort()
        .map((key) => [key, canonicalise(record[key], depth + 1)]),
    );
  }
  return value ?? null;
}

/** Canonical text of a recipe (plus its spec overrides): keys sorted, display and bookkeeping removed. null = too big or unreadable. */
export function canonicalSetup(recipe: unknown, specOverrides?: unknown): string | null {
  try {
    const text = JSON.stringify({ recipe: canonicalise(recipe, 0, RECIPE_IGNORED_KEYS), spec: canonicalise(specOverrides ?? {}, 0, SPEC_IGNORED_KEYS) });
    return typeof text === "string" && text.length <= SETUP_COMPARE_MAX_CHARS ? text : null;
  } catch {
    return null;
  }
}

export type SetupCandidate = { templateId: string; recipe: unknown; specOverrides?: unknown };
export type ExistingSetup = {
  id: string;
  templateId: string | null;
  setupName: string;
  brandName: string;
  productName?: string;
  recipe: unknown;
  specOverrides?: unknown;
  archived?: boolean | null;
  createdAt?: string | null;
};

/** Same template and the same canonical recipe content. Archived or removed setups (no template) are ignored. Never throws. */
export function findSetupDuplicate(candidate: SetupCandidate, existing: readonly ExistingSetup[], excludeId?: string | null): DuplicateInfo | null {
  try {
    const wanted = canonicalSetup(candidate.recipe, candidate.specOverrides);
    if (wanted === null) return null;
    for (const row of existing) {
      if (!row || row.id === excludeId || row.archived || !row.templateId || row.templateId !== candidate.templateId) continue;
      if (canonicalSetup(row.recipe, row.specOverrides) === wanted) {
        return { id: row.id, kind: "setup", name: row.setupName, brand: row.brandName, savedAt: row.createdAt ?? null, reason: "recipe" };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Wording (one place, used by every screen) ────────────────────────────────────────────────────────────────
function label(info: DuplicateInfo): string {
  return info.brand && info.brand.trim() ? `${info.name} (${info.brand})` : info.name;
}

function money(price: { currency: string; amount: number }): string {
  return `${price.currency} ${price.amount.toFixed(2)}`;
}

/** Saving: "Already in your collection: Desk (Acme), same price." */
export function saveDuplicateMessage(info: DuplicateInfo): string {
  const detail = info.kind !== "custom_item" ? "" : info.samePrice ? ", same price" : info.existingPrice ? `, saved at a different price ${money(info.existingPrice)}` : "";
  return `Already in your collection: ${label(info)}${detail}.`;
}

/** Accepting a share: "You already have Desk (Acme)." */
export function acceptDuplicateMessage(info: DuplicateInfo): string {
  return `You already have ${label(info)}.`;
}

/** Identical item (same price): "Skip" is the highlighted default when accepting. */
export function isIdenticalDuplicate(info: DuplicateInfo): boolean {
  return info.kind === "setup" || info.samePrice === true;
}
