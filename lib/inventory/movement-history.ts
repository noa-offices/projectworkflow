import { isInventoryProductId } from "./presentation";
import { dubaiDayBounds } from './date-time';
import type { InventorySearchParams } from "./presentation";
import { LOCATION_LABELS, MOVEMENT_ACTIONS } from "./types";
import type { InventoryLocation, MovementAction, MovementFilters } from "./types";

export type MovementUrlState = { q: string; action: string; location: string; from: string; to: string; person: string; product: string; page: number };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string) => DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** The URL is the source of truth: unknown or malformed values are dropped. */
export function parseMovementParams(params: InventorySearchParams): { state: MovementUrlState; filters: MovementFilters; page: number } {
  const first = (key: string) => { const value = params[key]; return (Array.isArray(value) ? value[0] : value) ?? ""; };
  const rawPage = first("page"), page = /^\d+$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= 1000000 ? Number(rawPage) : 1;
  const from = validDate(first("from")) ? first("from") : "", to = validDate(first("to")) ? first("to") : "";
  const state: MovementUrlState = {
    q: first("q").trim().slice(0, 100), person: first("person").trim().slice(0, 100),
    action: (MOVEMENT_ACTIONS as readonly string[]).includes(first("action")) ? first("action") : "",
    location: Object.keys(LOCATION_LABELS).includes(first("location")) ? first("location") : "",
    from, to: from && to && to < from ? "" : to,
    product: isInventoryProductId(first("product")) ? first("product").toLowerCase() : "", page,
  };
  const filters: MovementFilters = {
    search: state.q || undefined, person: state.person || undefined, action_type: (state.action || undefined) as MovementAction | undefined,
    location: (state.location || undefined) as InventoryLocation | undefined, product_id: state.product || undefined,
    from: state.from ? dubaiDayBounds(state.from,state.from).from : undefined, to: state.to ? dubaiDayBounds(state.to,state.to).to : undefined,
  };
  return { state, filters, page };
}
export function movementsHref(state: MovementUrlState, patch: Partial<MovementUrlState> = {}, baseHref = "/inventory/movements") {
  const next = { ...state, ...patch }, [path, fixed] = baseHref.split("?", 2), query = new URLSearchParams(fixed);
  for (const key of ["q", "action", "location", "from", "to", "person", "product"] as const) { if (next[key]) query.set(key, next[key]); else query.delete(key); }
  if (next.page > 1) query.set("page", String(next.page)); else query.delete("page");
  const suffix = query.toString();
  return `${path}${suffix ? `?${suffix}` : ""}`;
}
export const hasMovementFilters = (state: MovementUrlState): boolean => !!(state.q || state.action || state.location || state.from || state.to || state.person || state.product);
