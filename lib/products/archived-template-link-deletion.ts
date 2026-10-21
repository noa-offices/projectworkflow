export type ArchivedLinkInput = { templateId: string; relationshipId: string };
export type ArchivedLinkResult = { ok: boolean; code: string; message: string; relationshipId?: string };
type Dependencies = {
  authorize: () => Promise<void>;
  rpc: (input: ArchivedLinkInput) => Promise<{ data: unknown; error: { code?: string } | null }>;
  refresh: () => void;
};
const messages: Record<string, string> = {
  unauthenticated: "Sign in before managing product-family links.",
  forbidden: "You do not have permission to remove this relationship.",
  invalid_input: "Select a valid archived template and relationship.",
  not_found: "This relationship no longer exists or is not accessible. Refresh the archive.",
  template_unavailable: "The selected template no longer exists or is not accessible.",
  not_archived: "The selected template must be archived and inactive.",
  wrong_relationship: "This relationship does not belong to the selected template.",
  active_link: "Active relationship: manage it in product setup first.",
  endpoint_unavailable: "Both relationship endpoints must exist and be accessible.",
  brand_unavailable: "Both endpoint brands must exist and be accessible.",
  stale: "This relationship changed while it was being checked. Refresh the archive and review it again.",
  unavailable: "Link removal is not available. Check that the database update has been applied.",
  unconfirmed: "Removal was not confirmed. Refresh the archive before trying again.",
};
export async function removeArchivedTemplateLink(input: ArchivedLinkInput, deps: Dependencies): Promise<ArchivedLinkResult> {
  const failure = (code: string): ArchivedLinkResult => ({ ok: false, code, message: messages[code] || messages.unconfirmed });
  try { await deps.authorize(); } catch { return failure("forbidden"); }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!input || !uuid.test(input.templateId || "") || !uuid.test(input.relationshipId || "")) return failure("invalid_input");
  let response;
  try { response = await deps.rpc(input); } catch { return failure("unconfirmed"); }
  if (response.error) {
    if (["PGRST202", "42883"].includes(response.error.code || "")) return failure("unavailable");
    return failure(response.error.code === "42501" ? "forbidden" : "unconfirmed");
  }
  const data = response.data as Record<string, unknown> | null;
  if (data?.ok !== true) return failure(typeof data?.code === "string" && messages[data.code] ? data.code : "unconfirmed");
  if (data.code !== "deleted" || data.deletedCount !== 1 ||
      data.templateId !== input.templateId.toLowerCase() || data.relationshipId !== input.relationshipId.toLowerCase()) return failure("unconfirmed");
  try { deps.refresh(); } catch {
    return { ok: true, code: "deleted", relationshipId: input.relationshipId, message: "Relationship removed. Refresh the archive to update its counts." };
  }
  return { ok: true, code: "deleted", relationshipId: input.relationshipId, message: "Relationship removed. The template has not been deleted." };
}
