// TEMPORARY DEBUG FILE — remove after notification delivery is verified
"use server";

import { requireActiveUser } from "@/lib/auth";
import { sendNotification } from "@/lib/notifications/actions";

export async function sendTestNotificationToSelf() {
  const { user } = await requireActiveUser();
  const body = `Test notification — ${new Date().toLocaleTimeString()}`;
  return sendNotification(user.id, body);
}
