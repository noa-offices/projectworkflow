import type { ProductTemplateDraft } from "./product-template-draft";
import type { OriginalImportedJsonSource } from "./original-imported-json-sources";

export type SourceQaAiIssueType = "missing_source_row" | "supplier_model_code_mismatch" | "price_value_mismatch" | "row_binding_mismatch" | "classification_mismatch" | "excluded_scope_import";
export type SourceQaAiSeverity = "critical" | "warning" | "info";
export type SourceQaAiConfidence = "high" | "medium" | "low";
export type SourceQaAiIssue = { id: string; type: SourceQaAiIssueType; severity: SourceQaAiSeverity; confidence: SourceQaAiConfidence; supplierModelCode: string | null; sourcePage: number | null; sourceEvidence: string | null; sourceValue: string | number | null; jsonLocation: string | null; jsonValue: string | number | boolean | null; explanation: string };
export type SourceQaAiReport = { version: 1; summary: { issueCount: number; highSeverityCount: number; reviewRequired: boolean }; issues: SourceQaAiIssue[] };
export type SourceQaAiRequest = { sourcePdfStoragePath: string; sourcePdfFileName: string; originalImportedJsonSources: OriginalImportedJsonSource[]; draft: ProductTemplateDraft };
export type SourceQaAiActionErrorCode = "invalid_source_pdf" | "invalid_draft" | "missing_original_json" | "invalid_original_json" | "too_many_original_json_sources" | "original_json_too_large" | "source_pdf_unavailable" | "invalid_report" | "provider_failed";
export type SourceQaAiActionResult = { ok: true; report: SourceQaAiReport } | { ok: false; message: string; code: SourceQaAiActionErrorCode };

const types = new Set<SourceQaAiIssueType>(["missing_source_row", "supplier_model_code_mismatch", "price_value_mismatch", "row_binding_mismatch", "classification_mismatch", "excluded_scope_import"]);
const severities = new Set<SourceQaAiSeverity>(["critical", "warning", "info"]);
const confidences = new Set<SourceQaAiConfidence>(["high", "medium", "low"]);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nullable = (value: unknown, valid: (item: unknown) => boolean) => value === null || valid(value);

export function parseSourceQaAiReport(value: unknown): SourceQaAiReport | null {
  if (!record(value) || value.version !== 1 || !record(value.summary) || !Array.isArray(value.issues)) return null;
  const summary = value.summary;
  if (typeof summary.issueCount !== "number" || !Number.isInteger(summary.issueCount) || summary.issueCount < 0 || typeof summary.highSeverityCount !== "number" || !Number.isInteger(summary.highSeverityCount) || summary.highSeverityCount < 0 || typeof summary.reviewRequired !== "boolean") return null;
  const issues: SourceQaAiIssue[] = [];
  for (const issue of value.issues) {
    if (!record(issue) || typeof issue.id !== "string" || !issue.id || !types.has(issue.type as SourceQaAiIssueType) || !severities.has(issue.severity as SourceQaAiSeverity) || !confidences.has(issue.confidence as SourceQaAiConfidence) || !nullable(issue.supplierModelCode, (item) => typeof item === "string") || !nullable(issue.sourcePage, (item) => typeof item === "number" && Number.isInteger(item) && item > 0) || !nullable(issue.sourceEvidence, (item) => typeof item === "string") || !nullable(issue.sourceValue, (item) => typeof item === "string" || typeof item === "number") || !nullable(issue.jsonLocation, (item) => typeof item === "string") || !nullable(issue.jsonValue, (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean") || typeof issue.explanation !== "string" || !issue.explanation) return null;
    issues.push(issue as SourceQaAiIssue);
  }
  return { version: 1, summary: { issueCount: summary.issueCount, highSeverityCount: summary.highSeverityCount, reviewRequired: summary.reviewRequired }, issues };
}
