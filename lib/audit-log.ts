import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditActivityInput = {
  entityType: string;
  entityId?: string | null;
  parentEntityType?: string | null;
  parentEntityId?: string | null;
  action: string;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  actorName?: string | null;
  createdBy?: string | null;
};

export async function createAuditLog(
  supabase: SupabaseClient,
  {
    entityType,
    entityId = null,
    parentEntityType = null,
    parentEntityId = null,
    action,
    title,
    description = null,
    metadata = {},
    actorName = null,
    createdBy = null,
  }: AuditActivityInput,
) {
  const { error } = await supabase.from("audit_activity_log").insert({
    entity_type: entityType,
    entity_id: entityId,
    parent_entity_type: parentEntityType,
    parent_entity_id: parentEntityId,
    action,
    title,
    description,
    metadata: actorName ? { ...metadata, actorName } : metadata,
    created_by: createdBy,
  });

  if (error) {
    console.warn("AUDIT ACTIVITY LOG INSERT WARNING", {
      action,
      entityId,
      entityType,
      message: error.message,
      parentEntityId,
      parentEntityType,
      title,
    });
    return false;
  }

  return true;
}
