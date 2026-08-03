export function isClientPaymentAttachmentManager(role: string | null | undefined): boolean {
  return role === "system_owner" || role === "admin_manager";
}
