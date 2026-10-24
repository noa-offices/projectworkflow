import { canManageInventory, canSubmitAddTake, canSubmitHoldBook } from './access';
import { code, invalid, movementInput, text, uuid } from './action-validation';
import type { InventorySearchParams } from './presentation';
import { LOCATION_LABELS, LOCATION_QUANTITY_COLUMNS, REQUEST_STATUSES } from './types';
import type { InventoryProduct, RequestType } from './types';

export function requestButtons(role: string | null | undefined) {
  const manager = canManageInventory(role);
  return { add: manager || canSubmitAddTake(role), takeMove: manager || canSubmitAddTake(role), holdBook: manager || canSubmitHoldBook(role), review: manager };
}
export function movementSubmitLabel(role: string | null | undefined, kind: RequestType, preview = false) {
  if (canManageInventory(role)) return { take: 'Take now', move: 'Move now', hold: 'Hold now', book: 'Book now' }[kind];
  return preview ? 'Send sample request' : 'Send request';
}
export function parseRequestParams(params: InventorySearchParams, manager: boolean) {
  const first = (key: string) => { const value = params[key]; return Array.isArray(value) ? value[0] : value; };
  const status = first('status'), page = first('page') ?? '';
  return {
    tab: first('tab') === 'movements' ? 'movements' as const : 'products' as const,
    status: status === 'all' || REQUEST_STATUSES.includes(status as typeof REQUEST_STATUSES[number]) ? status as typeof REQUEST_STATUSES[number] | 'all' : manager ? 'pending_review' as const : 'all' as const,
    mine: first('mine') === '1',
    page: /^\d+$/.test(page) && Number(page) >= 1 && Number(page) <= 1000000 ? Number(page) : 1,
  };
}
export function availableLocations(product: InventoryProduct) {
  return (Object.keys(LOCATION_LABELS) as (keyof typeof LOCATION_LABELS)[]).filter(location => location !== 'sold').map(location => ({ location, label: LOCATION_LABELS[location], available: Math.min(product[LOCATION_QUANTITY_COLUMNS[location]], product.available_quantity) }));
}
export type MovementRequestDraft = { kind: RequestType; quantity: string; from: string; to: string; note: string; projectId?: string | null; referenceNote?: string | null; expiresAt?: string | null };
export function movementRequestPayload(product: InventoryProduct, draft: MovementRequestDraft) {
  if (!product.is_active) invalid('Requests are not available for removed products.');
  if (!/^\d+$/.test(draft.quantity)) invalid('Quantity must be a positive whole number.');
  const quantity = Number(draft.quantity);
  const payload = { productId: product.id, requestType: draft.kind, actionType: draft.kind === 'take' ? 'sale' : 'internal_transfer',
    quantity, fromLocation: draft.from || null, toLocation: draft.kind === 'take' ? 'sold' : draft.to || null, note: draft.note,
    projectId: draft.projectId || null, referenceNote: draft.referenceNote || null, expiresAt: draft.expiresAt || null };
  const parsed = movementInput(payload, true);
  if (draft.kind === 'take' || draft.kind === 'move') {
    const source = availableLocations(product).find(row => row.location === parsed.from_location);
    if (!source || quantity > source.available) invalid(`Only ${source?.available ?? 0} units are available in ${source?.label ?? 'that location'}; ${product.reserved_quantity} units are reserved across locations.`);
  } else if (quantity > product.available_quantity) {
    invalid(`Only ${product.available_quantity} units are available; ${product.reserved_quantity} are reserved.`);
  }
  return { ...payload, fromLocation: parsed.from_location, toLocation: parsed.to_location, note: parsed.note,
    projectId: parsed.project_id, referenceNote: parsed.reference_note, expiresAt: parsed.expires_at };
}
export function reviewRequestPayload(requestId: string, decision: 'approved' | 'rejected', reviewNote: string) {
  const note = text(reviewNote, 'Review note', 2000, decision === 'rejected');
  return { requestId: uuid(requestId), decision: code(decision, ['approved', 'rejected'], 'decision'), reviewNote: note };
}
