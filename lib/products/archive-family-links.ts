import type { ArchivedLinkInput, ArchivedLinkResult } from "./archived-template-link-deletion";

export type ArchiveFamilyLink = {
  id: string;
  parent_template_id: string;
  linked_template_id: string;
  is_active: boolean;
};
export type ArchiveLinkDisplay = ArchiveFamilyLink & {
  parentName: string;
  linkedName: string;
  parentBrand: string;
  linkedBrand: string;
};

// Mirrors Phase A's database role helpers, not the broader product-library UI gate.
export function canRemoveArchiveLinks(role?: string | null, status?: string | null) {
  return status === "active" && ["system_owner", "admin_manager", "sales_designer", "sales_coordinator"].includes(role ?? "");
}

export function archiveLinksForTemplate(templateId: string, links: ArchiveLinkDisplay[]) {
  return links.filter((link) => link.parent_template_id === templateId || link.linked_template_id === templateId);
}

export async function requestArchiveLinkRemoval(
  input: ArchivedLinkInput,
  remove: (input: ArchivedLinkInput) => Promise<ArchivedLinkResult>,
  refresh: () => void,
): Promise<ArchivedLinkResult> {
  let result: ArchivedLinkResult;
  try {
    result = await remove(input);
  } catch {
    result = { ok: false, code: "unconfirmed", message: "Removal was not confirmed. Refresh the archive before trying again." };
  }
  // Also refresh failures: another session may have activated, removed or restored a record.
  try { refresh(); } catch {
    return { ...result, message: `${result.message} Refresh the archive to update its counts.` };
  }
  return result;
}
