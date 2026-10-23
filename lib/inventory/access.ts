const viewers = new Set(["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff"]);
const managers = new Set(["system_owner", "admin_manager"]);
const office = new Set(["procurement_manager", "sales_designer", "sales_coordinator", "designer"]);

type RoleValue = string | null | undefined;
// Account status is enforced by requireInventoryUser(), before any query.
export const canViewInventory = (role: RoleValue): boolean => viewers.has(role ?? "");
export const canManageInventory = (role: RoleValue): boolean => managers.has(role ?? "");
export const canSeeCosts = (role: RoleValue): boolean => canManageInventory(role);
export const canSubmitHoldBook = (role: RoleValue): boolean => office.has(role ?? "");
export const canSubmitAddTake = (role: RoleValue): boolean => role === "warehouse_staff";
