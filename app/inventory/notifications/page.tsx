import { NotificationsPageContent } from "@/components/notifications/notifications-page-content";
import { requireInventoryUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Received notifications only. The full /notifications page (with Sent) stays closed to Warehouse Staff. */
export default async function InventoryNotificationsPage() {
  await requireInventoryUser();
  return <div className="-mx-3 sm:-mx-4 lg:-mx-8"><h1 className="sr-only">Notifications</h1><NotificationsPageContent /></div>;
}
