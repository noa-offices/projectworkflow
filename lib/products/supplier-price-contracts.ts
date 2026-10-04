import type { SupportedCurrency } from "../currencies";

export type PriceBasis = "list" | "net" | "unknown";
export type SourceScope = "complete" | "selected_templates" | "partial";
export type SupplierProfile = {
  full_code_column: string;
  article_code_column?: string;
  article_length?: number;
  finish_length?: number;
  validated_article_fallback?: boolean;
  strategy: "exact" | "article_plus_finish";
  currency: SupportedCurrency;
  basis: PriceBasis;
  category_column?: string;
  description_column?: string;
  companion_note_column?: string;
  sheet_names?: string[];
  price_columns: Array<{ column: string; price_field: "unit_price" | "default_price" | "additional_price"; dimension?: string }>;
};
export type RawSupplierRow = { unit_key: string; row_number: number; sheet: string; values: Record<string, unknown>; page_reference?: string };
export type SourceCell = {
  unit_key: string; row_key: string; code: string; raw_code: string; raw_article: string;
  finish: string; dimension: string; price_field: string; price: number | null;
  raw_price: unknown; issues: string[];
  companion_note?: string;
};
export type SourceIdentity = {
  raw_dimension?: string;
  companion_notes?: string[];
  key: string; code: string; price_field: string; dimension: string; finishes: string[];
  price: number | null; currency: SupportedCurrency; row_keys: string[]; issues: string[];
};
export type ProductPriceInput = Record<string, unknown> & { id: string; brand_id: string; template_name: string; pricing_version: number | string };
export type PriceTarget = {
  key: string; template_id: string; template_name: string; brand_id: string; architecture: string;
  group_id: string; row_id: string; column_id: string; dimension: string; price_field: string;
  physical_field: string; code: string; raw_code: string; price: number | null; currency: SupportedCurrency;
  pricing_version: string; label: string;
};
export type DimensionRule = { id: string; brand_id: string; template_id?: string | null; group_id?: string | null; raw_labels: string[]; finish_codes: string[]; dimension_code: string };
export type DurableBinding = { id: string; code: string; price_field: string; source_dimension: string; target_keys: string[]; kind: "alias" | "shared" | "disambiguation"; confirmed: boolean };
export type MatchClassification = "increased" | "decreased" | "unchanged" | "changed" | "unmatched" | "referenced_companion" | "ambiguous" | "shared" | "needs_dimension_mapping" | "baseline_drift" | "invalid_source" | "target_not_represented";
export type PriceMatch = { key: string; source: SourceIdentity | null; targets: PriceTarget[]; classification: MatchClassification; comparison?: "increased" | "decreased" | "changed" | "unchanged" | null; candidate_shared: boolean; decision?: "reviewed" | "skip" | "reject" | "mapping_proposed" | "confirmed_unchanged"; proposed_target_keys?: string[]; provenance?: Array<{ row_number: number; sheet: string; raw_extras: Record<string, unknown> }> };
export type SourceVersion = { id: string; brand_id: string; title: string; filename: string; file_hash: string; source_type: string; currency: SupportedCurrency; basis: PriceBasis; status: string; expected_rows: number; expected_cells: number; expected_chunks: number; stored_rows: number; stored_cells: number; identity_count: number; profile: SupplierProfile; original_reference: string | null; working_reference: string | null; effective_from: string | null; received_at: string | null };
export type ReviewBatch = { id: string; brand_id: string; source_id: string; scope: SourceScope; selected_template_ids: string[]; status: string; basis_warning: string; title: string };

export function assertSupplierProfile(value: unknown): asserts value is SupplierProfile {
  const p = value as Partial<SupplierProfile> | null;
  if (!p || typeof p.full_code_column !== "string" || !p.full_code_column.trim() || !["exact", "article_plus_finish"].includes(p.strategy ?? "") || !["AED", "EUR", "USD"].includes(p.currency ?? "") || !["list", "net", "unknown"].includes(p.basis ?? "") || !Array.isArray(p.price_columns) || !p.price_columns.length || p.price_columns.length > 100) throw Error("Invalid import profile. Configure code columns, prices, currency and explicit basis.");
  if (p.price_columns.some((c) => !c || typeof c.column !== "string" || !c.column || !["unit_price", "default_price", "additional_price"].includes(c.price_field) || (c.dimension !== undefined && typeof c.dimension !== "string"))) throw Error("Invalid profile price columns.");
  if (new Set(p.price_columns.map((c) => c.column)).size !== p.price_columns.length) throw Error("Duplicate profile price column.");
  for (const field of ["article_code_column", "category_column", "description_column", "companion_note_column"] as const) if (p[field] !== undefined && typeof p[field] !== "string") throw Error(`Invalid ${field}.`);
  if (p.sheet_names !== undefined && (!Array.isArray(p.sheet_names) || !p.sheet_names.length || p.sheet_names.some((name) => typeof name !== "string" || !name.trim()) || new Set(p.sheet_names).size !== p.sheet_names.length)) throw Error("Sheet names must be unique non-empty text.");
  if (p.validated_article_fallback !== undefined && typeof p.validated_article_fallback !== "boolean") throw Error("Validated article fallback must be an explicit boolean.");
  if (p.strategy === "article_plus_finish" && (!Number.isInteger(p.article_length) || !Number.isInteger(p.finish_length) || p.article_length! < 1 || p.finish_length! < 1 || p.article_length! + p.finish_length! > 100)) throw Error("Article and finish lengths must be explicit positive integers.");
}
