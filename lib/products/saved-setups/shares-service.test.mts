/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake client and hostile input */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { isWebpBytes, MAX_STORED_BYTES } from "./custom-item-image";
import { pictureDimensions } from "./custom-item-image-sharp";
import { buildIncomingPicturePath, shareMessage } from "./shares";
import {
  copyIncomingPictureForAccept,
  removeIncomingPicture,
  removeOwnPicture,
  removePurgedPictures,
  transferPictureForSend,
  uploadSharePictureForSend,
} from "./shares-picture";
import {
  acceptCustomItemShare,
  acceptSetupShare,
  attachSharePicture,
  countPendingIncoming,
  dismissShare,
  listIncomingShares,
  listSentShares,
  loadSentShareRouting,
  purgeFinishedShares,
  searchShareTargets,
  sendShare,
  unsendShare,
} from "./shares-service";

const A = "11111111-1111-4111-8111-111111111111"; // sender
const B = "22222222-2222-4222-8222-222222222222"; // recipient
const C = "44444444-4444-4444-8444-444444444444"; // a third user
const SHARE = "33333333-3333-4333-8333-333333333333";
const ITEM = "55555555-5555-4555-8555-555555555555";

// ── Fake client: rpc, share rows, storage ────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;
type Rpc = (args: any) => { data: any; error: any } | Promise<{ data: any; error: any }>;
function makeFake() {
  const state = {
    shares: [] as Row[],
    files: new Map<string, { type: string; bytes: Uint8Array }>(),
    rpc: {} as Record<string, Rpc>,
    calls: [] as string[],
    rpcCalls: [] as Array<{ name: string; args: any }>,
    uploads: [] as Array<{ path: string; options: any }>,
    removed: [] as string[][],
    failDownload: false,
    failUpload: false,
    failRemove: false,
    queries: [] as Array<{ table: string; filters: Array<[string, unknown]>; limit?: number; select?: string }>,
  };
  class Query {
    private filters: Array<[string, unknown]> = [];
    private limitN: number | undefined;
    private selectText = "";
    private wantCount = false;
    constructor(private table: string) {}
    select(columns: string, options?: { count?: string }) { this.selectText = columns; this.wantCount = Boolean(options?.count); return this; }
    eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
    order() { return this; }
    limit(count: number) { this.limitN = count; return this; }
    private run() {
      state.queries.push({ table: this.table, filters: this.filters, limit: this.limitN, select: this.selectText });
      const rows = state.shares.filter((row) => this.filters.every(([column, value]) => row[column] === value));
      return { rows: this.limitN === 0 ? [] : rows.slice(0, this.limitN ?? 1000), count: rows.length };
    }
    maybeSingle() { const result = this.run(); return Promise.resolve({ data: result.rows[0] ?? null, error: null }); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      const result = this.run();
      return Promise.resolve({ data: result.rows, count: this.wantCount ? result.count : null, error: null }).then(resolve, reject);
    }
  }
  const client = {
    rpc: async (name: string, args: any) => {
      state.calls.push(`rpc:${name}`);
      state.rpcCalls.push({ name, args });
      const handler = state.rpc[name];
      return handler ? handler(args) : { data: null, error: null };
    },
    from: (table: string) => new Query(table),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array, options: any) => {
          state.calls.push(`upload:${path}`);
          state.uploads.push({ path, options });
          if (state.failUpload) return { data: null, error: { message: "denied", statusCode: "403" } };
          state.files.set(`${bucket}/${path}`, { type: options?.contentType, bytes: body });
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          state.calls.push(`download:${path}`);
          const file = state.files.get(`${bucket}/${path}`);
          if (state.failDownload || !file) return { data: null, error: { message: "missing" } };
          return { data: new Blob([file.bytes as BlobPart], { type: file.type }), error: null };
        },
        remove: async (paths: string[]) => {
          state.calls.push(`remove:${paths.join(",")}`);
          state.removed.push(paths);
          if (state.failRemove) throw new Error("storage down");
          for (const path of paths) state.files.delete(`${bucket}/${path}`);
          return { data: [], error: null };
        },
      }),
    },
  };
  return { state, client: client as unknown as SupabaseClient };
}

const pngBytes = async (width = 60, height = 40) => new Uint8Array(await sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.6 } } }).png().toBuffer());
const webpBytes = async (width = 16, height = 16) => new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#123456" } }).webp().toBuffer());
const ownPath = (owner = A) => `${owner}/66666666-6666-4666-8666-666666666666/1700000000000-desk.png`;

// ── RPC wrappers ─────────────────────────────────────────────────────────────────────────────────────────────
test("searchShareTargets: under 2 characters makes no call; rows become {id, displayName}; errors become messages", async () => {
  const { state, client } = makeFake();
  assert.deepEqual(await searchShareTargets(client, "a"), { ok: true, targets: [] });
  assert.deepEqual(await searchShareTargets(client, "   "), { ok: true, targets: [] });
  assert.equal(state.rpcCalls.length, 0);
  state.rpc.my_collection_share_targets = () => ({ data: [{ id: B, display_name: "Bea" }, { id: C, display_name: 7 }, { nope: true }], error: null });
  assert.deepEqual(await searchShareTargets(client, "  be  "), { ok: true, targets: [{ id: B, displayName: "Bea" }] });
  assert.deepEqual(state.rpcCalls[0], { name: "my_collection_share_targets", args: { p_query: "be" } });
  state.rpc.my_collection_share_targets = () => ({ data: null, error: { message: "boom", code: "XX000" } });
  assert.deepEqual(await searchShareTargets(client, "be"), { ok: false, kind: "unknown" });
  state.rpc.my_collection_share_targets = () => { throw new Error("network"); };
  assert.deepEqual(await searchShareTargets(client, "be"), { ok: false, kind: "unknown" }, "never throws");
  // the query is capped before it is sent
  state.rpc.my_collection_share_targets = () => ({ data: [], error: null });
  await searchShareTargets(client, "x".repeat(500));
  assert.equal(state.rpcCalls.at(-1)!.args.p_query.length, 60);
});

test("sendShare: calls my_collection_send_share with exactly the four arguments and returns the share id", async () => {
  const { state, client } = makeFake();
  state.rpc.my_collection_send_share = () => ({ data: SHARE, error: null });
  assert.deepEqual(await sendShare(client, { kind: "custom_item", itemId: ITEM, recipientId: B, note: "hi" }), { ok: true, shareId: SHARE });
  assert.deepEqual(state.rpcCalls[0], { name: "my_collection_send_share", args: { p_kind: "custom_item", p_item_id: ITEM, p_recipient_id: B, p_note: "hi" } });
  state.rpc.my_collection_send_share = () => ({ data: null, error: { message: "Too many shares are waiting. Try again later." } });
  assert.deepEqual(await sendShare(client, { kind: "setup", itemId: ITEM, recipientId: B, note: null }), { ok: false, kind: "too_many" });
  state.rpc.my_collection_send_share = () => ({ data: { weird: 1 }, error: null });
  assert.deepEqual(await sendShare(client, { kind: "setup", itemId: ITEM, recipientId: B, note: null }), { ok: false, kind: "unknown" });
  state.rpc.my_collection_send_share = () => { throw new Error("socket hang up"); };
  assert.deepEqual(await sendShare(client, { kind: "setup", itemId: ITEM, recipientId: B, note: null }), { ok: false, kind: "unknown" });
});

test("attach, unsend, dismiss: boolean results; false means 'no longer available'; errors are mapped, nothing throws", async () => {
  const { state, client } = makeFake();
  state.rpc.my_collection_attach_share_picture = () => ({ data: true, error: null });
  assert.equal(await attachSharePicture(client, SHARE, true, null), true);
  assert.deepEqual(state.rpcCalls[0].args, { p_share_id: SHARE, p_ok: true, p_note: null });
  state.rpc.my_collection_attach_share_picture = () => ({ data: false, error: null });
  assert.equal(await attachSharePicture(client, SHARE, false, "note"), false);
  state.rpc.my_collection_attach_share_picture = () => { throw new Error("x"); };
  assert.equal(await attachSharePicture(client, SHARE, true, null), false);

  state.rpc.my_collection_unsend_share = () => ({ data: true, error: null });
  assert.deepEqual(await unsendShare(client, SHARE), { ok: true });
  state.rpc.my_collection_unsend_share = () => ({ data: false, error: null });
  assert.deepEqual(await unsendShare(client, SHARE), { ok: false, kind: "no_longer_available" });
  state.rpc.my_collection_dismiss_share = () => ({ data: true, error: null });
  assert.deepEqual(await dismissShare(client, SHARE), { ok: true });
  assert.deepEqual(state.rpcCalls.at(-1), { name: "my_collection_dismiss_share", args: { p_share_id: SHARE } });
  state.rpc.my_collection_dismiss_share = () => ({ data: false, error: null });
  assert.deepEqual(await dismissShare(client, SHARE), { ok: false, kind: "no_longer_available" });
  state.rpc.my_collection_dismiss_share = () => ({ data: null, error: { message: "Not allowed." } });
  assert.deepEqual(await dismissShare(client, SHARE), { ok: false, kind: "not_allowed" });
});

test("accept: custom item passes the nine arguments; setup passes three; same id back on a second accept; errors are mapped", async () => {
  const { state, client } = makeFake();
  state.rpc.my_collection_accept_custom_item = () => ({ data: ITEM, error: null });
  const value = { brand_name: "Acme", item_name: "Desk", item_code: "D-1", specification: null, unit_label: "Pc", selling_price: 1200, currency: "AED" } as const;
  assert.deepEqual(await acceptCustomItemShare(client, SHARE, value, `${B}/${SHARE}/1-picture.webp`), { ok: true, itemId: ITEM });
  assert.deepEqual(state.rpcCalls[0], {
    name: "my_collection_accept_custom_item",
    args: { p_share_id: SHARE, p_brand: "Acme", p_name: "Desk", p_code: "D-1", p_spec: null, p_unit: "Pc", p_price: 1200, p_currency: "AED", p_image_path: `${B}/${SHARE}/1-picture.webp` },
  });
  assert.deepEqual(await acceptCustomItemShare(client, SHARE, value, null), { ok: true, itemId: ITEM }, "idempotent: the same id again");
  assert.equal(state.rpcCalls[1].args.p_image_path, null);
  state.rpc.my_collection_accept_custom_item = () => ({ data: null, error: { message: "This share is no longer available." } });
  assert.deepEqual(await acceptCustomItemShare(client, SHARE, value, null), { ok: false, kind: "no_longer_available" });

  state.rpc.my_collection_accept_setup = () => ({ data: ITEM, error: null });
  assert.deepEqual(await acceptSetupShare(client, SHARE, "My setup", "n"), { ok: true, setupId: ITEM });
  assert.deepEqual(state.rpcCalls.at(-1), { name: "my_collection_accept_setup", args: { p_share_id: SHARE, p_setup_name: "My setup", p_note: "n" } });
  state.rpc.my_collection_accept_setup = () => ({ data: null, error: { message: "This product is not available to you." } });
  assert.deepEqual(await acceptSetupShare(client, SHARE, "My setup", null), { ok: false, kind: "product_unavailable_you" });
});

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────────────────
test("listIncomingShares: filters on the caller as recipient, maps rows, and never returns a recipe", async () => {
  const { state, client } = makeFake();
  state.shares.push(
    { id: SHARE, kind: "setup", sender_id: A, recipient_id: B, sender_name: "Ada", item_name: "Every white", note: null, payload: { recipe: { secret: "RECIPE" }, spec_overrides: {}, setup_name: "Every white", brand_name: "I", product_name: "Every" }, picture_path: null, picture_note: null, status: "pending", created_at: "2026-11-19T10:00:00Z", responded_at: null, result_item_id: null },
    { id: ITEM, kind: "custom_item", sender_id: A, recipient_id: C, sender_name: "Ada", item_name: "Not for B", note: null, payload: {}, picture_path: null, picture_note: null, status: "pending", created_at: "2026-11-19T10:00:00Z", responded_at: null, result_item_id: null },
  );
  const result = await listIncomingShares(client, B) as any;
  assert.equal(result.ok, true);
  assert.deepEqual(result.shares.map((share: any) => share.id), [SHARE]);
  assert.ok(!JSON.stringify(result).includes("RECIPE"));
  const query = state.queries[0];
  assert.deepEqual(query.filters, [["recipient_id", B]]);
  assert.equal(query.limit, 100);
});

test("listSentShares: filters on the caller as sender and selects no payload", async () => {
  const { state, client } = makeFake();
  state.shares.push({ id: SHARE, kind: "custom_item", sender_id: A, recipient_id: B, item_name: "Desk", note: null, payload: { selling_price: 9 }, picture_path: null, picture_note: null, status: "pending", created_at: "2026-11-19T10:00:00Z", responded_at: null, result_item_id: null });
  const result = await listSentShares(client, A) as any;
  assert.equal(result.shares.length, 1);
  assert.equal((await listSentShares(client, B) as any).shares.length, 0, "the recipient is not the sender");
  assert.deepEqual(state.queries[0].filters, [["sender_id", A]]);
  assert.ok(!state.queries[0].select!.includes("payload"), "no payload column");
  assert.ok(!JSON.stringify(result).includes("selling_price"));
});

test("countPendingIncoming and loadSentShareRouting: caller filters, pending only, head-count style", async () => {
  const { state, client } = makeFake();
  state.shares.push(
    { id: SHARE, sender_id: A, recipient_id: B, status: "pending", picture_path: `${B}/incoming/${SHARE}/picture.webp` },
    { id: ITEM, sender_id: A, recipient_id: B, status: "accepted", picture_path: null },
    { id: "x", sender_id: A, recipient_id: C, status: "pending", picture_path: null },
  );
  assert.deepEqual(await countPendingIncoming(client, B), { ok: true, count: 1 });
  assert.deepEqual(state.queries[0], { table: "my_collection_shares", filters: [["recipient_id", B], ["status", "pending"]], limit: 0, select: "id" });
  assert.deepEqual(await loadSentShareRouting(client, A, SHARE), { recipientId: B, hasPicture: true });
  assert.equal(await loadSentShareRouting(client, C, SHARE), null, "only the sender can load it");
});

test("purgeFinishedShares: returns the picture paths; an error or a throw returns an empty list", async () => {
  const { state, client } = makeFake();
  state.rpc.my_collection_purge_finished_shares = () => ({ data: [{ picture_path: `${B}/incoming/${SHARE}/picture.webp` }, { picture_path: null }, { other: 1 }], error: null });
  assert.deepEqual(await purgeFinishedShares(client), [`${B}/incoming/${SHARE}/picture.webp`]);
  state.rpc.my_collection_purge_finished_shares = () => ({ data: null, error: { message: "x", code: "XX000" } });
  assert.deepEqual(await purgeFinishedShares(client), []);
  state.rpc.my_collection_purge_finished_shares = () => { throw new Error("down"); };
  assert.deepEqual(await purgeFinishedShares(client), []);
});

// ── Picture transfer: SEND ───────────────────────────────────────────────────────────────────────────────────
test("send picture: the sender's own picture becomes a WebP <= 2 MB at the incoming path (upsert false) and is attached", async () => {
  const { state, client } = makeFake();
  state.files.set(`my-collection-images/${ownPath()}`, { type: "image/png", bytes: await pngBytes(2400, 1200) });
  state.rpc.my_collection_attach_share_picture = () => ({ data: true, error: null });
  const result = await transferPictureForSend(client, { senderId: A, imagePath: ownPath(), recipientId: B, shareId: SHARE });
  assert.deepEqual(result, { attached: true, note: null });
  const incoming = buildIncomingPicturePath(B, SHARE);
  const stored = state.files.get(`my-collection-images/${incoming}`)!;
  assert.equal(stored.type, "image/webp");
  assert.ok(isWebpBytes(stored.bytes) && stored.bytes.byteLength <= MAX_STORED_BYTES);
  assert.deepEqual(await pictureDimensions(stored.bytes), { width: 1600, height: 800 }, "long side capped at 1600");
  assert.equal(state.uploads[0].options.upsert, false);
  assert.equal(state.uploads[0].options.contentType, "image/webp");
  assert.deepEqual(state.rpcCalls.at(-1), { name: "my_collection_attach_share_picture", args: { p_share_id: SHARE, p_ok: true, p_note: null } });
  assert.ok(state.files.has(`my-collection-images/${ownPath()}`), "the sender keeps their own picture");
});

test("send picture: every failure still lets the share stand and attaches a note with a short reason", async () => {
  const cases: Array<[string, (f: ReturnType<typeof makeFake>) => Promise<void> | void, string]> = [
    ["download fails", (f) => { f.state.failDownload = true; }, "picture_unavailable"],
    ["not the sender's own path", () => undefined, "picture_unavailable"],
    ["damaged bytes", (f) => { f.state.files.set(`my-collection-images/${ownPath()}`, { type: "image/png", bytes: new TextEncoder().encode("not a picture") }); }, "picture_unreadable"],
    ["upload fails", (f) => { f.state.failUpload = true; }, "picture_upload_failed"],
  ];
  for (const [label, setup, kind] of cases) {
    const fake = makeFake();
    fake.state.files.set(`my-collection-images/${ownPath()}`, { type: "image/png", bytes: await pngBytes() });
    fake.state.rpc.my_collection_attach_share_picture = () => ({ data: false, error: null });
    await setup(fake);
    const imagePath = label === "not the sender's own path" ? ownPath(C) : ownPath();
    const result = await transferPictureForSend(fake.client, { senderId: A, imagePath, recipientId: B, shareId: SHARE });
    assert.deepEqual(result, { attached: false, note: shareMessage(kind as any) }, label);
    const attach = fake.state.rpcCalls.at(-1)!;
    assert.deepEqual(attach, { name: "my_collection_attach_share_picture", args: { p_share_id: SHARE, p_ok: false, p_note: shareMessage(kind as any) } }, label);
    assert.ok(!result.note!.includes(A) && !result.note!.includes("/"), "no path or id in the note");
  }
});

test("send picture: if the database refuses to attach, the uploaded file is removed again", async () => {
  const { state, client } = makeFake();
  state.files.set(`my-collection-images/${ownPath()}`, { type: "image/png", bytes: await pngBytes() });
  state.rpc.my_collection_attach_share_picture = (args) => ({ data: args.p_ok ? false : false, error: null });
  const result = await transferPictureForSend(client, { senderId: A, imagePath: ownPath(), recipientId: B, shareId: SHARE });
  assert.deepEqual(result, { attached: false, note: shareMessage("picture_not_included") });
  assert.equal(state.files.has(`my-collection-images/${buildIncomingPicturePath(B, SHARE)}`), false, "no orphan in the recipient's folder");
  assert.equal(await uploadSharePictureForSend(client, { senderId: A, imagePath: `${A}/../${B}/x/y.png`, recipientId: B, shareId: SHARE }).then((r) => r.ok), false);
});

// ── Picture transfer: ACCEPT and cleanup ─────────────────────────────────────────────────────────────────────
test("accept picture: the incoming WebP is copied into the recipient's own folder; real WebP and 2 MB are re-checked", async () => {
  const { state, client } = makeFake();
  const incoming = buildIncomingPicturePath(B, SHARE);
  const bytes = await webpBytes(100, 80);
  state.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes });
  const now = new Date("2026-11-19T10:00:00Z");
  const result = await copyIncomingPictureForAccept(client, { recipientId: B, shareId: SHARE, picturePath: incoming, now }) as any;
  assert.deepEqual(result, { ok: true, path: `${B}/${SHARE}/${now.getTime()}-picture.webp` });
  assert.deepEqual(Array.from(state.files.get(`my-collection-images/${result.path}`)!.bytes), Array.from(bytes));
  assert.equal(state.uploads[0].options.upsert, false);
  assert.ok(state.files.has(`my-collection-images/${incoming}`), "the incoming file is removed only after a successful accept");

  const cases: Array<[string, () => Promise<any>, string]> = [
    ["a renamed png", async () => { state.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: await pngBytes() }); return copyIncomingPictureForAccept(client, { recipientId: B, shareId: SHARE, picturePath: incoming }); }, "picture_invalid"],
    ["over 2 MB", async () => { const big = await webpBytes(); const huge = new Uint8Array(MAX_STORED_BYTES + 1); huge.set(big.subarray(0, 12)); state.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: huge }); return copyIncomingPictureForAccept(client, { recipientId: B, shareId: SHARE, picturePath: incoming }); }, "picture_invalid"],
    ["another share's path", async () => copyIncomingPictureForAccept(client, { recipientId: B, shareId: SHARE, picturePath: buildIncomingPicturePath(B, ITEM) }), "picture_invalid"],
    ["someone else's folder", async () => copyIncomingPictureForAccept(client, { recipientId: B, shareId: SHARE, picturePath: buildIncomingPicturePath(C, SHARE) }), "picture_invalid"],
    ["missing file", async () => { state.files.delete(`my-collection-images/${incoming}`); return copyIncomingPictureForAccept(client, { recipientId: B, shareId: SHARE, picturePath: incoming }); }, "picture_unavailable"],
    ["upload fails", async () => { state.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes }); state.failUpload = true; return copyIncomingPictureForAccept(client, { recipientId: B, shareId: SHARE, picturePath: incoming }); }, "picture_upload_failed"],
  ];
  for (const [label, run, kind] of cases) assert.deepEqual(await run(), { ok: false, kind }, label);
});

test("cleanup helpers: own files only, incoming paths only, and none of them ever throws", async () => {
  const { state, client } = makeFake();
  const mine = `${B}/${SHARE}/1700000000000-picture.webp`;
  state.files.set(`my-collection-images/${mine}`, { type: "image/webp", bytes: new Uint8Array([1]) });
  assert.equal(await removeOwnPicture(client, B, mine), true);
  assert.equal(state.files.has(`my-collection-images/${mine}`), false);
  assert.equal(await removeOwnPicture(client, A, mine), false, "not A's file");
  assert.equal(await removeOwnPicture(client, B, `${B}/../${A}/x/y.webp`), false, "traversal");
  assert.equal(state.removed.length, 1, "refused paths never reach storage");

  assert.equal(await removeIncomingPicture(client, B, SHARE), true);
  assert.deepEqual(state.removed.at(-1), [buildIncomingPicturePath(B, SHARE)]);
  assert.equal(await removeIncomingPicture(client, "not-a-uuid", SHARE), false);

  await removePurgedPictures(client, [buildIncomingPicturePath(B, SHARE), `${B}/${SHARE}/1-picture.webp`, "junk", `${C}/incoming/${ITEM}/picture.webp`]);
  assert.deepEqual(state.removed.at(-1), [buildIncomingPicturePath(B, SHARE), `${C}/incoming/${ITEM}/picture.webp`], "only incoming paths, in one call");
  const before = state.removed.length;
  await removePurgedPictures(client, ["junk"]);
  assert.equal(state.removed.length, before, "nothing to remove, no call");
  state.failRemove = true;
  assert.equal(await removeIncomingPicture(client, B, SHARE), false, "a failing remove returns false");
  await removePurgedPictures(client, [buildIncomingPicturePath(B, SHARE)]);
});
