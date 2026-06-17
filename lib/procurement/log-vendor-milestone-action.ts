"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/lib/audit-log";

const STEP_EMOJI: Record<string, string> = {
  rfq:                 "📋",
  po_issued:           "📄",
  deposit_paid:        "💰",
  in_production:       "🏭",
  quality_check:       "🔍",
  ready_for_shipment:  "📦",
  in_transit:          "🚢",
  delivered_installed: "🔧",
};

type LogVendorMilestoneResult =
  | { ok: true }
  | { ok: false; error: string };

export async function logVendorMilestoneAction(
  orderNo: string,
  quotationId: string,
  vendorKey: string,
  vendorLabel: string,
  stepKey: string,
  stepLabel: string,
  note?: string | null,
): Promise<LogVendorMilestoneResult> {
  const { user, profile } = await requireActiveUser();

  const role = profile?.role ?? null;
  const canProcure =
    role === "system_owner" ||
    role === "admin_manager" ||
    role === "procurement_manager";

  if (!canProcure) {
    return { ok: false, error: "Forbidden." };
  }

  const emoji = STEP_EMOJI[stepKey] ?? "📋";
  const title = `${emoji} ${stepLabel} (${vendorLabel}) — Logged via Procurement`;
  const description = note || `Vendor: ${vendorLabel} | Order: ${orderNo} | Step: ${stepLabel}`;

  const supabase = await createSupabaseClient();

  const logged = await createAuditLog(supabase, {
    entityType: "procurement_vendor",
    entityId: null,
    parentEntityType: "confirmed_order",
    parentEntityId: null,
    action: "vendor_milestone_updated",
    title,
    description,
    metadata: { orderNo, vendorKey, vendorLabel, stepKey, stepLabel },
    createdBy: user.id,
  });

  if (!logged) {
    return { ok: false, error: "Failed to log milestone." };
  }

  return { ok: true };
}
