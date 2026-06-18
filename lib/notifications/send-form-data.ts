"use server";

import { requireActiveUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSentNotifications,
  type DirectSentNotification,
  type BroadcastSummary,
  type BroadcastRecipient,
} from "@/lib/notifications/actions";

export type ProfileForSelect = {
  id: string;
  full_name: string | null;
  email: string | null;
};

export type EnrichedDirectSent = DirectSentNotification & {
  recipient_name: string | null;
};

export type EnrichedBroadcastRecipient = BroadcastRecipient & {
  recipient_name: string | null;
};

export type EnrichedBroadcastSummary = Omit<BroadcastSummary, "recipients"> & {
  recipients: EnrichedBroadcastRecipient[];
};

export type SentNotificationsEnriched = {
  direct: EnrichedDirectSent[];
  broadcasts: EnrichedBroadcastSummary[];
};

// Fetch all active users for the "Send to a Person" dropdown.
// Requires admin client — session client cannot read other users' profiles
// due to the `profiles_select_own` RLS policy.
export async function getActiveProfilesForSelect(): Promise<
  { ok: true; data: ProfileForSelect[] } | { ok: false; error: string }
> {
  await requireActiveUser();

  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    return { ok: false, error: adminResult.error ?? "Admin client unavailable" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = adminResult.client as any;

  const { data, error } = await client
    .from("profiles")
    .select("id,full_name,email")
    .eq("account_status", "active")
    .order("full_name", { ascending: true });

  if (error) {
    return { ok: false, error: "Failed to load users" };
  }

  return { ok: true, data: (data ?? []) as ProfileForSelect[] };
}

// Wraps getSentNotifications() and enriches recipient names for both direct
// sends and broadcast recipient lists in a single admin profiles lookup.
// Same admin-client-for-profiles pattern as notification-queries.ts sender lookup.
export async function getSentNotificationsEnriched(): Promise<
  { ok: true; data: SentNotificationsEnriched } | { ok: false; error: string }
> {
  const sentResult = await getSentNotifications();
  if (!sentResult.ok) return sentResult;

  const { direct, broadcasts } = sentResult.data;

  // Collect all unique recipient IDs needing name resolution — direct sends
  // and every recipient inside each broadcast group — in one pass.
  const directIds = direct.map((d) => d.recipient_id);
  const broadcastIds = broadcasts.flatMap((b) => b.recipients.map((r) => r.recipient_id));
  const allIds = [...new Set([...directIds, ...broadcastIds])];

  function degraded(): SentNotificationsEnriched {
    return {
      direct: direct.map((d) => ({ ...d, recipient_name: null })),
      broadcasts: broadcasts.map((b) => ({
        ...b,
        recipients: b.recipients.map((r) => ({ ...r, recipient_name: null })),
      })),
    };
  }

  if (allIds.length === 0) {
    return { ok: true, data: degraded() };
  }

  const adminResult = createAdminClient();
  if (adminResult.error || !adminResult.client) {
    return { ok: true, data: degraded() };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = adminResult.client as any;

  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id,full_name")
    .in("id", allIds);

  const nameMap = new Map<string, string | null>();
  for (const p of profiles ?? []) {
    nameMap.set(p.id as string, (p.full_name as string | null) ?? null);
  }

  return {
    ok: true,
    data: {
      direct: direct.map((d) => ({
        ...d,
        recipient_name: nameMap.get(d.recipient_id) ?? null,
      })),
      broadcasts: broadcasts.map((b) => ({
        ...b,
        recipients: b.recipients.map((r) => ({
          ...r,
          recipient_name: nameMap.get(r.recipient_id) ?? null,
        })),
      })),
    },
  };
}
