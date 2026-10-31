import { parseSupportedCurrency } from "../currencies";
import { normalizeManufacturerCode } from "./manufacturer-code";
import { assertSupplierProfile, type RawSupplierRow, type SourceCell, type SourceIdentity, type SupplierProfile } from "./supplier-price-contracts";

/**
 * A row's Supplier family (and sub-family) as part of its dimension, reusing the JSON-string pattern of finish sets.
 * Only when the profile has a family column AND this row has a family; every other row keeps exactly the dimension it had before,
 * so identity keys stay ["code","price_field","dimension"] and profiles without these settings are unchanged.
 * Format: ["<category or tier>","series","<family>"] or, with a sub-family column, ["<category or tier>","series","<family>","<sub-family>"].
 */
export function supplierSeriesDimension(base: string, profile: SupplierProfile, family: unknown, subfamily: unknown): string {
  const name = typeof family === "string" ? family.trim() : "";
  if (!profile.series_column || !name) return base;
  const sub = typeof subfamily === "string" ? subfamily.trim() : "";
  return JSON.stringify([base, "series", name, ...(profile.subfamily_column ? [sub] : [])]);
}
/** The one spelling rule for comparing families (same as the database's supplier_family_key): trimmed, spaces collapsed, lower case. */
export function supplierFamilyKey(family: string): string {
  return family.trim().replace(/\s+/g, " ").toLowerCase();
}
/** The family (and sub-family when the profile has that column) of a family-tagged dimension; null for every other dimension. */
export function supplierDimensionFamily(dimension: string): { family: string; subfamily: string | null } | null {
  if (!dimension.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(dimension);
    if (!Array.isArray(parsed) || parsed[1] !== "series" || typeof parsed[2] !== "string" || !parsed[2].trim()) return null;
    return { family: parsed[2], subfamily: typeof parsed[3] === "string" ? parsed[3] : null };
  } catch { return null; }
}
/** The plain category or tier of a dimension. Anything that is not a family-tagged dimension is returned unchanged. */
export function plainSupplierDimension(dimension: string): string {
  if (!dimension.startsWith("[")) return dimension;
  try {
    const parsed: unknown = JSON.parse(dimension);
    return Array.isArray(parsed) && parsed[1] === "series" && typeof parsed[0] === "string" ? parsed[0] : dimension;
  } catch { return dimension; }
}

export function normalizeSupplierRows(rows: RawSupplierRow[], profile: SupplierProfile): SourceCell[] {
  assertSupplierProfile(profile);
  if (!parseSupportedCurrency(profile.currency)) throw Error("Unsupported source currency.");
  return rows.flatMap((row) => {
    const issues: string[] = [];
    const raw = row.values[profile.full_code_column];
    if (typeof raw !== "string") issues.push("numeric_or_non_text_code");
    const full = typeof raw === "string" ? raw : "";
    if (!full.trim()) issues.push("missing_code");
    let article = full; let finish = "";
    if (profile.strategy === "article_plus_finish") {
      const expected = profile.article_length! + profile.finish_length!;
      if (full.length !== expected) issues.push("unexpected_full_code_length");
      const extracted = full.slice(0, profile.article_length);
      const rawArticle = profile.article_code_column ? row.values[profile.article_code_column] : undefined;
      if (rawArticle !== undefined && rawArticle !== null && typeof rawArticle !== "string") issues.push("numeric_or_non_text_article");
      if (typeof rawArticle === "string" && rawArticle.trim()) {
        article = rawArticle;
        if (rawArticle !== extracted || rawArticle.length !== profile.article_length) issues.push("article_full_code_disagreement");
      } else if (profile.validated_article_fallback && full.length === expected) article = extracted;
      else { article = ""; issues.push("missing_text_article"); }
      finish = full.slice(profile.article_length);
    }
    const category = profile.category_column ? row.values[profile.category_column] : "";
    if (category !== undefined && category !== null && typeof category !== "string") issues.push("non_text_dimension");
    const companion = profile.companion_note_column ? row.values[profile.companion_note_column] : "";
    const family = profile.series_column ? row.values[profile.series_column] : "";
    const subfamily = profile.subfamily_column ? row.values[profile.subfamily_column] : "";
    for (const value of [family, subfamily]) if (value !== undefined && value !== null && typeof value !== "string") issues.push("non_text_family");
    return profile.price_columns.map((column) => {
      const rawPrice = row.values[column.column];
      // Only an unambiguous decimal is accepted; locale/thousands assumptions belong in an explicit conversion.
      const price = typeof rawPrice === "number" ? rawPrice : typeof rawPrice === "string" && /^\d+(?:\.\d+)?$/.test(rawPrice.trim()) ? Number(rawPrice) : NaN;
      return { unit_key: JSON.stringify([row.unit_key, column.column]), row_key: row.unit_key, code: normalizeManufacturerCode(article), raw_code: full, raw_article: article, finish, dimension: supplierSeriesDimension(column.dimension ?? (typeof category === "string" ? category.trim() : ""), profile, family, subfamily), price_field: column.price_field, price: Number.isFinite(price) && price >= 0 ? price : null, raw_price: rawPrice ?? null, companion_note: typeof companion === "string" ? companion.trim() : "", issues: [...issues, ...(Number.isFinite(price) && price >= 0 ? [] : ["invalid_price"])] };
    });
  });
}

/** Across the whole finalized source, never within individual ingestion chunks. */
export function commercialSupplierIdentities(cells: SourceCell[], profile: SupplierProfile): SourceIdentity[] {
  const groups = new Map<string, SourceCell[]>();
  for (const cell of cells) {
    const key = JSON.stringify([cell.code, cell.price_field, cell.dimension]);
    const group = groups.get(key) ?? []; group.push(cell); groups.set(key, group);
  }
  const result: SourceIdentity[] = [];
  for (const group of groups.values()) {
    const prices = new Set(group.map((cell) => cell.price));
    const hasFinish = group.every((cell) => Boolean(cell.finish));
    const tiers = prices.size > 1 && hasFinish ? [...prices].map((price) => group.filter((cell) => cell.price === price)) : [group];
    for (const tier of tiers) {
      const first = tier[0];
      const finishes = [...new Set(tier.map((cell) => cell.finish).filter(Boolean))].sort();
      const dimension = tiers.length > 1 ? JSON.stringify([first.dimension, "finish_set", finishes]) : first.dimension;
      const issues = [...new Set(tier.flatMap((cell) => cell.issues))];
      // Duplicate full codes with differing prices cannot be silently resolved by tiering.
      const fullCodes = new Map<string, Set<number | null>>();
      for (const cell of group) { const values = fullCodes.get(cell.raw_code) ?? new Set(); values.add(cell.price); fullCodes.set(cell.raw_code, values); }
      if ([...fullCodes.values()].some((values) => values.size > 1) || (prices.size > 1 && !hasFinish)) issues.push("conflicting_source_prices");
      result.push({ key: JSON.stringify([first.code, first.price_field, dimension]), code: first.code, price_field: first.price_field, dimension, raw_dimension: plainSupplierDimension(first.dimension), finishes, price: new Set(tier.map((cell) => cell.price)).size === 1 ? first.price : null, currency: profile.currency, row_keys: [...new Set(tier.map((cell) => cell.row_key))], companion_notes: [...new Set(tier.map((cell) => cell.companion_note).filter((note): note is string => Boolean(note)))], issues });
    }
  }
  return result;
}

export function supplierImportChunks(rows: RawSupplierRow[], maxUnits = 500, maxBytes = 600_000, profile?: SupplierProfile): RawSupplierRow[][] {
  if (maxUnits < 250 || maxUnits > 1000) throw Error("Chunk unit limit must be 250–1000.");
  const chunks: RawSupplierRow[][] = []; let chunk: RawSupplierRow[] = []; let bytes = 2;
  const rowLimit = profile ? Math.max(1, Math.floor(maxUnits / (1 + profile.price_columns.length))) : maxUnits;
  for (const row of rows) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length + 1 + (profile ? new TextEncoder().encode(JSON.stringify(normalizeSupplierRows([row], profile))).length : 0);
    if (size > maxBytes) throw Error("A source row exceeds the safe payload size.");
    if (chunk.length && (chunk.length >= rowLimit || bytes + size > maxBytes)) { chunks.push(chunk); chunk = []; bytes = 2; }
    chunk.push(row); bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
