"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/lib/audit-log";

type LogProjectActivityResult =
  | { ok: true }
  | { ok: false; error: string };

export async function logProjectActivityAction(
  orderNo: string,
  stepKey: string,
  stepLabel: string,
  remark: string | null,
): Promise<LogProjectActivityResult> {
  const { user, profile } = await requireActiveUser();

  const role = profile?.role ?? null;
  const canLog =
    role === "system_owner" ||
    role === "admin_manager";

  if (!canLog) {
    return { ok: false, error: "Forbidden." };
  }

  const supabase = await createSupabaseClient();

  const logged = await createAuditLog(supabase, {
    entityType: "project_activity",
    entityId: null,
    parentEntityType: "confirmed_order",
    parentEntityId: null,
    action: stepKey,
    title: `${stepLabel} — Logged via Project Activity`,
    description: remark,
    metadata: { orderNo, stepKey, stepLabel },
    createdBy: user.id,
  });

  if (!logged) {
    return { ok: false, error: "Failed to log activity." };
  }

  return { ok: true };
}
