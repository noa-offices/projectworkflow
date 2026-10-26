"use server";

import { inventoryPhotoError, inventoryPhotoContentType } from "./photo-limits";
import { deleteConfirmationMatches, deletedProductMessage, type ProductDeleteSummary } from "./delete-product";
import { revalidatePath } from "next/cache";
import { requireInventoryUser } from "@/lib/auth";
import { logServerActionError } from "@/lib/action-errors";
import { createClient } from "@/lib/supabase/server";
import { canManageInventory, canSeeCosts, canSubmitAddTake, canSubmitHoldBook, canViewInventory } from "./access";
import { inventoryErrorMessage } from "./action-errors";
import { InventoryInputError, integer, boolean, categoryInput, code, fulfilReservationInput, invalid, movementInput, object, photoInput, productInput, text, uuid, validatePhotoSet } from "./action-validation";

export type InventoryActionResult<T extends object = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };
type Client = Awaited<ReturnType<typeof createClient>>;
const denied = () => ({ ok: false, error: "You do not have permission to do that." } as const);
async function perform<T extends object>(label: string, work: () => Promise<T>): Promise<InventoryActionResult<T>> {
  try { return { ok: true, ...await work() }; }
  catch (error) {
    if (error instanceof InventoryInputError) return { ok: false, error: error.message };
    const friendly = inventoryErrorMessage(error);
    if (!friendly) logServerActionError(`Inventory: ${label}`, error);
    return { ok: false, error: friendly ?? "Something went wrong. Please try again." };
  }
}
async function rpc(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.schema("inventory").rpc(name, args);
  if (error) throw error;
  return data;
}
function returnedId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Inventory function returned no identifier");
  return uuid(value);
}
const refresh = () => revalidatePath("/inventory", "layout");

export async function recordDirectMovement(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("record movement", async () => {
    const args = movementInput(input), client = await createClient();
    const movementId = returnedId(await rpc(client, "record_direct_movement", args));
    refresh(); return { movementId };
  });
}
export async function submitMovementRequest(input: unknown) {
  const { profile } = await requireInventoryUser();
  const role = profile?.role;
  if (!canManageInventory(role) && !canSubmitHoldBook(role) && !canSubmitAddTake(role)) return denied();
  // Permission is checked before creating a client, including the request-type-specific rule.
  const kind = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>).requestType : undefined;
  if (!canManageInventory(role) && !(canSubmitHoldBook(role) && (kind === "hold" || kind === "book"))
    && !(canSubmitAddTake(role) && (kind === "take" || kind === "move"))) return denied();
  return perform("submit movement request", async () => {
    const args = movementInput(input, true), client = await createClient();
    const data = object(await rpc(client, "submit_movement_request", args));
    const requestId = returnedId(data.request_id), movementId = data.movement_id == null ? null : returnedId(data.movement_id), reservationId = data.reservation_id == null ? null : returnedId(data.reservation_id);
    refresh(); return { requestId, movementId, reservationId };
  });
}
export async function reviewMovementRequest(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("review movement request", async () => {
    const value = object(input), args = { request_id: uuid(value.requestId), decision: code(value.decision, ["approved", "rejected"], "decision"), review_note: text(value.reviewNote, "Review note", 2000, value.decision === "rejected") };
    await rpc(await createClient(), "review_movement_request", args);
    refresh(); return {};
  });
}
export async function submitProductRequest(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role) && !canSubmitAddTake(profile?.role)) return denied();
  return perform("submit product request", async () => {
    const payload = productInput(input, canSeeCosts(profile?.role), false);
    const data = object(await rpc(await createClient(), "submit_product_request", { payload }));
    const requestId = returnedId(data.request_id), productId = data.product_id == null ? null : returnedId(data.product_id);
    refresh(); return { requestId, productId };
  });
}
export async function reviewProductRequest(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("review product request", async () => {
    const value = object(input), args = { request_id: uuid(value.requestId), decision: code(value.decision, ["approved", "rejected"], "decision"), review_note: text(value.reviewNote, "Review note", 2000, value.decision === "rejected") };
    const data = await rpc(await createClient(), "review_product_request", args);
    refresh(); return { productId: data === null ? null : returnedId(data) };
  });
}
export async function reviewProductRequestWithEdits(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform('review product request with edits', async () => {
    const value = object(input), decision = code(value.decision, ['approved','rejected'], 'decision');
    const args = { request_id: uuid(value.requestId), decision, review_note: text(value.reviewNote, 'Review note', 2000, decision === 'rejected'),
      edits: decision === 'rejected' ? {} : productInput(value.edits ?? {}, true, true, true) };
    const data = await rpc(await createClient(), 'review_product_request_with_edits', args);
    refresh(); return { productId: data === null ? null : returnedId(data) };
  });
}
export async function releaseReservation(input: unknown) {
  const { user, profile } = await requireInventoryUser();
  if (!canViewInventory(profile?.role)) return denied();
  return perform('release reservation', async () => {
    const value = object(input), reservation_id = uuid(value.reservationId), note = text(value.note,'Note',2000), client = await createClient();
    if (!canManageInventory(profile?.role)) {
      const {data,error} = await client.schema('inventory').from('reservations').select('created_by').eq('id',reservation_id).limit(1).returns<{created_by:string}[]>();
      if (error) throw error;
      if (!data?.length || data[0].created_by !== user.id) invalid('You do not have permission to do that.');
    }
    await rpc(client,'release_reservation',{reservation_id,note});
    refresh(); return {};
  });
}
export async function fulfilReservation(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform('fulfil reservation',async () => {
    const args = fulfilReservationInput(input);
    const movementId = returnedId(await rpc(await createClient(),'fulfil_reservation',args));
    refresh(); return {movementId};
  });
}
export async function searchInventoryProjects(search: string) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role) && !canSubmitHoldBook(profile?.role)) return denied();
  return perform('search inventory projects',async () => {
    const term = text(search,'Search',100) ?? '';
    const {listProjectsForInventory} = await import('./queries');
    return {projects:await listProjectsForInventory(term)};
  });
}
/** Product choices for the Move screen. Managers only; stock numbers only, never costs. */
export async function searchMovementProducts(search: string) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("search movement products", async () => {
    const term = text(search, "Search", 100) ?? "";
    const { listProducts } = await import("./queries");
    const { toPickerProduct } = await import("./movement-form");
    const page = await listProducts({ search: term, sort: "name_asc", active: true }, 1);
    return { products: page.items.map(toPickerProduct) };
  });
}
/** Item choices for the worker take/move page. Warehouse Staff only; stock numbers only, never costs. */
export async function searchRequestProducts(search: string) {
  const { profile } = await requireInventoryUser();
  if (!canSubmitAddTake(profile?.role)) return denied();
  return perform("search request products", async () => {
    const term = text(search, "Search", 100) ?? "";
    const { listProducts } = await import("./queries");
    const { toPickerProduct } = await import("./movement-form");
    const page = await listProducts({ search: term, sort: "name_asc", active: true }, 1);
    return { products: page.items.map(toPickerProduct) };
  });
}
export async function updateProduct(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("update product", async () => {
    const value = object(input), args = { product_id: uuid(value.productId), patch: productInput(value.patch, canSeeCosts(profile?.role), true) };
    await rpc(await createClient(), "update_product", args);
    refresh(); return {};
  });
}
export async function removeProduct(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("remove product", async () => {
    const value = object(input), args = { product_id: uuid(value.productId), reason: text(value.reason, "Reason", 1000, true) };
    await rpc(await createClient(), "remove_product", args);
    refresh(); return {};
  });
}

type Category = { id: string; parent_id: string | null };
async function category(client: Client, id: string) {
  const { data, error } = await client.schema("inventory").from("categories").select("id,parent_id").eq("id", id).limit(1).returns<Category[]>();
  if (error) throw error;
  if (!data?.length) invalid("That category is no longer available.");
  return data[0];
}
async function checkParent(client: Client, parentId: string | null | undefined) {
  if (!parentId) return;
  const parent = await category(client, parentId);
  if (parent.parent_id !== null) invalid("Choose a top-level category as the parent.");
}
export async function createCategory(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("create category", async () => {
    const values = categoryInput(input, false), client = await createClient();
    await checkParent(client, values.parent_id);
    const { data, error } = await client.schema("inventory").from("categories").insert(values).select("id").returns<{ id: string }[]>();
    if (error) throw error;
    const categoryId = returnedId(data?.[0]?.id);
    refresh(); return { categoryId };
  });
}
export async function updateCategory(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("update category", async () => {
    const value = object(input), categoryId = uuid(value.categoryId), patch = categoryInput(value.patch, true);
    if (patch.parent_id === categoryId) invalid("A category cannot be its own parent.");
    const client = await createClient();
    const current = await category(client, categoryId);
    // Parent is assigned at creation. Metadata updates cannot race to create cycles
    // or move an existing parent beneath another category while children are added.
    if ("parent_id" in patch && patch.parent_id !== current.parent_id) invalid("A category's parent is set when it is created.");
    delete patch.parent_id;
    if (!Object.keys(patch).length) invalid("Provide a category name or sort order to update.");
    const { data, error } = await client.schema("inventory").from("categories").update(patch).eq("id", categoryId).select("id");
    if (error) throw error;
    if (!data?.length) invalid("That category is no longer available.");
    refresh(); return {};
  });
}
export async function setCategoryActive(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("set category active", async () => {
    const value = object(input), categoryId = uuid(value.categoryId), active = boolean(value.active), client = await createClient();
    const { data, error } = await client.schema("inventory").from("categories").update({ is_active: active }).eq("id", categoryId).select("id");
    if (error) throw error;
    if (!data?.length) invalid("That category is no longer available.");
    refresh(); return {};
  });
}

export async function registerInventoryPhotos(input: unknown) {
  const { user, profile } = await requireInventoryUser();
  const attempted = input && typeof input === "object" && "files" in input && Array.isArray(input.files) ? input.files.length : 0;
  if (!canManageInventory(profile?.role) && !canSubmitAddTake(profile?.role)) return { ...denied(), failedCount: attempted };
  if (!canManageInventory(profile?.role) && input && typeof input === "object" && "ownerType" in input && input.ownerType === "product") return { ...denied(), failedCount: attempted };
  const result = await perform("register photos", async () => {
    const plan = photoInput(input), client = await createClient();
    const key = plan.ownerType === "product" ? "product_id" : "product_request_id";
    if (plan.ownerType === "request") {
      const { data, error } = await client.schema("inventory").from("product_requests").select("id,submitted_by,request_status").eq("id", plan.ownerId).limit(1).returns<{ id: string; submitted_by: string; request_status: string }[]>();
      if (error) throw error;
      if (!data?.length || data[0].submitted_by !== user.id) invalid("You can only add photos to your own request.");
      if (data[0].request_status !== "pending_review") invalid("Photos can only be added while the request is pending review.");
    } else {
      const { data, error } = await client.schema("inventory").from("products").select("id").eq("id", plan.ownerId).limit(1);
      if (error) throw error;
      if (!data?.length) invalid("That product is no longer available.");
    }
    const { data: existing, error } = await client.schema("inventory").from("product_images").select("sort_order,is_main,storage_path").eq(key, plan.ownerId).limit(4).returns<{ sort_order: number; is_main: boolean; storage_path: string }[]>();
    if (error) throw error;
    if (!existing) throw new Error("Missing inventory photo response");
    validatePhotoSet(existing, plan.files);
    if (plan.files.some(file => existing.some(row => row.storage_path === file.path))) invalid("That photo has already been registered.");
    const storage = client.storage.from("inventory-images");
    await Promise.all(plan.files.map(async file => {
      const { data, error } = await storage.info(file.path);
      if (error) {
        if ("statusCode" in error && String(error.statusCode) === "404") invalid("An uploaded photo could not be found. Please upload it again.");
        throw error;
      }
      const size = data.size ?? data.metadata?.size;
      const contentType = data.contentType ?? data.metadata?.mimetype;
      const problem=inventoryPhotoError(size,contentType); if(problem) invalid(problem);
      if (size !== file.sizeBytes || contentType !== file.contentType) invalid("Photo details do not match the uploaded file. Please upload it again.");
      const {data:stored,error:downloadError}=await storage.download(file.path);
      if(downloadError) throw downloadError;
      if(!stored) invalid("This photo could not be read. Please upload it again.");
      const actualType=inventoryPhotoContentType(new Uint8Array(await stored.slice(0,12).arrayBuffer()));
      const actualProblem=inventoryPhotoError(stored.size,actualType);if(actualProblem) invalid(actualProblem);
      if(stored.size!==size || actualType!==contentType) invalid("Photo contents do not match the file details. Choose a JPEG, PNG or WebP photo and upload it again.");
    }));
    const { error: insertError } = await client.schema("inventory").from("product_images").insert(plan.files.map(file => ({
      product_id: plan.ownerType === "product" ? plan.ownerId : null,
      product_request_id: plan.ownerType === "request" ? plan.ownerId : null,
      storage_bucket: "inventory-images", storage_path: file.path, content_type: file.contentType, size_bytes: file.sizeBytes,
      sort_order: file.sortOrder, is_main: file.isMain, uploaded_by: user.id,
    })));
    if (insertError) throw insertError;
    refresh(); return { registeredCount: plan.files.length };
  });
  // Registration is one INSERT statement: every file in a failed batch remains unregistered.
  // The separately created request is retained; no request-delete path exists here.
  return { ...result, failedCount: result.ok ? 0 : attempted };
}
export async function setMainProductPhoto(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("set main photo", async () => {
    const photoId = uuid(object(input).photoId);
    await rpc(await createClient(), "set_main_product_photo", { photo_id: photoId });
    refresh(); return {};
  });
}
export async function removeProductPhoto(input: unknown) {
  const { profile } = await requireInventoryUser();
  if (!canManageInventory(profile?.role)) return denied();
  return perform("remove photo", async () => {
    const photoId = uuid(object(input).photoId), client = await createClient();
    const path = await rpc(client, "remove_product_photo", { photo_id: photoId });
    refresh();
    if (typeof path !== "string" || !path) throw new Error("Photo removal returned no storage path");
    try {
      const { error } = await client.storage.from("inventory-images").remove([path]);
      if (error) throw error;
    } catch (error) {
      logServerActionError("Inventory: delete stored photo", error);
      invalid("The photo record was removed, but the stored file could not be deleted. File cleanup is still needed.");
    }
    return {};
  });
}

export async function createLocalBrand(input: unknown) {
 const {profile}=await requireInventoryUser();
 if (!canManageInventory(profile?.role)) return denied();
 return perform("create Inventory-only brand",async()=>{
  const value=object(input), name=text(value.name,"Brand name",200,true)!, shortCode=text(value.code,"Short code",5,true)!.toUpperCase();
  if(!/^[A-Z0-9]{2,5}$/.test(shortCode) || shortCode==="GEN") invalid("Use 2?5 letters or numbers. GEN is reserved.");
  const brandId=returnedId(await rpc(await createClient(),"create_local_brand",{name,code:shortCode}));
  refresh();return {brandId};
 });
}

function parseDeleteSummary(value: unknown): ProductDeleteSummary {
 const row=object(value);
 if(typeof row.stock_ref!=="string" || !row.stock_ref) throw new Error("Product has no stock reference");
 return {stock_ref:row.stock_ref,photos:integer(row.photos),movements:integer(row.movements),reservations:integer(row.reservations)};
}
export async function getProductDeleteSummary(input: unknown) {
 const {profile}=await requireInventoryUser();
 if(!canManageInventory(profile?.role)) return {...denied(),code:"42501" as const};
 return perform("read permanent delete summary",async()=>{
  const productId=uuid(object(input).productId);
  return {summary:parseDeleteSummary(await rpc(await createClient(),"get_product_delete_summary",{product_id:productId}))};
 });
}
export async function deleteProductPermanently(input: unknown) {
 const {profile}=await requireInventoryUser();
 if(!canManageInventory(profile?.role)) return {...denied(),code:"42501" as const};
 return perform("permanently delete item",async()=>{
  const value=object(input), productId=uuid(value.productId), client=await createClient();
  const summary=parseDeleteSummary(await rpc(client,"get_product_delete_summary",{product_id:productId}));
  if(typeof value.stockRef!=="string" || !deleteConfirmationMatches(value.stockRef,summary.stock_ref)) invalid("Type the item's Stock ref exactly to delete it.");
  const returned=await rpc(client,"delete_product_permanently",{product_id:productId});
  if(!Array.isArray(returned) || returned.some(path=>typeof path!=="string" || !path)) throw new Error("Item deletion returned invalid photo paths");
  const paths=[...new Set(returned as string[])], leftovers:string[]=[];
  // The database transaction has committed. Each failure here is a cleanup warning.
  for(const path of paths) {
   try {const {error}=await client.storage.from("inventory-images").remove([path]);if(error) throw error;}
   catch {leftovers.push(path);}
  }
  if(leftovers.length) logServerActionError("Inventory: item deleted; photo cleanup incomplete",new Error("Storage cleanup failed"),{productId,leftoverPaths:leftovers});
  refresh();
  return {failedPhotoCount:leftovers.length,message:deletedProductMessage(leftovers.length)};
 });
}
