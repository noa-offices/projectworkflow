/* eslint-disable @typescript-eslint/no-explicit-any -- hostile input and small fixtures */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SHARE_MESSAGES,
  SHARE_NOTE_MAX,
  buildAcceptedPicturePath,
  buildIncomingPicturePath,
  isIncomingPicturePath,
  mapShareError,
  parsePictureMode,
  shareMessage,
  toIncomingShare,
  toSentShare,
  validateAcceptCustomItem,
  validateAcceptSetup,
  validateSendInput,
  validateShareNote,
  type ShareMessageKind,
} from "./shares";
import { isOwnImagePath } from "./custom-item-image";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SHARE = "33333333-3333-4333-8333-333333333333";
const good = { brandName: "Acme", itemName: "Desk", sellingPrice: "100", currency: "AED" };

// ── Note ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("note: trimmed, empty means none, at most 200 characters, text only", () => {
  assert.deepEqual(validateShareNote(undefined), { ok: true, note: null });
  assert.deepEqual(validateShareNote("   "), { ok: true, note: null });
  assert.deepEqual(validateShareNote("  Please check the finish  "), { ok: true, note: "Please check the finish" });
  assert.equal((validateShareNote("x".repeat(SHARE_NOTE_MAX)) as any).ok, true);
  assert.deepEqual(validateShareNote("x".repeat(SHARE_NOTE_MAX + 1)), { ok: false, kind: "note_too_long" });
  assert.deepEqual(validateShareNote(12), { ok: false, kind: "invalid_request" });
  assert.equal(SHARE_NOTE_MAX, 200);
  // a note is never interpreted: markup stays as plain characters
  assert.deepEqual(validateShareNote("<b>hi</b>"), { ok: true, note: "<b>hi</b>" });
});

// ── Send input ───────────────────────────────────────────────────────────────────────────────────────────────
test("send input: kind, both ids and the note are checked", () => {
  assert.deepEqual(validateSendInput({ kind: "custom_item", itemId: A, recipientId: B, note: " hi " }), { ok: true, value: { kind: "custom_item", itemId: A, recipientId: B, note: "hi" } });
  assert.equal((validateSendInput({ kind: "setup", itemId: A, recipientId: B }) as any).value.note, null);
  assert.deepEqual(validateSendInput({ kind: "folder", itemId: A, recipientId: B }), { ok: false, kind: "invalid_request" });
  assert.deepEqual(validateSendInput({ kind: "setup", itemId: "nope", recipientId: B }), { ok: false, kind: "item_not_found" });
  assert.deepEqual(validateSendInput({ kind: "setup", itemId: A, recipientId: "../x" }), { ok: false, kind: "cannot_receive" });
  assert.deepEqual(validateSendInput({ kind: "setup", itemId: A, recipientId: B, note: "x".repeat(201) }), { ok: false, kind: "note_too_long" });
  assert.deepEqual(validateSendInput(null), { ok: false, kind: "invalid_request" });
  // owner, status and payload are never part of the input
  const extra = validateSendInput({ kind: "setup", itemId: A, recipientId: B, sender_id: B, payload: { price: 1 } } as any) as any;
  assert.deepEqual(Object.keys(extra.value).sort(), ["itemId", "kind", "note", "recipientId"]);
});

// ── Accept: custom item (same validators and limits as the form) ─────────────────────────────────────────────
test("accept custom item: reuses the form validators and limits", () => {
  const ok = validateAcceptCustomItem({ ...good, itemCode: " C-1 ", specification: "x", unitLabel: "Set", sellingPrice: "1200.50" }, []) as any;
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { brand_name: "Acme", item_name: "Desk", item_code: "C-1", specification: "x", unit_label: "Set", selling_price: 1200.5, currency: "AED" });
  const bad = (patch: object) => validateAcceptCustomItem({ ...good, ...patch }, []) as any;
  assert.equal(bad({ brandName: "x".repeat(81) }).ok, false, "brand <= 80");
  assert.equal(bad({ brandName: "x".repeat(80) }).ok, true);
  assert.equal(bad({ itemName: "x".repeat(121) }).ok, false, "name <= 120");
  assert.equal(bad({ itemCode: "x".repeat(61) }).ok, false, "code <= 60");
  assert.equal(bad({ specification: "x".repeat(4001) }).ok, false, "specification <= 4000");
  assert.equal(bad({ unitLabel: "x".repeat(21) }).ok, false, "unit <= 20");
  assert.equal(bad({ sellingPrice: "-1" }).ok, false, "price >= 0");
  assert.equal(bad({ sellingPrice: "0" }).ok, true);
  assert.equal(bad({ sellingPrice: "1.234" }).ok, false, "2 decimals");
  assert.equal(bad({ sellingPrice: "1000000000" }).ok, false);
  assert.equal(bad({ currency: "GBP" }).ok, false, "AED / EUR / USD only");
  assert.equal(bad({ brandName: "" }).ok, false, "a brand is required");
  assert.ok(bad({ itemName: "" }).fieldErrors.itemName);
  for (const currency of ["AED", "EUR", "USD"]) assert.equal(bad({ currency }).ok, true, currency);
});

test("accept custom item: the recipient's own brand spelling is reused; a new brand is kept as typed", () => {
  const brands = [{ brandName: "Acme Office", count: 3 }];
  assert.equal((validateAcceptCustomItem({ ...good, brandName: "  acme   OFFICE " }, brands) as any).value.brand_name, "Acme Office");
  assert.equal((validateAcceptCustomItem({ ...good, brandName: "Sender Brand" }, brands) as any).value.brand_name, "Sender Brand");
  // nothing outside the allowed fields can come out of the validator
  const out = validateAcceptCustomItem({ ...good, owner_id: B, shared_by: B, source_item_id: A, image_path: `${B}/x/y.webp` } as any, []) as any;
  assert.deepEqual(Object.keys(out.value).sort(), ["brand_name", "currency", "item_code", "item_name", "selling_price", "specification", "unit_label"]);
});

test("accept setup: only the name (1..120) and note (<= 500) can be edited", () => {
  assert.deepEqual(validateAcceptSetup({ setupName: "  My setup ", note: " n " }), { ok: true, setupName: "My setup", note: "n" });
  assert.deepEqual(validateAcceptSetup({ setupName: "A" }), { ok: true, setupName: "A", note: null });
  assert.equal(validateAcceptSetup({ setupName: "" }).ok, false);
  assert.equal(validateAcceptSetup({ setupName: "   " }).ok, false);
  assert.equal(validateAcceptSetup({ setupName: "x".repeat(121) }).ok, false);
  assert.equal(validateAcceptSetup({ setupName: "x".repeat(120) }).ok, true);
  assert.equal(validateAcceptSetup({ setupName: "ok", note: "x".repeat(501) }).ok, false);
  assert.equal(validateAcceptSetup({ setupName: "ok", note: "x".repeat(500) }).ok, true);
  assert.equal(validateAcceptSetup({ setupName: "ok", note: 5 as any }).ok, false);
  assert.equal(validateAcceptSetup(null).ok, false);
  const out = validateAcceptSetup({ setupName: "ok", recipe: { a: 1 }, brand_name: "X", owner_id: B } as any) as any;
  assert.deepEqual(Object.keys(out).sort(), ["note", "ok", "setupName"]);
});

test("picture mode: keep (default), remove or replace; anything else is refused", () => {
  assert.equal(parsePictureMode(undefined), "keep");
  assert.equal(parsePictureMode(""), "keep");
  for (const mode of ["keep", "remove", "replace"]) assert.equal(parsePictureMode(mode), mode);
  assert.equal(parsePictureMode("copy"), null);
  assert.equal(parsePictureMode(1), null);
});

// ── Picture paths ────────────────────────────────────────────────────────────────────────────────────────────
test("picture paths: incoming path is the one fixed file; the accepted copy is a normal own picture path", () => {
  assert.equal(buildIncomingPicturePath(B, SHARE), `${B}/incoming/${SHARE}/picture.webp`);
  assert.equal(isIncomingPicturePath(`${B}/incoming/${SHARE}/picture.webp`), true);
  assert.equal(isIncomingPicturePath(`${B}/incoming/${SHARE}/picture.webp`, B, SHARE), true);
  assert.equal(isIncomingPicturePath(`${B}/incoming/${SHARE}/picture.webp`, A, SHARE), false, "another recipient");
  assert.equal(isIncomingPicturePath(`${B}/incoming/${A}/picture.webp`, B, SHARE), false, "another share");
  for (const bad of [`${B}/incoming/${SHARE}/other.webp`, `${B}/incoming/${SHARE}/../picture.webp`, `${B}/x/${SHARE}/picture.webp`, `${B}/incoming/${SHARE}`, `${B}/incoming/not-a-uuid/picture.webp`, "", null, 5]) {
    assert.equal(isIncomingPicturePath(bad), false, String(bad));
  }
  assert.throws(() => buildIncomingPicturePath("../x", SHARE));
  const accepted = buildAcceptedPicturePath(B, SHARE, 1700000000000);
  assert.equal(accepted, `${B}/${SHARE}/1700000000000-picture.webp`);
  assert.equal(isOwnImagePath(B, accepted), true, "usable as a normal picture of the recipient");
  assert.equal(isOwnImagePath(A, accepted), false);
});

// ── Messages ─────────────────────────────────────────────────────────────────────────────────────────────────
test("DB error sentences from the sharing functions map to friendly messages", () => {
  const cases: Array<[string, ShareMessageKind]> = [
    ["Not allowed.", "not_allowed"],
    ["You cannot share with yourself.", "self"],
    ["Unknown item type.", "invalid_request"],
    ["The note is too long.", "note_too_long"],
    ["This user cannot receive shares.", "cannot_receive"],
    ["Too many shares are waiting. Try again later.", "too_many"],
    ["Item not found.", "item_not_found"],
    ["A setup with prices cannot be shared.", "setup_has_prices"],
    ["This product is not available to the recipient.", "product_unavailable_recipient"],
    ["Share not found.", "share_not_found"],
    ["This share is no longer available.", "no_longer_available"],
    ["This product is not available to you.", "product_unavailable_you"],
    ["Invalid picture.", "picture_invalid"],
  ];
  for (const [message, kind] of cases) assert.equal(mapShareError({ message }), kind, message);
  assert.equal(mapShareError({ code: "23505", message: "duplicate key value violates unique constraint" }), "already_pending");
  assert.equal(mapShareError({ code: "42501", message: "permission denied for table x" }), "not_allowed");
  assert.equal(mapShareError({ code: "23514", message: "violates check constraint" }), "invalid_request");
  assert.equal(mapShareError({ message: "relation \"secret_table\" does not exist" }), "unknown");
  assert.equal(mapShareError(null), "unknown");
  assert.equal(mapShareError("boom"), "unknown");
});

test("messages: one map, plain English, and they never carry a path, an id, a price or database text", () => {
  const kinds = Object.keys(SHARE_MESSAGES) as ShareMessageKind[];
  assert.ok(kinds.length >= 18);
  for (const kind of kinds) {
    const text = shareMessage(kind);
    assert.ok(text.length > 8 && /[.]$/.test(text), `${kind}: ${text}`);
    assert.ok(!/[/{}\\]|[0-9a-f]{8}-[0-9a-f]{4}|\bselect\b|\binsert\b|\bsql\b|\bAED\b|\bpgrst|violates|constraint|relation/i.test(text), `${kind}: ${text}`);
  }
  // the four reasons named in the brief
  assert.match(SHARE_MESSAGES.too_many, /Too many shares are waiting/);
  assert.match(SHARE_MESSAGES.cannot_receive, /This user cannot receive shares/);
  assert.match(SHARE_MESSAGES.product_unavailable_recipient, /This product is not available/);
  assert.match(SHARE_MESSAGES.no_longer_available, /no longer available/);
});

// ── What the browser gets ────────────────────────────────────────────────────────────────────────────────────
test("incoming share: custom item keeps price and fields; a setup's recipe and overrides never reach the browser", () => {
  const custom = toIncomingShare({
    id: SHARE, kind: "custom_item", sender_id: A, recipient_id: B, sender_name: "Ada", item_name: "Desk", note: "hi",
    payload: { brand_name: "Acme", item_name: "Desk", item_code: "D-1", specification: "oak", unit_label: "Pc", selling_price: 1200, currency: "AED" },
    picture_path: `${B}/incoming/${SHARE}/picture.webp`, picture_note: null, status: "pending", created_at: "2026-11-19T10:00:00Z", responded_at: null, result_item_id: null,
  })!;
  assert.deepEqual(custom.item, { kind: "custom_item", brandName: "Acme", itemName: "Desk", itemCode: "D-1", specification: "oak", unitLabel: "Pc", sellingPrice: 1200, currency: "AED" });
  assert.equal(custom.senderName, "Ada");
  const setup = toIncomingShare({
    id: SHARE, kind: "setup", sender_id: A, recipient_id: B, sender_name: "Ada", item_name: "Every white", note: null,
    payload: { recipe: { template_id: A, secret: "RECIPE" }, spec_overrides: { x: "SPEC" }, setup_name: "Every white", note: "n", brand_name: "Interstuhl", product_name: "Every" },
    picture_path: null, picture_note: null, status: "pending", created_at: "2026-11-19T10:00:00Z", responded_at: null, result_item_id: null,
  })!;
  assert.deepEqual(setup.item, { kind: "setup", setupName: "Every white", note: "n", brandName: "Interstuhl", productName: "Every" });
  const serialised = JSON.stringify(setup);
  assert.ok(!serialised.includes("RECIPE") && !serialised.includes("SPEC") && !serialised.includes("recipe"));
  assert.equal(toIncomingShare({ ...({} as any), kind: "weird", status: "pending" }), null);
  assert.equal(toIncomingShare(null), null);
});

test("sent share: no payload, no price; only names, status, dates and whether a picture is attached", () => {
  const sent = toSentShare({ id: SHARE, kind: "custom_item", recipient_id: B, item_name: "Desk", note: null, picture_path: `${B}/incoming/${SHARE}/picture.webp`, picture_note: null, status: "unsent", created_at: "2026-11-19T10:00:00Z", responded_at: "2026-11-19T11:00:00Z", result_item_id: null, payload: { selling_price: 5 } } as any)!;
  assert.deepEqual(Object.keys(sent).sort(), ["createdAt", "hasPicture", "id", "itemName", "kind", "note", "pictureNote", "recipientId", "respondedAt", "status"]);
  assert.equal(sent.hasPicture, true);
  assert.ok(!JSON.stringify(sent).includes("selling_price"));
});

// ── Source-text guards over all new files ────────────────────────────────────────────────────────────────────
const NEW_FILES = ["./shares.ts", "./shares-service.ts", "./shares-picture.ts", "./shares-actions.ts"];

test("no admin client or service role in any new file; the sharing table is only read, never written directly", () => {
  for (const file of NEW_FILES) {
    const source = read(file);
    assert.ok(!/createAdminClient|service[_-]?role|supabase\/admin|SUPABASE_SERVICE/i.test(source), `${file}: no admin client`);
  }
  const service = read("./shares-service.ts");
  assert.doesNotMatch(service, /\.(insert|update|upsert|delete)\(/, "the table is changed only through the database functions");
  assert.equal((service.match(/\.rpc\("my_collection_/g) ?? []).length, 8, "all 8 functions are called through rpc");
  for (const fn of ["share_targets", "send_share", "attach_share_picture", "unsend_share", "dismiss_share", "accept_custom_item", "accept_setup", "purge_finished_shares"]) {
    assert.ok(service.includes(`"my_collection_${fn}"`), fn);
  }
  assert.match(service, /from "@supabase\/supabase-js"/);
  assert.doesNotMatch(service, /from "@\/lib\/supabase\//);
});

test("the use-server file exports only async functions (and types), and every action authenticates first", () => {
  const actions = read("./shares-actions.ts");
  assert.match(actions, /^"use server";/);
  const exports = actions.match(/^export .*$/gm) ?? [];
  assert.ok(exports.length >= 9);
  for (const line of exports) assert.ok(/^export (async function \w+|type \w+)/.test(line), `only async functions and types: ${line}`);
  const names = Array.from(actions.matchAll(/^export async function (\w+)/gm)).map((match) => match[1]);
  assert.deepEqual(names.sort(), ["acceptCustomItemShareAction", "acceptSetupShareAction", "dismissShareAction", "listIncomingSharesAction", "listSentSharesAction", "pendingShareCountAction", "searchShareTargetsAction", "sendShareAction", "unsendShareAction"]);
  for (const name of names) {
    const start = actions.indexOf(`export async function ${name}`);
    const next = actions.indexOf("\nexport async function ", start + 10);
    const body = actions.slice(start, next === -1 ? undefined : next);
    assert.match(body, /await requireActiveUser\(\)/, `${name} calls requireActiveUser`);
    // it is the first awaited call inside the try block
    const firstAwait = body.indexOf("await ");
    assert.equal(firstAwait, body.indexOf("await requireActiveUser()"), `${name}: requireActiveUser is the first await`);
    assert.match(body, /try \{[\s\S]*\} catch \(problem\)/, `${name} never throws to the browser`);
  }
  assert.match(actions, /from "@\/lib\/supabase\/server"/);
  assert.match(actions, /NEXT_REDIRECT/);
});

test("nothing logs a payload, a price or raw database text", () => {
  for (const file of NEW_FILES) {
    const logs = read(file).match(/console\.\w+\([^;]*;/g) ?? [];
    for (const line of logs) assert.ok(!/payload|price|selling|message|\.error\b|recipe/i.test(line.replace(/^console\.error\(("[^"]*"|`[^`]*`),?/, "")), `${file}: ${line}`);
  }
});
