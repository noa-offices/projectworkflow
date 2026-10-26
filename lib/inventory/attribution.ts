import { inventoryPersonName } from "./presentation";

/** The request that created an item or movement. Ids decide "same person"; names are display only. */
export interface InventoryAttributionRequest { requester_id: string | null; requester_name: string | null; approver_id: string | null; approver_name: string | null }
export interface InventoryAttribution { creator_name: string | null; request: InventoryAttributionRequest | null }
/** Where an approved request points: who asked and who approved. */
export interface InventoryOrigin { requester_id: string; approver_id: string | null }

type People = ReadonlyMap<string, string | null>;
const name = (people: People, id: string | null) => (id ? people.get(id) ?? null : null);

export function buildAttribution(creatorId: string | null, origin: InventoryOrigin | null | undefined, people: People): InventoryAttribution {
  return {
    creator_name: name(people, creatorId),
    request: origin ? { requester_id: origin.requester_id, requester_name: name(people, origin.requester_id), approver_id: origin.approver_id, approver_name: name(people, origin.approver_id) } : null,
  };
}

/** One wording for every screen. `verb` is "Added" for items and "Recorded" for stock movements. */
export function inventoryAttributionLine(attribution: InventoryAttribution | null | undefined, verb: "Added" | "Recorded" = "Added"): string {
  const request = attribution?.request;
  if (!request) return `${verb} by ${inventoryPersonName(attribution?.creator_name)}`;
  if (request.requester_id && request.requester_id === request.approver_id) return `${verb} by ${inventoryPersonName(request.requester_name)}`;
  return `Requested by ${inventoryPersonName(request.requester_name)} · Approved by ${inventoryPersonName(request.approver_name)}`;
}

/** Attribution of an approved request row itself. Anything not yet approved keeps its normal "submitted by" wording. */
export function requestAttribution(request: { request_status: string; submitted_by: string; submitter_display_name: string | null; reviewed_by: string | null; reviewer_display_name: string | null }): InventoryAttribution | null {
  if (request.request_status !== "approved") return null;
  return { creator_name: request.reviewer_display_name, request: { requester_id: request.submitted_by, requester_name: request.submitter_display_name, approver_id: request.reviewed_by, approver_name: request.reviewer_display_name } };
}

/** The people line for a request row: approved requests read "Requested by X · Approved by Y", others keep the submitter. */
export function requestPeopleLine(request: Parameters<typeof requestAttribution>[0] & { item_name?: string }): string {
  const attribution = requestAttribution(request);
  return attribution ? inventoryAttributionLine(attribution, "item_name" in request ? "Added" : "Recorded") : inventoryPersonName(request.submitter_display_name);
}
