import { formatInventoryDate, inventoryPersonName } from './presentation';

type InventoryNotification = { order_no: string | null; created_at: string; sender_name?: string | null };
export const isInventoryNotification = (item: InventoryNotification) => /^\/inventory(?:\/|\?|$)/.test(item.order_no?.trim() ?? '');
/** Null leaves non-Inventory notifications on their existing presentation. */
export function inventoryNotificationTime(item: InventoryNotification): string | null {
  return isInventoryNotification(item) ? formatInventoryDate(item.created_at) : null;
}
export function inventoryNotificationSender(item: InventoryNotification): string | null {
  return inventoryNotificationPerson(item,item.sender_name);
}
export function inventoryNotificationPerson(item: InventoryNotification, name: string | null | undefined): string | null {
  return isInventoryNotification(item) ? inventoryPersonName(name) : null;
}
