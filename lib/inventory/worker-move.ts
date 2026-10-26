import { availableLocations, movementRequestPayload, type RequestStockProduct } from "./request-presentation";
import type { MovementPickerProduct } from "./types";

export type WorkerRequestKind = "take" | "move";
export type WorkerDraft = { kind: WorkerRequestKind; from: string; to: string; quantity: string; note: string };
type Submit = (payload: ReturnType<typeof movementRequestPayload>) => Promise<{ ok: true } | { ok: false; error: string }>;

const requestable = (product: MovementPickerProduct): RequestStockProduct => ({ ...product, is_active: true });

/** First location that still has units available, so the worker does not start on an empty place. */
export function defaultFromLocation(product: MovementPickerProduct): string {
  return availableLocations(requestable(product)).find(row => row.available > 0)?.location ?? "warehouse";
}
/** The To location can never equal From. */
export function workerToLocation(product: MovementPickerProduct, from: string, to: string): string {
  return to !== from ? to : availableLocations(requestable(product)).find(row => row.location !== from)?.location ?? to;
}

/**
 * Builds the request with the shared rules (whole units, not more than available, reserved stock excluded) and sends it once
 * through the existing request function. It never sets a project or reference: take/move requests do not use them.
 */
export async function sendWorkerRequest(product: MovementPickerProduct, draft: WorkerDraft, submit: Submit): Promise<{ ok: true } | { ok: false; error: string }> {
  let payload: ReturnType<typeof movementRequestPayload>;
  try {
    payload = movementRequestPayload(requestable(product), { ...draft, to: workerToLocation(product, draft.from, draft.to), projectId: null, referenceNote: null, expiresAt: null });
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Check your request and try again." };
  }
  return submit(payload);
}
