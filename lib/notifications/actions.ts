"use server";

import { requireActiveUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/lib/audit-log";
import { formatSafeActionError, logServerActionError } from "@/lib/action-errors";

// ─── Shared types ────────────────────────────────────────────────────────────

type ActionResult = { ok: true } | { ok: false; error: string };

export type NotificationRow = {
  id: string;
  recipient_id: string;
  sender_id: string;
  body: string;
  order_no: string | null;
  sent_to_role: string | null;
  read_at: string | null;
  created_at: string;
  requires_response: boolean;
  response: "accepted" | "declined" | null;
};

export type DirectSentNotification = Omit<NotificationRow, "sent_to_role"> & {
  sent_to_role: null;
};

export type BroadcastRecipient = {
  recipient_id: string;
  response: "accepted" | "declined" | null;
};

export type BroadcastSummary = {
  sent_to_role: string;
  body: string;
  order_no: string | null;
  created_at: string;
  total: number;
  read_count: number;
  requires_response: boolean;
  accepted_count: number;
  declined_count: number;
  pending_count: number;
  recipients: BroadcastRecipient[];
};

export type SentNotificationsResult = {
  direct: DirectSentNotification[];
  broadcasts: BroadcastSummary[];
};

// ─── Internal helper ─────────────────────────────────────────────────────────

function getAdminClient() {
  const result = createAdminClient();
  if (result.error || !result.client) {
    return { client: null, error: result.error ?? "Admin client unavailable" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: result.client as any, error: null };
}

// ─── 1. sendNotification ─────────────────────────────────────────────────────

export async function sendNotification(
  recipientId: string,
  body: string,
  orderNo?: string,
  requiresResponse?: boolean,
): Promise<ActionResult> {
  const { user, profile } = await requireActiveUser();

  const { client, error: clientError } = getAdminClient();
  if (!client) return { ok: false, error: clientError! };

  const { error } = await client.from("notifications").insert({
    recipient_id: recipientId,
    sender_id: user.id,
    body,
    order_no: orderNo ?? null,
    sent_to_role: null,
    requires_response: requiresResponse ?? false,
  });

  if (error) {
    logServerActionError("SEND NOTIFICATION ERROR", error, {
      action: "sendNotification",
      recipientId,
    });
    return { ok: false, error: formatSafeActionError("Failed to send notification", error) };
  }

  if (orderNo) {
    await createAuditLog(client, {
      entityType: "notification",
      entityId: null,
      parentEntityType: "confirmed_order",
      parentEntityId: null,
      action: "notification_sent",
      title: `Notification sent to user`,
      description: body,
      metadata: { orderNo, recipientId },
      actorName: profile?.full_name ?? null,
      createdBy: user.id,
    });
  }

  return { ok: true };
}

// ─── 2. sendNotificationToRole ───────────────────────────────────────────────

export async function sendNotificationToRole(
  role: string,
  body: string,
  orderNo?: string,
  requiresResponse?: boolean,
): Promise<ActionResult> {
  const { user, profile } = await requireActiveUser();

  const { client, error: clientError } = getAdminClient();
  if (!client) return { ok: false, error: clientError! };

  const { data: recipients, error: profilesError } = await client
    .from("profiles")
    .select("id")
    .eq("role", role)
    .eq("account_status", "active");

  if (profilesError) {
    logServerActionError("SEND NOTIFICATION TO ROLE PROFILES ERROR", profilesError, {
      action: "sendNotificationToRole",
      role,
    });
    return { ok: false, error: formatSafeActionError("Failed to look up role members", profilesError) };
  }

  if (!recipients || recipients.length === 0) {
    return { ok: false, error: `No active users found with role "${role}".` };
  }

  const rows = (recipients as { id: string }[]).map((p) => ({
    recipient_id: p.id,
    sender_id: user.id,
    body,
    order_no: orderNo ?? null,
    sent_to_role: role,
    requires_response: requiresResponse ?? false,
  }));

  const { error: insertError } = await client.from("notifications").insert(rows);

  if (insertError) {
    logServerActionError("SEND NOTIFICATION TO ROLE INSERT ERROR", insertError, {
      action: "sendNotificationToRole",
      role,
    });
    return { ok: false, error: formatSafeActionError("Failed to send notifications", insertError) };
  }

  if (orderNo) {
    await createAuditLog(client, {
      entityType: "notification",
      entityId: null,
      parentEntityType: "confirmed_order",
      parentEntityId: null,
      action: "notification_sent_to_role",
      title: `Notification sent to role: ${role}`,
      description: body,
      metadata: { orderNo, sentToRole: role, recipientCount: rows.length },
      actorName: profile?.full_name ?? null,
      createdBy: user.id,
    });
  }

  return { ok: true };
}

// ─── 3. getMyNotifications ───────────────────────────────────────────────────

export async function getMyNotifications(): Promise<{ ok: true; data: NotificationRow[] } | { ok: false; error: string }> {
  const { user } = await requireActiveUser();

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("id,recipient_id,sender_id,body,order_no,sent_to_role,read_at,created_at,requires_response,response")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    logServerActionError("GET MY NOTIFICATIONS ERROR", error, { action: "getMyNotifications" });
    return { ok: false, error: formatSafeActionError("Failed to load notifications", error) };
  }

  return { ok: true, data: (data ?? []) as NotificationRow[] };
}

// ─── 4. getUnreadCount ───────────────────────────────────────────────────────

export async function getUnreadCount(): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { user } = await requireActiveUser();

  const supabase = await createClient();

  // Use limit(0) instead of head:true — HEAD responses have no body so errors lose all detail.
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact" })
    .eq("recipient_id", user.id)
    .is("read_at", null)
    .limit(0);

  if (error) {
    logServerActionError("GET UNREAD COUNT ERROR", error, { action: "getUnreadCount" });
    return { ok: false, error: formatSafeActionError("Failed to get unread count", error) };
  }

  return { ok: true, count: count ?? 0 };
}

// ─── 5. markNotificationRead ─────────────────────────────────────────────────

export async function markNotificationRead(notificationId: string): Promise<ActionResult> {
  const { user } = await requireActiveUser();

  const { client, error: clientError } = getAdminClient();
  if (!client) return { ok: false, error: clientError! };

  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (error) {
    logServerActionError("MARK NOTIFICATION READ ERROR", error, {
      action: "markNotificationRead",
      notificationId,
    });
    return { ok: false, error: formatSafeActionError("Failed to mark notification as read", error) };
  }

  return { ok: true };
}

// ─── 6. markAllNotificationsRead ─────────────────────────────────────────────

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const { user } = await requireActiveUser();

  const { client, error: clientError } = getAdminClient();
  if (!client) return { ok: false, error: clientError! };

  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (error) {
    logServerActionError("MARK ALL NOTIFICATIONS READ ERROR", error, {
      action: "markAllNotificationsRead",
    });
    return { ok: false, error: formatSafeActionError("Failed to mark all notifications as read", error) };
  }

  return { ok: true };
}

// ─── 7. getSentNotifications ─────────────────────────────────────────────────

export async function getSentNotifications(): Promise<{ ok: true; data: SentNotificationsResult } | { ok: false; error: string }> {
  const { user } = await requireActiveUser();

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("id,recipient_id,sender_id,body,order_no,sent_to_role,read_at,created_at,requires_response,response")
    .eq("sender_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    logServerActionError("GET SENT NOTIFICATIONS ERROR", error, { action: "getSentNotifications" });
    return { ok: false, error: formatSafeActionError("Failed to load sent notifications", error) };
  }

  const rows = (data ?? []) as NotificationRow[];

  const direct: DirectSentNotification[] = [];
  const broadcastMap = new Map<string, BroadcastSummary>();

  for (const row of rows) {
    if (row.sent_to_role === null) {
      direct.push(row as DirectSentNotification);
    } else {
      // Group key: role + body + order_no — uniquely identifies a single broadcast event
      const key = `${row.sent_to_role}::${row.order_no ?? ""}::${row.body}`;
      const existing = broadcastMap.get(key);
      if (existing) {
        existing.total += 1;
        if (row.read_at !== null) existing.read_count += 1;
        // Keep the earliest created_at as the canonical timestamp for the group
        if (row.created_at < existing.created_at) existing.created_at = row.created_at;
        // Response tallies — only meaningful when requires_response is true
        if (row.requires_response) {
          if (row.response === "accepted") existing.accepted_count += 1;
          else if (row.response === "declined") existing.declined_count += 1;
          else existing.pending_count += 1;
        }
        existing.recipients.push({ recipient_id: row.recipient_id, response: row.response });
      } else {
        broadcastMap.set(key, {
          sent_to_role: row.sent_to_role,
          body: row.body,
          order_no: row.order_no,
          created_at: row.created_at,
          total: 1,
          read_count: row.read_at !== null ? 1 : 0,
          requires_response: row.requires_response,
          accepted_count: row.requires_response && row.response === "accepted" ? 1 : 0,
          declined_count: row.requires_response && row.response === "declined" ? 1 : 0,
          pending_count: row.requires_response && row.response === null ? 1 : 0,
          recipients: [{ recipient_id: row.recipient_id, response: row.response }],
        });
      }
    }
  }

  // Preserve newest-first order for broadcasts (sort by created_at desc)
  const broadcasts = Array.from(broadcastMap.values()).sort(
    (a, b) => b.created_at.localeCompare(a.created_at),
  );

  return { ok: true, data: { direct, broadcasts } };
}

// ─── 8. respondToNotification ────────────────────────────────────────────────

export async function respondToNotification(
  notificationId: string,
  response: "accepted" | "declined",
): Promise<ActionResult> {
  const { user } = await requireActiveUser();

  const { client, error: clientError } = getAdminClient();
  if (!client) return { ok: false, error: clientError! };

  // Verify ownership and current response state before updating.
  // This prevents silent overwrites when two rapid clicks race.
  const { data: existing, error: fetchError } = await client
    .from("notifications")
    .select("id,response")
    .eq("id", notificationId)
    .eq("recipient_id", user.id)
    .single();

  if (fetchError || !existing) {
    return { ok: false, error: "Notification not found." };
  }

  if (existing.response !== null) {
    return { ok: false, error: "You have already responded to this notification." };
  }

  const { error } = await client
    .from("notifications")
    .update({ response })
    .eq("id", notificationId)
    .eq("recipient_id", user.id)
    .is("response", null); // Guard against concurrent updates

  if (error) {
    logServerActionError("RESPOND TO NOTIFICATION ERROR", error, {
      action: "respondToNotification",
      notificationId,
    });
    return { ok: false, error: formatSafeActionError("Failed to record response", error) };
  }

  return { ok: true };
}
