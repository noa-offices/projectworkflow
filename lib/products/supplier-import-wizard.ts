import { assertSupplierProfile, type PriceBasis, type RawSupplierRow, type SupplierProfile } from "./supplier-price-contracts";
import { normalizeSupplierRows } from "./supplier-price-import";

// Plain-language import setup. Everything here produces or reads the EXISTING import-profile shape (supplier_price_profiles.config);
// there is no second import format and users never see or write that JSON.

export type WizardPriceColumn = { column: string; label: string };
export type WizardMapping = {
  fullCode: string; articleCode: string; description: string; category: string;
  priceColumns: WizardPriceColumn[];
  currency: "AED" | "EUR" | "USD"; basis: Exclude<PriceBasis, "unknown">;
  structure: "simple" | "article_finish"; articleLength: number; finishLength: number;
};
export type WizardProfileOption = { id: string; title: string; config: SupplierProfile };
export const emptyMapping: WizardMapping = { fullCode: "", articleCode: "", description: "", category: "", priceColumns: [], currency: "EUR", basis: "list", structure: "simple", articleLength: 6, finishLength: 3 };

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const first = (headers: string[], words: string[]) => headers.find((header) => words.some((word) => squash(header).includes(word))) ?? "";
/** A header that is itself a matrix label: "Cat A", "Category B", "Tier C" or a size such as "120 x 145". */
const matrixHeader = (header: string) => /^(cat(egory)?\.?|tier|group|fabric)\s*[a-z0-9]{1,3}$/i.test(header.trim()) || /\d+(\.\d+)?\s*[x×*]\s*\d+(\.\d+)?/i.test(header);
const priceWords = ["prezzo", "price", "unitprice", "eur", "usd", "aed", "listprice"];

/** Suggestions only. The user confirms every mapping before anything is imported. */
export function suggestMapping(headers: string[]): WizardMapping {
  const fullCode = first(headers, ["codicearticolo", "fullcode", "suppliercode", "articleno", "itemcode", "code"]);
  const matrix = headers.filter(matrixHeader);
  const single = first(headers.filter((header) => !matrix.includes(header)), priceWords);
  const priceHeaders = matrix.length >= 2 ? matrix : single ? [single] : [];
  return {
    ...emptyMapping, fullCode,
    articleCode: first(headers.filter((header) => header !== fullCode), ["nomefile", "article"]),
    description: first(headers, ["descri", "description"]),
    category: matrix.length >= 2 ? "" : first(headers, ["categoria", "category", "tessuto", "tier"]),
    priceColumns: priceHeaders.map((column) => ({ column, label: matrix.includes(column) ? column.trim() : "" })),
  };
}

/** The existing profile shape from plain choices. A column label becomes that column's `dimension` (a size or category tier). */
export function profileFromMapping(mapping: WizardMapping): SupplierProfile {
  const articleFinish = mapping.structure === "article_finish";
  const profile: SupplierProfile = {
    strategy: articleFinish ? "article_plus_finish" : "exact",
    full_code_column: mapping.fullCode,
    price_columns: mapping.priceColumns.map((item) => ({ column: item.column, price_field: "unit_price", ...(item.label.trim() ? { dimension: item.label.trim() } : {}) })),
    currency: mapping.currency, basis: mapping.basis,
  };
  if (articleFinish) {
    if (mapping.articleCode) profile.article_code_column = mapping.articleCode;
    profile.article_length = mapping.articleLength; profile.finish_length = mapping.finishLength; profile.validated_article_fallback = true;
  }
  if (mapping.category) profile.category_column = mapping.category;
  if (mapping.description) profile.description_column = mapping.description;
  assertSupplierProfile(profile);
  return profile;
}

/** Reverse of profileFromMapping, so a saved profile can be shown, reviewed and changed. */
export function mappingFromProfile(profile: SupplierProfile): WizardMapping {
  return {
    fullCode: profile.full_code_column, articleCode: profile.article_code_column ?? "", description: profile.description_column ?? "", category: profile.category_column ?? "",
    priceColumns: profile.price_columns.map((item) => ({ column: item.column, label: item.dimension ?? "" })),
    currency: profile.currency, basis: profile.basis === "net" ? "net" : "list",
    structure: profile.strategy === "article_plus_finish" ? "article_finish" : "simple", articleLength: profile.article_length ?? 6, finishLength: profile.finish_length ?? 3,
  };
}

export function profileRequiredColumns(profile: SupplierProfile) {
  return [profile.full_code_column, ...profile.price_columns.map((item) => item.column), ...(profile.article_code_column ? [profile.article_code_column] : []), ...(profile.category_column ? [profile.category_column] : []), ...(profile.companion_note_column ? [profile.companion_note_column] : [])];
}
/** A saved import profile whose every required column exists in this file. Only a suggestion; never applied silently. */
export function compatibleProfile(profiles: WizardProfileOption[], headers: string[]): WizardProfileOption | null {
  const have = new Set(headers);
  return profiles.find((profile) => profileRequiredColumns(profile.config).every((column) => have.has(column))) ?? null;
}

export type WizardPreviewRow = { code: string; dimension: string; tier: string; price: string };
const sizeLabel = (value: string) => value.replace(/\s*[x*]\s*/gi, " × ");
/** Normalised rows from the same normalisation the real import uses, so users see what will be extracted. */
export function previewImport(rows: RawSupplierRow[], profile: SupplierProfile, limit = 5): WizardPreviewRow[] {
  const cells = normalizeSupplierRows(rows.slice(0, 300), profile).filter((cell) => cell.price !== null && cell.code);
  return cells.slice(0, limit).map((cell) => ({
    code: cell.code, dimension: cell.dimension && /\d/.test(cell.dimension) ? sizeLabel(cell.dimension) : "—", tier: cell.dimension && !/\d/.test(cell.dimension) ? cell.dimension : "—",
    price: `${profile.currency} ${cell.price!.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
  }));
}

export function suggestedImportTitle(brandName: string, now: Date = new Date()) {
  return `${brandName} — ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(now)}`;
}

export type WizardDefinition = { id: string; name: string; profileId: string | null; familyIds: string[] };
/** Previous Source Definition for this import: the one tied to the saved profile, otherwise the Brand's only one. Never guessed among several. */
export function suggestDefinition(definitions: WizardDefinition[], profileId: string | null): WizardDefinition | null {
  const byProfile = profileId ? definitions.filter((item) => item.profileId === profileId) : [];
  if (byProfile.length === 1) return byProfile[0];
  return definitions.length === 1 ? definitions[0] : null;
}
