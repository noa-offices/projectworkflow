import { canManageInventory } from "./access";
import { LOCATION_LABELS, LOCATION_QUANTITY_COLUMNS, MOVEMENT_ACTIONS } from "./types";
import type { InventoryLocation, InventoryMovement, InventoryProduct, MovementAction, MovementPickerProduct } from "./types";

/** Direct movements, the Movements history and the Move screen are for System Owner and Admin Manager only. */
export const canUseManagerMovements = (role: string | null | undefined): boolean => canManageInventory(role);

export const LIVE_LOCATIONS = ["warehouse", "dubai_showroom", "abudhabi_showroom", "mockup", "temporary_out"] as const satisfies readonly InventoryLocation[];
type LiveLocation = typeof LIVE_LOCATIONS[number];

export const ACTION_FORM_LABELS: Record<MovementAction, string> = {
  receive_stock: "Receive stock", internal_transfer: "Move between locations", return_to_warehouse: "Return to warehouse", sale: "Sale (Sold)", adjustment: "Adjust stock",
};
/** Short plain-words label used in the Movements history. */
export const ACTION_HISTORY_LABELS: Record<MovementAction, string> = {
  receive_stock: "Received", internal_transfer: "Moved", return_to_warehouse: "Returned", sale: "Sold", adjustment: "Adjusted",
};
export const actionHistoryLabel = (action: string): string => ACTION_HISTORY_LABELS[action as MovementAction] ?? "Movement";

/** Which location pickers each action needs. The database fixes the other end. */
export function actionFields(action: MovementAction): { from: boolean; to: boolean; fixedTo: InventoryLocation | null } {
  if (action === "receive_stock" || action === "adjustment") return { from: false, to: false, fixedTo: "warehouse" };
  if (action === "sale") return { from: true, to: false, fixedTo: "sold" };
  if (action === "return_to_warehouse") return { from: true, to: false, fixedTo: "warehouse" };
  return { from: true, to: true, fixedTo: null };
}
export const fromChoices = (action: MovementAction): LiveLocation[] => action === "return_to_warehouse" ? LIVE_LOCATIONS.filter(location => location !== "warehouse") : [...LIVE_LOCATIONS];

type StockProduct = Pick<MovementPickerProduct, "quantity" | "reserved_quantity" | "available_quantity" | "warehouse_quantity" | "dubai_showroom_quantity" | "abudhabi_showroom_quantity" | "mockup_quantity" | "temporary_out_quantity" | "sold_quantity">;
export type MovementDraft = { action: MovementAction; from: string; to: string; quantity: string; note?: string };
export type PreviewRow = { location: InventoryLocation; label: string; before: number; after: number };
export type MovementPreview = { rows: PreviewRow[]; totalBefore: number; totalAfter: number; error: string | null; blocked: boolean };

const stockOf = (product: StockProduct, location: InventoryLocation) => product[LOCATION_QUANTITY_COLUMNS[location]];
const isLive = (value: string): value is LiveLocation => (LIVE_LOCATIONS as readonly string[]).includes(value);

/**
 * Mirrors the database's stock rules so the screen can show the result and block Save.
 * The database stays the authority and re-checks everything.
 */
export function previewMovement(product: StockProduct, draft: MovementDraft): MovementPreview {
  const before = Object.fromEntries((Object.keys(LOCATION_LABELS) as InventoryLocation[]).map(location => [location, stockOf(product, location)])) as Record<InventoryLocation, number>;
  const after = { ...before };
  const fail = (error: string): MovementPreview => ({ rows: [], totalBefore: product.quantity, totalAfter: product.quantity, error, blocked: true });
  const { action } = draft, fields = actionFields(action);
  if (!(MOVEMENT_ACTIONS as readonly string[]).includes(action)) return fail("Choose an action.");
  if (!/^\d+$/.test(draft.quantity.trim())) return fail(action === "adjustment" ? "Enter the new stock as a whole number (0 or more)." : "Enter a whole number above zero.");
  const quantity = Number(draft.quantity);
  if (!Number.isSafeInteger(quantity) || quantity > 2147483647) return fail("That number is too large.");
  if (quantity === 0 && action !== "adjustment") return fail("Enter a whole number above zero.");
  if (fields.from && !isLive(draft.from)) return fail("Choose where the stock comes from.");
  if (fields.to) {
    if (!isLive(draft.to)) return fail("Choose where the stock goes.");
    if (draft.from === draft.to) return fail("Choose different locations to move between.");
  }
  if (["sale", "internal_transfer", "return_to_warehouse"].includes(action) && quantity > product.available_quantity) {
    return fail(`Only ${product.available_quantity} units are available; ${product.reserved_quantity} are reserved.`);
  }
  if (action === "adjustment" && quantity < product.reserved_quantity) return fail("Release reservations first.");
  if (fields.from && quantity > stockOf(product, draft.from as InventoryLocation)) {
    return fail(`Only ${stockOf(product, draft.from as InventoryLocation)} units are in ${LOCATION_LABELS[draft.from as InventoryLocation]}.`);
  }
  const from = draft.from as InventoryLocation, to = (fields.to ? draft.to : fields.fixedTo) as InventoryLocation;
  if (action === "receive_stock") after.warehouse += quantity;
  // The database sets Warehouse to the entered number and clears the other live locations.
  else if (action === "adjustment") for (const location of LIVE_LOCATIONS) after[location] = location === "warehouse" ? quantity : 0;
  else { after[from] -= quantity; after[to] += quantity; }
  const total = (values: Record<InventoryLocation, number>) => LIVE_LOCATIONS.reduce((sum, location) => sum + values[location], 0);
  const rows = (Object.keys(LOCATION_LABELS) as InventoryLocation[]).filter(location => before[location] !== after[location])
    .map(location => ({ location, label: LOCATION_LABELS[location], before: before[location], after: after[location] }));
  return { rows, totalBefore: total(before), totalAfter: total(after), error: null, blocked: false };
}
export const previewText = (preview: MovementPreview): string => preview.rows.map(row => `${row.label} ${row.before} → ${row.after}`).join(", ");

/** The recordDirectMovement input for a draft. */
export function movementPayload(productId: string, draft: MovementDraft) {
  const fields = actionFields(draft.action);
  return {
    productId, actionType: draft.action, quantity: Number(draft.quantity), note: draft.note?.trim() || null,
    fromLocation: fields.from ? draft.from : null, toLocation: fields.to ? draft.to : fields.fixedTo,
  };
}

/** Picker rows carry stock only: never costs or prices. */
export function toPickerProduct(product: InventoryProduct): MovementPickerProduct {
  return {
    id: product.id, item_name: product.item_name, stock_ref: product.stock_ref, item_code: product.item_code, model_name: product.model_name,
    quantity: product.quantity, reserved_quantity: product.reserved_quantity, available_quantity: product.available_quantity, main_image_url: product.main_image_url,
    warehouse_quantity: product.warehouse_quantity, dubai_showroom_quantity: product.dubai_showroom_quantity, abudhabi_showroom_quantity: product.abudhabi_showroom_quantity,
    mockup_quantity: product.mockup_quantity, temporary_out_quantity: product.temporary_out_quantity, sold_quantity: product.sold_quantity,
  };
}

/** "Warehouse → Dubai Showroom" style summary for a history row. */
export function movementRoute(movement: Pick<InventoryMovement, "from_location" | "to_location">): string {
  const name = (location: InventoryLocation | null) => location ? LOCATION_LABELS[location] : "—";
  return `${name(movement.from_location)} → ${name(movement.to_location)}`;
}
export function movementLinkLabel(link: InventoryMovement["linked"]): string | null {
  if (!link) return null;
  return link.kind === "reservation" ? "Booked reservation" : link.kind === "request" ? "Stock request" : "Add-item request";
}
