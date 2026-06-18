import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { NotificationsTabs } from "@/components/notifications/notifications-tabs";
import { requireActiveUser } from "@/lib/auth";

export default async function NotificationsPage() {
  const { user, profile, displayName } = await requireActiveUser();

  return (
    <ErpAppShell
      eyebrow="Inbox"
      title="Notifications"
      description="Your full notification history. Click an item to mark it read."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <NotificationsTabs />
    </ErpAppShell>
  );
}
