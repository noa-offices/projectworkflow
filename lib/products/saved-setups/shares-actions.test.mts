/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake client and hostile input */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import sharp from "sharp";

const A = "11111111-1111-4111-8111-111111111111"; // sender
const B = "22222222-2222-4222-8222-222222222222"; // recipient
const C = "44444444-4444-4444-8444-444444444444";
const SHARE = "33333333-3333-4333-8333-333333333333";
const ITEM = "55555555-5555-4555-8555-555555555555";
const NEW_ITEM = "77777777-7777-4777-8777-777777777777";
const FOLDER = "66666666-6666-4666-8666-666666666666";

// ── Fake world, shared by the mocked auth / client modules ───────────────────────────────────────────────────
type Row = Record<string, any>;
type Rpc = (args: any) => { data: any; error: any } | Promise<{ data: any; error: any }>;
function makeWorld() {
  return {
    user: A,
    authMode: "ok" as "ok" | "redirect",
    tables: { my_collection_shares: [] as Row[], saved_custom_items: [] as Row[], saved_setups: [] as Row[] },
    files: new Map<string, { type: string; bytes: Uint8Array }>(),
    rpc: {} as Record<string, Rpc>,
    calls: [] as string[],
    rpcCalls: [] as Array<{ name: string; args: any }>,
    uploads: [] as Array<{ path: string; options: any }>,
    failDownload: false,
    failUpload: false,
    failRemove: false,
    adminCalls: 0,
    revalidated: [] as string[],
  };
}
let world = makeWorld();

function buildClient() {
  class Query {
    private filters: Array<[string, unknown]> = [];
    private limitN: number | undefined;
    private wantCount = false;
    constructor(private table: keyof ReturnType<typeof makeWorld>["tables"]) {}
    select(_columns: string, options?: { count?: string }) { this.wantCount = Boolean(options?.count); return this; }
    eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
    order() { return this; }
    limit(count: number) { this.limitN = count; return this; }
    private run() {
      world.calls.push(`select:${this.table}`);
      const rows = world.tables[this.table].filter((row) => this.filters.every(([column, value]) => row[column] === value));
      return { rows: this.limitN === 0 ? [] : rows, count: rows.length };
    }
    maybeSingle() { return Promise.resolve({ data: this.run().rows[0] ?? null, error: null }); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      const result = this.run();
      return Promise.resolve({ data: result.rows, count: this.wantCount ? result.count : null, error: null }).then(resolve, reject);
    }
  }
  return {
    rpc: async (name: string, args: any) => {
      world.calls.push(`rpc:${name}`);
      world.rpcCalls.push({ name, args });
      const handler = world.rpc[name];
      return handler ? handler(args) : { data: null, error: null };
    },
    from: (table: string) => new Query(table as any),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array, options: any) => {
          world.calls.push(`upload:${path}`);
          world.uploads.push({ path, options });
          if (world.failUpload) return { data: null, error: { message: "denied", statusCode: "403" } };
          world.files.set(`${bucket}/${path}`, { type: options?.contentType, bytes: body });
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          world.calls.push(`download:${path}`);
          const file = world.files.get(`${bucket}/${path}`);
          if (world.failDownload || !file) return { data: null, error: { message: "missing" } };
          return { data: new Blob([file.bytes as BlobPart], { type: file.type }), error: null };
        },
        remove: async (paths: string[]) => {
          world.calls.push(`remove:${paths.join(",")}`);
          if (world.failRemove) throw new Error("storage down");
          for (const path of paths) world.files.delete(`${bucket}/${path}`);
          return { data: [], error: null };
        },
      }),
    },
  };
}

mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => {
    world.calls.push("auth");
    if (world.authMode === "redirect") throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    return { user: { id: world.user }, profile: { role: "sales_designer" }, displayName: "Fixture" };
  },
} });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => buildClient() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => { world.adminCalls += 1; return { error: "no admin in tests", client: null }; } } });
mock.module("next/cache", { namedExports: { revalidatePath: (path: string) => { world.revalidated.push(path); } } });

const actions = await import("./shares-actions");
const { shareMessage, SHARE_MESSAGES, buildIncomingPicturePath } = await import("./shares");
const { isWebpBytes } = await import("./custom-item-image");

const webp = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "#336699" } }).webp().toBuffer());
const png = new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).png().toBuffer());
const ownPicture = `${A}/${FOLDER}/1700000000000-desk.png`;
const incoming = buildIncomingPicturePath(B, SHARE);

function reset(user = A) {
  world = makeWorld();
  world.user = user;
}
const customItemRow = (extra: Row = {}): Row => ({ id: ITEM, owner_id: A, brand_name: "Acme", item_name: "Desk", item_code: null, specification: null, unit_label: "Pc", selling_price: 1200, currency: "AED", price_saved_at: "2026-01-01", created_at: "2026-01-01", last_used_at: null, use_count: 0, image_path: ownPicture, ...extra });
const shareRow = (extra: Row = {}): Row => ({
  id: SHARE, kind: "custom_item", sender_id: A, recipient_id: B, sender_name: "Ada", item_name: "Desk", note: "hi",
  payload: { brand_name: "Acme", item_name: "Desk", item_code: "D-1", specification: "oak", unit_label: "Pc", selling_price: 1200, currency: "AED" },
  picture_path: incoming, picture_note: null, status: "pending", created_at: "2026-11-19T10:00:00Z", responded_at: null, result_item_id: null, ...extra,
});
const accept = (extra: Row = {}) => ({ shareId: SHARE, brand: "Acme", name: "Desk", code: "D-1", spec: "oak", unit: "Pc", price: "1200", currency: "AED", pictureMode: "keep", ...extra });

// ── Authentication and never-throw ───────────────────────────────────────────────────────────────────────────
test("every action calls requireActiveUser first, before any database or storage call", async () => {
  const runs: Array<[string, () => Promise<unknown>]> = [
    ["searchShareTargetsAction", () => actions.searchShareTargetsAction("be")],
    ["sendShareAction", () => actions.sendShareAction({ kind: "setup", itemId: ITEM, recipientId: B })],
    ["unsendShareAction", () => actions.unsendShareAction(SHARE)],
    ["dismissShareAction", () => actions.dismissShareAction(SHARE)],
    ["acceptCustomItemShareAction", () => actions.acceptCustomItemShareAction(accept())],
    ["acceptSetupShareAction", () => actions.acceptSetupShareAction({ shareId: SHARE, setupName: "x" })],
    ["listIncomingSharesAction", () => actions.listIncomingSharesAction()],
    ["listSentSharesAction", () => actions.listSentSharesAction()],
    ["pendingShareCountAction", () => actions.pendingShareCountAction()],
  ];
  for (const [name, run] of runs) {
    reset();
    await run();
    assert.equal(world.calls[0], "auth", `${name}: auth is the first call`);
    assert.equal(world.adminCalls, 0, `${name}: no admin client`);
  }
});

test("a sign-in redirect or any failure never throws to the browser: it becomes a plain message and nothing else runs", async () => {
  const runs: Array<[string, () => Promise<any>]> = [
    ["search", () => actions.searchShareTargetsAction("be")],
    ["send", () => actions.sendShareAction({ kind: "setup", itemId: ITEM, recipientId: B })],
    ["unsend", () => actions.unsendShareAction(SHARE)],
    ["dismiss", () => actions.dismissShareAction(SHARE)],
    ["acceptCustom", () => actions.acceptCustomItemShareAction(accept())],
    ["acceptSetup", () => actions.acceptSetupShareAction({ shareId: SHARE, setupName: "x" })],
    ["incoming", () => actions.listIncomingSharesAction()],
    ["sent", () => actions.listSentSharesAction()],
    ["count", () => actions.pendingShareCountAction()],
  ];
  for (const [name, run] of runs) {
    reset();
    world.authMode = "redirect";
    const result = await run();
    assert.deepEqual(result, { ok: false, message: SHARE_MESSAGES.not_allowed }, name);
    assert.deepEqual(world.calls, ["auth"], `${name}: nothing ran after the failed sign-in`);
  }
  // a throwing rpc is also turned into a message
  reset();
  world.rpc.my_collection_send_share = () => { throw new Error("socket hang up at /srv/app.js:1"); };
  const result = await actions.sendShareAction({ kind: "setup", itemId: ITEM, recipientId: B });
  assert.deepEqual(result, { ok: false, message: SHARE_MESSAGES.unknown });
});

// ── Send ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("send custom item with a picture: item read as the caller, send rpc, picture to the incoming path, attach(ok)", async () => {
  reset(A);
  world.tables.saved_custom_items.push(customItemRow());
  world.files.set(`my-collection-images/${ownPicture}`, { type: "image/png", bytes: png });
  world.rpc.my_collection_send_share = () => ({ data: SHARE, error: null });
  world.rpc.my_collection_attach_share_picture = () => ({ data: true, error: null });
  const result = await actions.sendShareAction({ kind: "custom_item", itemId: ITEM, recipientId: B, note: " please check " });
  assert.deepEqual(result, { ok: true, shareId: SHARE });
  assert.deepEqual(world.rpcCalls[0], { name: "my_collection_send_share", args: { p_kind: "custom_item", p_item_id: ITEM, p_recipient_id: B, p_note: "please check" } });
  assert.deepEqual(world.calls, ["auth", "select:saved_custom_items", "rpc:my_collection_send_share", `download:${ownPicture}`, `upload:${incoming}`, "rpc:my_collection_attach_share_picture"]);
  const stored = world.files.get(`my-collection-images/${incoming}`)!;
  assert.equal(stored.type, "image/webp");
  assert.ok(isWebpBytes(stored.bytes));
  assert.deepEqual(world.revalidated, ["/products/my-collection"]);
});

test("send: a picture failure still returns ok, with a pictureNote and attach(ok=false, note)", async () => {
  for (const [label, arrange, kind] of [
    ["download", () => { world.failDownload = true; }, "picture_unavailable"],
    ["upload", () => { world.failUpload = true; }, "picture_upload_failed"],
  ] as const) {
    reset(A);
    world.tables.saved_custom_items.push(customItemRow());
    world.files.set(`my-collection-images/${ownPicture}`, { type: "image/png", bytes: png });
    world.rpc.my_collection_send_share = () => ({ data: SHARE, error: null });
    world.rpc.my_collection_attach_share_picture = () => ({ data: false, error: null });
    arrange();
    const result = await actions.sendShareAction({ kind: "custom_item", itemId: ITEM, recipientId: B, note: null }) as any;
    assert.equal(result.ok, true, label);
    assert.equal(result.shareId, SHARE);
    assert.equal(result.pictureNote, shareMessage(kind), label);
    assert.deepEqual(world.rpcCalls.at(-1)!.args, { p_share_id: SHARE, p_ok: false, p_note: shareMessage(kind) }, label);
    assert.ok(!JSON.stringify(result).includes(A), "no id in the result");
  }
});

test("send: somebody else's item is 'not found' and nothing is sent; a setup needs no picture work; errors are friendly", async () => {
  reset(A);
  world.tables.saved_custom_items.push(customItemRow({ owner_id: C }));
  assert.deepEqual(await actions.sendShareAction({ kind: "custom_item", itemId: ITEM, recipientId: B }), { ok: false, message: shareMessage("item_not_found") });
  assert.equal(world.rpcCalls.length, 0);

  reset(A);
  world.rpc.my_collection_send_share = () => ({ data: SHARE, error: null });
  assert.deepEqual(await actions.sendShareAction({ kind: "setup", itemId: ITEM, recipientId: B }), { ok: true, shareId: SHARE });
  assert.ok(!world.calls.some((call) => /^(download|upload|remove):/.test(call)), "no storage call for a setup");
  assert.deepEqual(world.calls, ["auth", "rpc:my_collection_send_share"]);

  for (const [message, kind] of [
    ["Too many shares are waiting. Try again later.", "too_many"],
    ["This user cannot receive shares.", "cannot_receive"],
    ["This product is not available to the recipient.", "product_unavailable_recipient"],
    ["You cannot share with yourself.", "self"],
  ] as const) {
    reset(A);
    world.rpc.my_collection_send_share = () => ({ data: null, error: { message } });
    assert.deepEqual(await actions.sendShareAction({ kind: "setup", itemId: ITEM, recipientId: B }), { ok: false, message: shareMessage(kind) });
  }
  reset(A);
  world.rpc.my_collection_send_share = () => ({ data: null, error: { message: 'relation "secret" does not exist', code: "42P01" } });
  assert.deepEqual(await actions.sendShareAction({ kind: "setup", itemId: ITEM, recipientId: B }), { ok: false, message: SHARE_MESSAGES.unknown }, "raw database text never reaches the browser");
  // bad input never reaches the database
  reset(A);
  assert.equal((await actions.sendShareAction({ kind: "folder", itemId: ITEM, recipientId: B }) as any).ok, false);
  assert.equal((await actions.sendShareAction({ kind: "setup", itemId: ITEM, recipientId: B, note: "x".repeat(201) }) as any).message, shareMessage("note_too_long"));
  assert.equal(world.rpcCalls.length, 0);
});

// ── Unsend and dismiss ───────────────────────────────────────────────────────────────────────────────────────
test("unsend: rpc, then the incoming picture is removed best effort; a share that is not pending gives a friendly message", async () => {
  reset(A);
  world.tables.my_collection_shares.push(shareRow());
  world.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: webp });
  world.rpc.my_collection_unsend_share = () => ({ data: true, error: null });
  assert.deepEqual(await actions.unsendShareAction(SHARE), { ok: true });
  assert.deepEqual(world.rpcCalls[0], { name: "my_collection_unsend_share", args: { p_share_id: SHARE } });
  assert.equal(world.files.has(`my-collection-images/${incoming}`), false);
  assert.deepEqual(world.revalidated, ["/products/my-collection"]);

  reset(A);
  world.tables.my_collection_shares.push(shareRow({ picture_path: null }));
  world.rpc.my_collection_unsend_share = () => ({ data: false, error: null });
  assert.deepEqual(await actions.unsendShareAction(SHARE), { ok: false, message: shareMessage("no_longer_available") });
  assert.ok(!world.calls.some((call) => call.startsWith("remove:")));
  assert.deepEqual(await actions.unsendShareAction("not-a-uuid"), { ok: false, message: shareMessage("share_not_found") });

  // a failing file removal never fails the unsend
  reset(A);
  world.tables.my_collection_shares.push(shareRow());
  world.failRemove = true;
  world.rpc.my_collection_unsend_share = () => ({ data: true, error: null });
  assert.deepEqual(await actions.unsendShareAction(SHARE), { ok: true });
});

test("dismiss: rpc then best-effort delete of the recipient's incoming file", async () => {
  reset(B);
  world.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: webp });
  world.rpc.my_collection_dismiss_share = () => ({ data: true, error: null });
  assert.deepEqual(await actions.dismissShareAction(SHARE), { ok: true });
  assert.deepEqual(world.calls, ["auth", "rpc:my_collection_dismiss_share", `remove:${incoming}`]);
  assert.equal(world.files.has(`my-collection-images/${incoming}`), false);
  reset(B);
  world.rpc.my_collection_dismiss_share = () => ({ data: false, error: null });
  assert.deepEqual(await actions.dismissShareAction(SHARE), { ok: false, message: shareMessage("no_longer_available") });
  assert.ok(!world.calls.some((call) => call.startsWith("remove:")), "nothing removed when the dismiss did not happen");
});

// ── Accept: custom item ──────────────────────────────────────────────────────────────────────────────────────
test("accept custom item (keep): copies the incoming picture into the recipient's folder, calls the rpc with that path, removes the incoming file", async () => {
  reset(B);
  world.tables.my_collection_shares.push(shareRow());
  world.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: webp });
  world.rpc.my_collection_accept_custom_item = () => ({ data: NEW_ITEM, error: null });
  const result = await actions.acceptCustomItemShareAction(accept()) as any;
  assert.deepEqual(result, { ok: true, itemId: NEW_ITEM });
  const call = world.rpcCalls.at(-1)!;
  assert.equal(call.name, "my_collection_accept_custom_item");
  assert.match(call.args.p_image_path, new RegExp(`^${B}/${SHARE}/\\d+-picture\\.webp$`));
  assert.deepEqual({ ...call.args, p_image_path: "<path>" }, { p_share_id: SHARE, p_brand: "Acme", p_name: "Desk", p_code: "D-1", p_spec: "oak", p_unit: "Pc", p_price: 1200, p_currency: "AED", p_image_path: "<path>" });
  assert.ok(world.files.has(`my-collection-images/${call.args.p_image_path}`), "the recipient's own copy exists");
  assert.equal(world.files.has(`my-collection-images/${incoming}`), false, "the incoming file is removed after success");
  assert.deepEqual(world.revalidated, ["/products/my-collection"]);
});

test("accept custom item: the recipient's edits are validated first; their own brand spelling is reused; nothing runs on a bad edit", async () => {
  reset(B);
  world.tables.my_collection_shares.push(shareRow());
  const bad = await actions.acceptCustomItemShareAction(accept({ name: "", price: "-5", currency: "GBP" })) as any;
  assert.equal(bad.ok, false);
  assert.ok(bad.fieldErrors.itemName && bad.fieldErrors.sellingPrice && bad.fieldErrors.currency);
  assert.ok(!world.calls.some((call) => call.startsWith("rpc:") || call.startsWith("download:") || call.startsWith("upload:")), "no copy and no rpc");

  reset(B);
  world.tables.my_collection_shares.push(shareRow({ picture_path: null }));
  world.tables.saved_custom_items.push({ ...customItemRow({ id: C, owner_id: B, brand_name: "Acme Office", item_name: "Another desk", image_path: null }) });
  world.rpc.my_collection_accept_custom_item = () => ({ data: NEW_ITEM, error: null });
  await actions.acceptCustomItemShareAction(accept({ brand: "  acme   OFFICE ", price: "99.5", currency: "EUR", pictureMode: "keep" }));
  const args = world.rpcCalls.at(-1)!.args;
  assert.equal(args.p_brand, "Acme Office", "the recipient's own brand spelling");
  assert.equal(args.p_price, 99.5);
  assert.equal(args.p_currency, "EUR");
  assert.equal(args.p_image_path, null, "no picture on the share and nothing to copy");
  // anything outside the allowed fields in the input is ignored
  reset(B);
  world.tables.my_collection_shares.push(shareRow({ picture_path: null }));
  world.rpc.my_collection_accept_custom_item = () => ({ data: NEW_ITEM, error: null });
  await actions.acceptCustomItemShareAction({ ...accept(), owner_id: A, shared_by: C, status: "pending", payload: { price: 1 }, image_path: `${A}/x/y.webp` } as any);
  assert.deepEqual(Object.keys(world.rpcCalls.at(-1)!.args).sort(), ["p_brand", "p_code", "p_currency", "p_image_path", "p_name", "p_price", "p_share_id", "p_spec", "p_unit"]);
  assert.equal(world.rpcCalls.at(-1)!.args.p_image_path, null);
});

test("accept custom item: 'remove' saves without a picture; 'replace' uses the new browser-compressed file; a missing file is refused", async () => {
  reset(B);
  world.tables.my_collection_shares.push(shareRow());
  world.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: webp });
  world.rpc.my_collection_accept_custom_item = () => ({ data: NEW_ITEM, error: null });
  assert.equal((await actions.acceptCustomItemShareAction(accept({ pictureMode: "remove" })) as any).ok, true);
  assert.equal(world.rpcCalls.at(-1)!.args.p_image_path, null);
  assert.ok(!world.calls.some((call) => call.startsWith("download:")), "the sender's picture is not copied");
  assert.equal(world.files.has(`my-collection-images/${incoming}`), false, "the incoming file is still cleaned up");

  reset(B);
  world.tables.my_collection_shares.push(shareRow());
  world.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: webp });
  world.rpc.my_collection_accept_custom_item = () => ({ data: NEW_ITEM, error: null });
  const file = new File([webp as BlobPart], "My Photo.webp", { type: "image/webp" });
  const form = new FormData();
  for (const [key, value] of Object.entries(accept({ pictureMode: "replace" }))) form.set(key, String(value));
  form.set("file", file);
  assert.deepEqual(await actions.acceptCustomItemShareAction(form), { ok: true, itemId: NEW_ITEM }, "FormData works too");
  const path = world.rpcCalls.at(-1)!.args.p_image_path as string;
  assert.match(path, new RegExp(`^${B}/[0-9a-f-]{36}/\\d+-my-photo\\.webp$`), "uploaded under the recipient's own folder");
  assert.ok(!world.calls.some((call) => call === `download:${incoming}`), "the sender's picture is not copied when replaced");

  reset(B);
  world.tables.my_collection_shares.push(shareRow());
  assert.deepEqual(await actions.acceptCustomItemShareAction(accept({ pictureMode: "replace" })), { ok: false, message: shareMessage("picture_invalid") });
  const notWebp = new File([png as BlobPart], "a.png", { type: "image/png" });
  const refused = await actions.acceptCustomItemShareAction(accept({ pictureMode: "replace", file: notWebp })) as any;
  assert.equal(refused.ok, false);
  assert.match(refused.message, /rejected by the server/, "the 2 MB WebP rule applies to a replacement");
  assert.ok(!world.rpcCalls.some((entry) => entry.name === "my_collection_accept_custom_item"));
  assert.deepEqual(await actions.acceptCustomItemShareAction(accept({ pictureMode: "copy" })), { ok: false, message: shareMessage("invalid_request") });
});

test("accept custom item: if the rpc fails the copy that was made is removed again, and the reason is friendly", async () => {
  for (const mode of ["keep", "replace"] as const) {
    reset(B);
    world.tables.my_collection_shares.push(shareRow());
    world.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: webp });
    world.rpc.my_collection_accept_custom_item = () => ({ data: null, error: { message: "This share is no longer available." } });
    const before = new Set(world.files.keys());
    const file = new File([webp as BlobPart], "p.webp", { type: "image/webp" });
    const result = await actions.acceptCustomItemShareAction(accept({ pictureMode: mode, file: mode === "replace" ? file : undefined }));
    assert.deepEqual(result, { ok: false, message: shareMessage("no_longer_available") }, mode);
    assert.deepEqual(new Set(world.files.keys()), before, `${mode}: the new picture file is gone again`);
    assert.ok(world.files.has(`my-collection-images/${incoming}`), "the incoming file stays: the share is still there for another try");
    assert.deepEqual(world.revalidated, [], "no revalidate on failure");
  }
});

test("accept custom item: a failed picture copy stops with a clear reason and never calls the rpc", async () => {
  reset(B);
  world.tables.my_collection_shares.push(shareRow());
  world.files.set(`my-collection-images/${incoming}`, { type: "image/png", bytes: png }); // a renamed png is not accepted
  assert.deepEqual(await actions.acceptCustomItemShareAction(accept()), { ok: false, message: shareMessage("picture_invalid") });
  assert.equal(world.rpcCalls.length, 0);
  reset(B);
  world.tables.my_collection_shares.push(shareRow());
  assert.deepEqual(await actions.acceptCustomItemShareAction(accept()), { ok: false, message: shareMessage("picture_unavailable") }, "incoming file missing");
});

test("accept custom item: accepting twice is harmless (no picture work the second time; same id back); other states are refused", async () => {
  reset(B);
  world.tables.my_collection_shares.push(shareRow({ status: "accepted", responded_at: "2026-11-19T11:00:00Z", result_item_id: NEW_ITEM }));
  world.rpc.my_collection_accept_custom_item = () => ({ data: NEW_ITEM, error: null });
  assert.deepEqual(await actions.acceptCustomItemShareAction(accept()), { ok: true, itemId: NEW_ITEM });
  assert.ok(!world.calls.some((call) => /^(download|upload):/.test(call)), "no copy for an already accepted share");
  assert.equal(world.rpcCalls.at(-1)!.args.p_image_path, null);

  for (const status of ["dismissed", "unsent"]) {
    reset(B);
    world.tables.my_collection_shares.push(shareRow({ status, responded_at: "2026-11-19T11:00:00Z" }));
    assert.deepEqual(await actions.acceptCustomItemShareAction(accept()), { ok: false, message: shareMessage("no_longer_available") }, status);
    assert.equal(world.rpcCalls.length, 0);
  }
  reset(B);
  assert.deepEqual(await actions.acceptCustomItemShareAction(accept()), { ok: false, message: shareMessage("share_not_found") });
  reset(C);
  world.tables.my_collection_shares.push(shareRow());
  assert.deepEqual(await actions.acceptCustomItemShareAction(accept()), { ok: false, message: shareMessage("share_not_found") }, "only the recipient can load it");
});

test("accept custom item: two tabs at once - the loser's copy is deleted when the item uses a different picture", async () => {
  reset(B);
  world.tables.my_collection_shares.push(shareRow());
  world.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: webp });
  // the database says the item already exists with ANOTHER picture (the other tab won)
  world.tables.saved_custom_items.push({ id: NEW_ITEM, owner_id: B, image_path: `${B}/${SHARE}/1-winner.webp` });
  world.files.set(`my-collection-images/${B}/${SHARE}/1-winner.webp`, { type: "image/webp", bytes: webp });
  world.rpc.my_collection_accept_custom_item = () => ({ data: NEW_ITEM, error: null });
  assert.deepEqual(await actions.acceptCustomItemShareAction(accept()), { ok: true, itemId: NEW_ITEM });
  const copies = [...world.files.keys()].filter((key) => key.startsWith(`my-collection-images/${B}/${SHARE}/`));
  assert.deepEqual(copies, [`my-collection-images/${B}/${SHARE}/1-winner.webp`], "only the winner's picture remains");
});

// ── Accept: setup ────────────────────────────────────────────────────────────────────────────────────────────
test("accept setup: only name and note go to the rpc; errors such as an unavailable product are friendly", async () => {
  reset(B);
  world.rpc.my_collection_accept_setup = () => ({ data: NEW_ITEM, error: null });
  assert.deepEqual(await actions.acceptSetupShareAction({ shareId: SHARE, setupName: "  My setup ", note: " n " }), { ok: true, setupId: NEW_ITEM });
  assert.deepEqual(world.rpcCalls[0], { name: "my_collection_accept_setup", args: { p_share_id: SHARE, p_setup_name: "My setup", p_note: "n" } });
  assert.deepEqual(world.revalidated, ["/products/my-collection"]);
  const hostile = { shareId: SHARE, setupName: "ok", recipe: { x: 1 }, brand_name: "Evil", owner_id: A } as any;
  reset(B);
  world.rpc.my_collection_accept_setup = () => ({ data: NEW_ITEM, error: null });
  await actions.acceptSetupShareAction(hostile);
  assert.deepEqual(Object.keys(world.rpcCalls[0].args).sort(), ["p_note", "p_setup_name", "p_share_id"]);

  reset(B);
  world.rpc.my_collection_accept_setup = () => ({ data: null, error: { message: "This product is not available to you." } });
  assert.deepEqual(await actions.acceptSetupShareAction({ shareId: SHARE, setupName: "x" }), { ok: false, message: shareMessage("product_unavailable_you") });
  assert.equal((await actions.acceptSetupShareAction({ shareId: SHARE, setupName: "" }) as any).ok, false);
  assert.equal((await actions.acceptSetupShareAction({ shareId: "nope", setupName: "x" }) as any).message, shareMessage("share_not_found"));
});

// ── Lists, count and the lazy purge ──────────────────────────────────────────────────────────────────────────
test("list incoming / sent: the lazy purge runs first and its picture files are deleted; a purge failure never breaks the list", async () => {
  reset(B);
  world.tables.my_collection_shares.push(shareRow());
  world.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: webp });
  const oldIncoming = buildIncomingPicturePath(B, ITEM);
  world.files.set(`my-collection-images/${oldIncoming}`, { type: "image/webp", bytes: webp });
  world.rpc.my_collection_purge_finished_shares = () => ({ data: [{ picture_path: oldIncoming }], error: null });
  const result = await actions.listIncomingSharesAction() as any;
  assert.equal(result.ok, true);
  assert.deepEqual(result.shares.map((share: any) => share.id), [SHARE]);
  assert.deepEqual(world.calls.slice(0, 4), ["auth", "rpc:my_collection_purge_finished_shares", `remove:${oldIncoming}`, "select:my_collection_shares"], "purge, delete its files, then list");
  assert.equal(world.files.has(`my-collection-images/${oldIncoming}`), false);
  assert.ok(world.files.has(`my-collection-images/${incoming}`), "files of live shares are kept");

  for (const mode of ["error", "throw", "remove-throws"]) {
    reset(B);
    world.tables.my_collection_shares.push(shareRow());
    world.rpc.my_collection_purge_finished_shares = mode === "error"
      ? () => ({ data: null, error: { message: "boom", code: "XX000" } })
      : mode === "throw" ? () => { throw new Error("down"); }
      : () => ({ data: [{ picture_path: buildIncomingPicturePath(B, ITEM) }], error: null });
    if (mode === "remove-throws") world.failRemove = true;
    assert.equal((await actions.listIncomingSharesAction() as any).ok, true, mode);
  }

  reset(A);
  world.tables.my_collection_shares.push(shareRow());
  world.rpc.my_collection_purge_finished_shares = () => ({ data: [], error: null });
  const sent = await actions.listSentSharesAction() as any;
  assert.equal(sent.ok, true);
  assert.equal(sent.shares.length, 1);
  assert.deepEqual(world.calls.slice(0, 3), ["auth", "rpc:my_collection_purge_finished_shares", "select:my_collection_shares"]);
  assert.ok(!JSON.stringify(sent).includes("1200"), "a sender's list carries no price");
});

test("incoming list never carries a setup's recipe; pending count is a cheap count; search returns names only", async () => {
  reset(B);
  world.tables.my_collection_shares.push(shareRow({ id: ITEM, kind: "setup", payload: { recipe: { secret: "RECIPE" }, spec_overrides: { s: "SPEC" }, setup_name: "Every white", brand_name: "I", product_name: "Every" } }));
  const list = await actions.listIncomingSharesAction() as any;
  assert.ok(!JSON.stringify(list).includes("RECIPE") && !JSON.stringify(list).includes("SPEC"));

  assert.deepEqual(await actions.pendingShareCountAction(), { ok: true, count: 1 });
  reset(C);
  assert.deepEqual(await actions.pendingShareCountAction(), { ok: true, count: 0 });

  reset(A);
  world.rpc.my_collection_share_targets = () => ({ data: [{ id: B, display_name: "Bea" }], error: null });
  assert.deepEqual(await actions.searchShareTargetsAction("be"), { ok: true, targets: [{ id: B, displayName: "Bea" }] });
  assert.deepEqual(await actions.searchShareTargetsAction("b"), { ok: true, targets: [] });
});

test("no action ever touched the admin client", async () => {
  assert.equal(world.adminCalls, 0);
});

// ── PR 7: duplicate warning when accepting a share ───────────────────────────────────────────────────────────
const SETUP_TEMPLATE = "88888888-8888-4888-8888-888888888888";
const sharedRecipe = { recipe_version: 1, template_id: SETUP_TEMPLATE, selections: { variant_row_id: "v1", modular_quantities: { m: 2 } }, finishes: [], display: { main_code: "EV211" }, selected_image: "x.png" };
const setupShareRow = (extra: Row = {}): Row => shareRow({ kind: "setup", item_name: "Every white", picture_path: null, payload: { recipe: sharedRecipe, spec_overrides: {}, setup_name: "Every white", brand_name: "Interstuhl", product_name: "Every" }, ...extra });
const ownSetupRow = (extra: Row = {}): Row => ({ id: C, owner_id: B, template_id: SETUP_TEMPLATE, brand_name: "Interstuhl", product_name: "Every", setup_name: "My Every", recipe: { selections: { modular_quantities: { m: 2 }, variant_row_id: "v1" }, template_id: SETUP_TEMPLATE, recipe_version: 1, finishes: [], display: { main_code: "OTHER" }, selected_image: null }, spec_overrides: {}, archived: false, created_at: "2026-05-01T00:00:00Z", ...extra });

test("accept custom item: an equal item already in the recipient's collection -> warning, NO copy and NO write; 'Add anyway' writes once", async () => {
  reset(B);
  world.tables.my_collection_shares.push(shareRow());
  world.tables.saved_custom_items.push(customItemRow({ id: C, owner_id: B, brand_name: "ACME", item_name: "desk", selling_price: 1200, currency: "AED", image_path: null }));
  world.files.set(`my-collection-images/${incoming}`, { type: "image/webp", bytes: webp });
  world.rpc.my_collection_accept_custom_item = () => ({ data: NEW_ITEM, error: null });
  const first = await actions.acceptCustomItemShareAction(accept()) as any;
  assert.equal(first.ok, false);
  assert.equal(first.duplicate.id, C);
  assert.equal(first.duplicate.samePrice, true);
  assert.equal(first.message, "You already have desk (ACME).");
  assert.equal(world.rpcCalls.length, 0, "no write");
  assert.ok(!world.calls.some((call) => /^(download|upload):/.test(call)), "no picture copy");
  assert.deepEqual(world.revalidated, []);
  assert.ok(!JSON.stringify(first).includes("recipe"));

  const confirmed = await actions.acceptCustomItemShareAction({ ...accept(), allowDuplicate: true });
  assert.deepEqual(confirmed, { ok: true, itemId: NEW_ITEM });
  assert.equal(world.rpcCalls.filter((entry) => entry.name === "my_collection_accept_custom_item").length, 1, "written exactly once");

  // the flag also works as FormData text, and it never skips validation
  reset(B);
  world.tables.my_collection_shares.push(shareRow({ picture_path: null }));
  world.tables.saved_custom_items.push(customItemRow({ id: C, owner_id: B, brand_name: "Acme", item_name: "Desk", image_path: null }));
  const form = new FormData();
  for (const [key, value] of Object.entries(accept({ name: "", pictureMode: "remove" }))) form.set(key, String(value));
  form.set("allowDuplicate", "true");
  const invalid = await actions.acceptCustomItemShareAction(form) as any;
  assert.equal(invalid.ok, false);
  assert.ok(invalid.fieldErrors.itemName, "validation still runs with the flag");
  assert.equal(world.rpcCalls.length, 0);
});

test("accept custom item: the EDITED brand and name are compared; same name at a different price says so; another brand is no duplicate", async () => {
  reset(B);
  world.tables.my_collection_shares.push(shareRow({ picture_path: null }));
  world.tables.saved_custom_items.push(customItemRow({ id: C, owner_id: B, brand_name: "My Brand", item_name: "Table", selling_price: 99, currency: "EUR", image_path: null }));
  world.rpc.my_collection_accept_custom_item = () => ({ data: NEW_ITEM, error: null });
  const hit = await actions.acceptCustomItemShareAction(accept({ brand: "my-brand", name: "TABLE", pictureMode: "remove" })) as any;
  assert.equal(hit.ok, false);
  assert.equal(hit.duplicate.samePrice, false);
  assert.deepEqual(hit.duplicate.existingPrice, { currency: "EUR", amount: 99 });
  assert.equal(world.rpcCalls.length, 0);
  const miss = await actions.acceptCustomItemShareAction(accept({ brand: "Other Brand", name: "Table", pictureMode: "remove" }));
  assert.deepEqual(miss, { ok: true, itemId: NEW_ITEM });
  // another user's equal item is never looked at
  reset(B);
  world.tables.my_collection_shares.push(shareRow({ picture_path: null }));
  world.tables.saved_custom_items.push(customItemRow({ id: C, owner_id: A, brand_name: "Acme", item_name: "Desk", image_path: null }));
  world.rpc.my_collection_accept_custom_item = () => ({ data: NEW_ITEM, error: null });
  assert.equal((await actions.acceptCustomItemShareAction(accept({ pictureMode: "remove" })) as any).ok, true);
});

test("accept setup: the same recipe (keys reordered, display ignored) already owned -> warning, NO write; 'Add anyway' writes; a different one is fine", async () => {
  reset(B);
  world.tables.my_collection_shares.push(setupShareRow());
  world.tables.saved_setups.push(ownSetupRow());
  world.rpc.my_collection_accept_setup = () => ({ data: NEW_ITEM, error: null });
  const first = await actions.acceptSetupShareAction({ shareId: SHARE, setupName: "Every white" }) as any;
  assert.equal(first.ok, false);
  assert.equal(first.duplicate.id, C);
  assert.equal(first.duplicate.kind, "setup");
  assert.equal(first.message, "You already have My Every (Interstuhl).");
  assert.equal(world.rpcCalls.length, 0);
  assert.ok(!JSON.stringify(first).includes("modular_quantities"), "the recipe never goes to the browser");
  assert.deepEqual(await actions.acceptSetupShareAction({ shareId: SHARE, setupName: "Every white", allowDuplicate: true }), { ok: true, setupId: NEW_ITEM });
  assert.equal(world.rpcCalls.length, 1);

  for (const [label, row] of [["one selection differs", ownSetupRow({ recipe: { ...ownSetupRow().recipe, selections: { variant_row_id: "v2", modular_quantities: { m: 2 } } } })], ["archived", ownSetupRow({ archived: true })], ["another template", ownSetupRow({ template_id: A })]] as const) {
    reset(B);
    world.tables.my_collection_shares.push(setupShareRow());
    world.tables.saved_setups.push(row);
    world.rpc.my_collection_accept_setup = () => ({ data: NEW_ITEM, error: null });
    assert.equal((await actions.acceptSetupShareAction({ shareId: SHARE, setupName: "Every white" }) as any).ok, true, label);
  }
});

test("accept: 'Skip' is the existing dismiss action; a duplicate lookup problem never blocks the accept", async () => {
  reset(B);
  world.rpc.my_collection_dismiss_share = () => ({ data: true, error: null });
  assert.deepEqual(await actions.dismissShareAction(SHARE), { ok: true });
  // setup share row missing or unreadable: no warning, the database still decides
  reset(B);
  world.rpc.my_collection_accept_setup = () => ({ data: NEW_ITEM, error: null });
  assert.deepEqual(await actions.acceptSetupShareAction({ shareId: SHARE, setupName: "x" }), { ok: true, setupId: NEW_ITEM });
});
