import type { LocalQuotationWorkspace } from "./quotation-workspace";

export type PublicationAttempt = {
  mutationId: string;
  baseVersion: string;
  snapshot: LocalQuotationWorkspace;
};
export type PublicationMetadata = { baseVersion?: string; pending?: PublicationAttempt };
export function publicationMetadata(workspace: LocalQuotationWorkspace): PublicationMetadata {
  return (workspace.metadata?.publication ?? {}) as PublicationMetadata;
}
export function withPublication(workspace: LocalQuotationWorkspace, publication: PublicationMetadata): LocalQuotationWorkspace {
  return { ...workspace, metadata: { ...workspace.metadata, publication } };
}
// Equality here acknowledges local edits only. Server versions are the conflict authority.
export function publicationContent(workspace: LocalQuotationWorkspace) {
  const { metadata, updated_at, last_saved_to_software_at, has_unsaved_changes, ...content } = workspace;
  void updated_at; void last_saved_to_software_at; void has_unsaved_changes;
  const { publication, ...otherMetadata } = metadata ?? {};
  void publication;
  return JSON.stringify({ ...content, metadata: otherMetadata });
}
export function beginPublication(workspace: LocalQuotationWorkspace): PublicationAttempt {
  const state = publicationMetadata(workspace);
  if (state.pending) return state.pending;
  if (!state.baseVersion) throw new Error("This draft has no verified server baseline. Local work is preserved. Export a JSON backup and review the server quotation before publishing.");
  return {
    mutationId: crypto.randomUUID(),
    baseVersion: state.baseVersion,
    snapshot: structuredClone(withPublication(workspace, { baseVersion: state.baseVersion })),
  };
}
export function acknowledgePublication(current: LocalQuotationWorkspace, attempt: PublicationAttempt, result: { version: string; savedAt: string }): LocalQuotationWorkspace {
  return withPublication({
    ...current,
    has_unsaved_changes: publicationContent(current) !== publicationContent(attempt.snapshot),
    last_saved_to_software_at: result.savedAt,
  }, { baseVersion: result.version });
}
export function validateWorkspace(value: unknown, quotationId: string): asserts value is LocalQuotationWorkspace {
  if (!value || typeof value !== "object") throw new Error("Local draft is not a workspace.");
  const w = value as LocalQuotationWorkspace;
  if (typeof w.server_quotation_id !== "string" || !w.server_quotation_id ||
      w.server_quotation_id !== quotationId || typeof w.local_id !== "string" ||
      !Array.isArray(w.items) || !Array.isArray(w.sections) || !w.totals ||
      typeof w.title !== "string" || typeof w.has_unsaved_changes !== "boolean" ||
      !w.items.every((row) => row && typeof row.id === "string") ||
      !w.sections.every((row) => row && typeof row.id === "string")) {
    throw new Error("Local draft is malformed. The stored draft has not been replaced.");
  }
  const publication = publicationMetadata(w);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (publication.baseVersion !== undefined && !uuid.test(publication.baseVersion)) {
    throw new Error("Local publication baseline is malformed. Stored data has not been replaced.");
  }
  if (publication.pending) {
    const attempt = publication.pending;
    if (!uuid.test(attempt.mutationId ?? "") || !uuid.test(attempt.baseVersion ?? "") ||
        !attempt.snapshot || publicationMetadata(attempt.snapshot).pending) {
      throw new Error("Local save attempt is malformed. Stored data has not been replaced.");
    }
    validateWorkspace(attempt.snapshot, quotationId);
  }
}
