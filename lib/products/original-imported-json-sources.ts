export type OriginalImportedJsonSource = { id: string; rawJson: string };

export const MAX_ORIGINAL_IMPORTED_JSON_SOURCES = 10;
export const MAX_ORIGINAL_IMPORTED_JSON_BYTES = 2 * 1024 * 1024;

export function captureInitialOriginalImportedJsonSource(sources: OriginalImportedJsonSource[], rawJson: string, id: string) {
  return sources.some((source) => source.rawJson === rawJson) ? sources : [...sources, { id, rawJson }];
}

export function appendOriginalImportedJsonSource(sources: OriginalImportedJsonSource[], rawJson: string, id: string) {
  return [...sources, { id, rawJson }];
}

export function validateOriginalImportedJsonSources(value: unknown): { valid: true; sources: OriginalImportedJsonSource[] } | { valid: false; code: "missing_original_json" | "invalid_original_json" | "too_many_original_json_sources" | "original_json_too_large"; message: string } {
  if (!Array.isArray(value) || !value.length) return { valid: false, code: "missing_original_json", message: "At least one original imported JSON source is required." };
  if (value.length > MAX_ORIGINAL_IMPORTED_JSON_SOURCES) return { valid: false, code: "too_many_original_json_sources", message: `At most ${MAX_ORIGINAL_IMPORTED_JSON_SOURCES} original imported JSON sources are allowed.` };
  if (!value.every((source) => Boolean(source) && typeof source === "object" && typeof (source as OriginalImportedJsonSource).id === "string" && (source as OriginalImportedJsonSource).id.trim() && typeof (source as OriginalImportedJsonSource).rawJson === "string" && (source as OriginalImportedJsonSource).rawJson.trim())) return { valid: false, code: "invalid_original_json", message: "Each original imported JSON source must contain a non-empty raw JSON string." };
  const sources = value as OriginalImportedJsonSource[];
  if (new TextEncoder().encode(sources.map((source) => source.rawJson).join("")).byteLength > MAX_ORIGINAL_IMPORTED_JSON_BYTES) return { valid: false, code: "original_json_too_large", message: "Original imported JSON sources exceed the 2 MB combined limit." };
  return { valid: true, sources };
}
