"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/lib/audit-log";

type LogProjectActivityResult =
  | { ok: true }
  | { ok: false; error: string };

export type ProjectActivityVendorScope =
  | { kind: "project" }
  | { kind: "vendor"; vendorKey: string; vendorLabel: string }
  | { kind: "vendors"; vendors: Array<{ vendorKey: string; vendorLabel: string }> }
  | { kind: "all_vendors"; vendors: Array<{ vendorKey: string; vendorLabel: string }> };

export async function logProjectActivityAction(
  orderNo: string,
  stepKey: string,
  stepLabel: string,
  remark: string | null,
  vendorScope: ProjectActivityVendorScope = { kind: "project" },
  eventCategory = "General",
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

  const vendorMetadata = vendorScope.kind === "vendor"
    ? {
        vendorScope: vendorScope.kind,
        vendorKey: vendorScope.vendorKey,
        vendorLabel: vendorScope.vendorLabel,
      }
    : vendorScope.kind === "all_vendors" || vendorScope.kind === "vendors"
      ? {
          vendorScope: vendorScope.kind,
          vendors: vendorScope.vendors.map((vendor) => ({
            vendorKey: vendor.vendorKey,
            vendorLabel: vendor.vendorLabel,
          })),
        }
      : { vendorScope: vendorScope.kind };

  const logged = await createAuditLog(supabase, {
    entityType: "project_activity",
    entityId: null,
    parentEntityType: "confirmed_order",
    parentEntityId: null,
    action: stepKey,
    title: `${stepLabel} — Logged via Project Activity`,
    description: remark,
    metadata: { orderNo, stepKey, stepLabel, eventCategory, ...vendorMetadata },
    createdBy: user.id,
  });

  if (!logged) {
    return { ok: false, error: "Failed to log activity." };
  }

  return { ok: true };
}
