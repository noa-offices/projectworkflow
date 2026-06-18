"use server";

import { requireActiveUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { NotificationRow } from "@/lib/notifications/actions";

export type EnrichedNotification = NotificationRow & {
  sender_name: string | null;
};

export async function getRecentNotificationsWithSenders(
  limit = 10,
): Promise<{ ok: true; data: EnrichedNotification[] } | { ok: false; error: string }> {
  const { user } = await requireActiveUser();

  // Session client for notifications — RLS SELECT policy allows reading own rows.
  const supabase = await createClient();

  const { data: notifications, error: notifError } = await supabase
    .from("notifications")
    .select("id,recipient_id,sender_id,body,order_no,sent_to_role,read_at,created_at,requires_response,response")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (notifError) {
    return { ok: false, error: "Failed to load notifications" };
  }

  const rows = (notifications ?? []) as NotificationRow[];

  if (rows.length === 0) {
    return { ok: true, data: [] };
  }

  // Admin client required for profiles — RLS only lets a user read their own profile row,
  // so the session client cannot look up other senders' names.
  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    // Degrade gracefully: show notifications without sender names rather than failing.
    return {
      ok: true,
      data: rows.map((r) => ({ ...r, sender_name: null })),
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = adminResult.client as any;

  const senderIds = [...new Set(rows.map((r) => r.sender_id))];

  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id,full_name")
    .in("id", senderIds);

  const nameMap = new Map<string, string | null>();
  for (const p of profiles ?? []) {
    nameMap.set(p.id as string, (p.full_name as string | null) ?? null);
  }

  return {
    ok: true,
    data: rows.map((r) => ({ ...r, sender_name: nameMap.get(r.sender_id) ?? null })),
  };
}
