import type { OriginalImportedJsonSource } from "./original-imported-json-sources";
import type { SpecificationEnrichmentContext, SpecificationEnrichmentRow } from "./specification-enrichment-contract";

export type SpecificationEnrichmentSourceContext = { kind: "matched"; sourceId: string; match: "id" | "supplier_code" | "reference_code" | "fallback"; fragment: unknown } | { kind: "no_context" };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function values(value: unknown): string[] { if (typeof value === "string") return [value]; if (Array.isArray(value)) return value.flatMap(values); if (record(value)) return Object.values(value).flatMap(values); return []; }
function directValues(value: Record<string, unknown>): string[] { return Object.values(value).flatMap((item) => typeof item === "string" ? [item] : Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : []); }
function clean(value: unknown): unknown { if (Array.isArray(value)) return value.map(clean); if (!record(value)) return value; return Object.fromEntries(Object.entries(value).filter(([key]) => !/price|currency|confidence|warning/i.test(key)).map(([key, item]) => [key, clean(item)])); }
function candidates(value: unknown, parent: Record<string, unknown> | null = null): Array<{ item: Record<string, unknown>; parent: Record<string, unknown> | null }> { if (Array.isArray(value)) return value.flatMap((item) => candidates(item, parent)); if (!record(value)) return []; return [{ item: value, parent }, ...Object.values(value).flatMap((item) => candidates(item, value))]; }
const norm = (value: unknown) => typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
function fragment(candidate: { item: Record<string, unknown>; parent: Record<string, unknown> | null }) { const group = candidate.parent ? Object.fromEntries(Object.entries(candidate.parent).filter(([, value]) => !Array.isArray(value) && !record(value))) : null; return clean({ group, row: candidate.item }); }
export function matchSpecificationEnrichmentSourceContext(row: SpecificationEnrichmentRow, context: SpecificationEnrichmentContext, sources: OriginalImportedJsonSource[]): SpecificationEnrichmentSourceContext {
  const parsed = sources.flatMap((source) => { try { return [{ source, value: JSON.parse(source.rawJson) as unknown }]; } catch { return []; } });
  const all = parsed.flatMap(({ source, value }) => candidates(value).map((candidate) => ({ source, candidate })));
  const find = (predicate: (item: Record<string, unknown>) => boolean, match: "id" | "supplier_code" | "reference_code" | "fallback") => { const hits = all.filter(({ candidate }) => predicate(candidate.item)); return hits.length === 1 ? { kind: "matched" as const, sourceId: hits[0].source.id, match, fragment: fragment(hits[0].candidate) } : null; };
  const id = find((item) => Object.entries(item).some(([key, value]) => /(^|_)id$/i.test(key) && String(value) === row.id), "id"); if (id) return id;
  const supplier = new Set(row.supplierCodes); const supplierHit = supplier.size ? find((item) => directValues(item).some((value) => supplier.has(value)), "supplier_code") : null; if (supplierHit) return supplierHit;
  const references = new Set(row.referenceCodes); const referenceHit = references.size ? find((item) => directValues(item).some((value) => references.has(value)), "reference_code") : null; if (referenceHit) return referenceHit;
  const names = [row.displayName, context.groupLabel].map(norm).filter(Boolean); const dimension = norm(record(row.dimensions) ? row.dimensions.rawText : null); const fallback = find((item) => { const text = [...directValues(item), ...(record(item.dimensions) ? values(item.dimensions) : [])].map(norm); return names.some((name) => text.includes(name)) && (!dimension || text.includes(dimension)); }, "fallback");
  return fallback ?? { kind: "no_context" };
}
