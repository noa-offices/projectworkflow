import type { ArchivedLinkInput, ArchivedLinkResult } from "./archived-template-link-deletion";
import type { ArchiveFamilyLink } from "./archive-family-links";

export type DeactivationLink = ArchiveFamilyLink & { updated_at: string };
type QueryResult<T> = { data: T | null; error: { code?: string } | null };
type Dependencies = {
  authorize: () => Promise<void>;
  template: (id: string) => Promise<QueryResult<{ is_active: boolean; lifecycle_status: string }>>;
  relationship: (id: string) => Promise<QueryResult<DeactivationLink>>;
  update: (link: DeactivationLink) => Promise<QueryResult<ArchiveFamilyLink[]>>;
  refresh: () => void;
};

export async function deactivateArchivedLink(input: ArchivedLinkInput, deps: Dependencies): Promise<ArchivedLinkResult> {
  const fail = (code: string, message: string): ArchivedLinkResult => ({ ok: false, code, message });
  const uncertain = () => fail("unconfirmed", "Deactivation was not confirmed. Refresh links before trying again.");
  try { await deps.authorize(); } catch { return fail("forbidden", "You do not have permission to deactivate this relationship."); }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!input || !uuid.test(input.templateId ?? "") || !uuid.test(input.relationshipId ?? "")) {
    return fail("invalid_input", "Select a valid archived template and relationship.");
  }
  const templateId = input.templateId.toLowerCase(), relationshipId = input.relationshipId.toLowerCase();
  try {
    const [template, relationship] = await Promise.all([deps.template(templateId), deps.relationship(relationshipId)]);
    if (template.error || relationship.error) return uncertain();
    if (!template.data || !relationship.data) return fail("not_found", "Template or relationship is no longer accessible. Refresh links.");
    if (template.data.is_active || template.data.lifecycle_status !== "archived") return fail("not_archived", "The selected template must be archived and inactive. Refresh the archive.");
    const link = relationship.data;
    if (link.id !== relationshipId || ![link.parent_template_id, link.linked_template_id].includes(templateId)) {
      return fail("wrong_relationship", "This relationship does not belong to the selected template.");
    }
    if (!link.is_active || !link.updated_at) return fail("stale", "This relationship changed or is already inactive. Refresh links and review it again.");
    // Only this update is atomic: compare the observed relationship version and endpoints.
    // Template archive status was checked above; it is NOT locked across requests.
    const response = await deps.update(link);
    if (response.error) return response.error.code === "42501"
      ? fail("forbidden", "You do not have permission to deactivate this relationship.") : uncertain();
    if (!response.data?.length) return fail("stale", "Relationship changed or permission was denied. Refresh links before trying again.");
    const changed = response.data[0];
    if (response.data.length !== 1 || changed.id !== relationshipId || changed.is_active !== false ||
      changed.parent_template_id !== link.parent_template_id || changed.linked_template_id !== link.linked_template_id) return uncertain();
    const result = { ok: true, code: "deactivated", relationshipId, message: "Link deactivated. Permanent removal requires a separate confirmation." };
    try { deps.refresh(); } catch { return { ...result, message: `${result.message} Refresh the archive to update its status.` }; }
    return result;
  } catch { return uncertain(); }
}
