/* eslint-disable @typescript-eslint/no-explicit-any -- source-text checks, small fixtures and a mocked client */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const B = "22222222-2222-4222-8222-222222222222";
const A = "11111111-1111-4111-8111-111111111111";
const SHARE = "33333333-3333-4333-8333-333333333333";
const SHARE2 = "44444444-4444-4444-8444-444444444444";

// ── Mocked server modules for the two action checks ──────────────────────────────────────────────────────────
const world = {
  shares: [] as Array<Record<string, any>>,
  signed: [] as Array<{ paths: string[]; seconds: number }>,
  signFails: false,
  adminCalls: 0,
};
mock.module("@/lib/auth", { namedExports: { requireActiveUser: async () => ({ user: { id: B }, profile: { role: "sales_designer" }, displayName: "Bea" }) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => { world.adminCalls += 1; return { error: "none", client: null }; } } });
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  rpc: async () => ({ data: [], error: null }),
  from: () => {
    const filters: Array<[string, unknown]> = [];
    const query: any = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
      order: () => query,
      limit: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: world.shares.filter((row) => filters.every(([column, value]) => row[column] === value)), error: null }).then(resolve),
    };
    return query;
  },
  storage: { from: () => ({
    createSignedUrls: async (paths: string[], seconds: number) => {
      world.signed.push({ paths, seconds });
      if (world.signFails) throw new Error("signing down");
      return { data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${encodeURIComponent(path)}?token=t` })), error: null };
    },
    remove: async () => ({ data: [], error: null }),
  }) },
}) } });

const actions = await import("./shares-actions");
const shares = await import("./shares");

const incomingPath = (shareId: string) => `${B}/incoming/${shareId}/picture.webp`;
const incomingRow = (id: string, extra: Record<string, any> = {}) => ({
  id, kind: "custom_item", sender_id: A, recipient_id: B, sender_name: "Ada", item_name: "Desk", note: null,
  payload: { brand_name: "Acme", item_name: "Desk", item_code: null, specification: null, unit_label: "Pc", selling_price: 1200, currency: "AED" },
  picture_path: incomingPath(id), picture_note: null, status: "pending", created_at: "2026-11-19T10:00:00Z", responded_at: null, result_item_id: null, ...extra,
});

// ── ?tab= ────────────────────────────────────────────────────────────────────────────────────────────────────
test("?tab= picks the first tab: the four known values, anything else is configured", () => {
  for (const tab of ["configured", "custom", "shared", "sent"]) assert.equal(shares.parseCollectionTab(tab), tab);
  for (const bad of [undefined, null, "", "Shared", "settings", "../x", 3, ["bogus"], {}]) assert.equal(shares.parseCollectionTab(bad), "configured", String(bad));
  assert.equal(shares.parseCollectionTab(["sent", "custom"]), "sent", "a repeated parameter uses the first value");
});

test("page reads searchParams (a Promise in this Next.js) and hands the first tab and the pending count to the tabs", () => {
  const page = read("../../../app/products/my-collection/page.tsx");
  assert.match(page, /searchParams: Promise<\{ \[key: string\]: string \| string\[\] \| undefined \}>/);
  assert.match(page, /parseCollectionTab\(params\.tab\)/);
  assert.match(page, /countPendingIncoming\(supabase, user\.id\)/);
  assert.match(page, /<MyCollectionTabs items=\{items\} customItems=\{customItems\} initialTab=\{initialTab\} pendingShares=\{pending\.ok \? pending\.count : 0\} \/>/);
  const tabs = read("../../../components/products/my-collection-tabs.tsx");
  assert.match(tabs, /useState<CollectionTab>\(initialTab\)/);
  for (const text of ["Configured products", "Custom items", "Sent", "sharedTabLabel(pending)"]) assert.ok(tabs.includes(text), text);
  assert.match(tabs, /pending > 0 \|\| tab === "shared" \? \(/, "the Shared tab is hidden when nothing is waiting");
  assert.match(tabs, /<MyCollectionList items=\{items\} \/>/, "the Configured list is unchanged");
});

// ── Pure display helpers ─────────────────────────────────────────────────────────────────────────────────────
test("tab label, recipient name fallback, status chips and who can unsend", () => {
  assert.equal(shares.sharedTabLabel(3), "Shared with you (3)");
  assert.equal(shares.sharedTabLabel(0), "Shared with you");
  assert.equal(shares.recipientDisplayName(null), "Colleague");
  assert.equal(shares.recipientDisplayName(undefined), "Colleague");
  assert.equal(shares.recipientDisplayName("   "), "Colleague");
  assert.equal(shares.recipientDisplayName(" Bea "), "Bea");
  assert.deepEqual((["pending", "accepted", "dismissed", "unsent"] as const).map(shares.sentStatusLabel), ["Waiting", "Added", "Dismissed", "Withdrawn"]);
  assert.deepEqual((["pending", "accepted", "dismissed", "unsent"] as const).map(shares.canUnsend), [true, false, false, false]);
});

test("price notice: custom items say the price and picture are shared; setups say prices are not shared", () => {
  assert.equal(shares.sharePriceNotice("custom_item", { currency: "AED", sellingPrice: 123.5 }), "This will share the price (AED 123.50) and the picture with them.");
  assert.match(shares.sharePriceNotice("custom_item", { currency: "EUR", sellingPrice: 1200 }), /EUR 1,200/);
  assert.equal(shares.sharePriceNotice("setup"), "Prices are not shared — they will see current prices.");
  assert.ok(!/\d/.test(shares.sharePriceNotice("setup", { currency: "AED", sellingPrice: 5 })), "a setup notice never carries a price even if one is passed");
});

// ── Part 1: recipient name ───────────────────────────────────────────────────────────────────────────────────
test("sent list: recipient_name is selected and mapped; an older share without it shows 'Colleague'", () => {
  assert.match(shares.SHARE_SELECT_SENT, /recipient_name/);
  const row = { id: SHARE, kind: "setup", recipient_id: B, item_name: "Every", note: null, picture_path: null, picture_note: null, status: "pending", created_at: "2026-11-19T10:00:00Z", responded_at: null, result_item_id: null };
  assert.equal(shares.toSentShare({ ...row, recipient_name: "Bea" } as any)!.recipientName, "Bea");
  const older = shares.toSentShare({ ...row, recipient_name: null } as any)!;
  assert.equal(older.recipientName, null);
  assert.equal(shares.recipientDisplayName(older.recipientName), "Colleague");
  assert.equal(shares.toSentShare(row as any)!.recipientName, null, "column missing on very old rows");
  assert.ok(!SHARE_SENT_KEYS_HAVE_PRICE(shares.toSentShare({ ...row, recipient_name: "Bea" } as any)!));
});
function SHARE_SENT_KEYS_HAVE_PRICE(value: object) {
  return /price|selling|payload|recipe/i.test(Object.keys(value).join(","));
}

test("the migration is saved as supplied (column, length check, send function fills it) and the app does not write it", () => {
  const sql = read("../../../supabase/migrations/20261119120000_my_collection_share_recipient_name.sql");
  assert.match(sql, /alter table public\.my_collection_shares add column if not exists recipient_name text;/);
  assert.match(sql, /check \(recipient_name is null or char_length\(recipient_name\) <= 120\)/);
  assert.match(sql, /insert into public\.my_collection_shares \(id, kind, sender_id, recipient_id, sender_name, recipient_name,/);
  assert.match(sql, /set search_path = ''/);
  assert.ok(!/service[_-]?role/i.test(sql));
  assert.doesNotMatch(read("./shares-service.ts"), /recipient_name/, "only the read constant mentions it; the service writes nothing");
});

// ── Part 1: signed picture link ──────────────────────────────────────────────────────────────────────────────
test("incoming list: a pending share's picture is a signed link of at most 10 minutes made with the recipient's own client; no storage path or recipe reaches the browser", async () => {
  world.shares = [
    incomingRow(SHARE),
    incomingRow(SHARE2, { status: "accepted", responded_at: "2026-11-19T11:00:00Z" }),
    { ...incomingRow("55555555-5555-4555-8555-555555555555"), kind: "setup", picture_path: null, payload: { recipe: { secret: "RECIPE" }, spec_overrides: { s: "SPEC" }, setup_name: "Every", brand_name: "I", product_name: "E" } },
    incomingRow("66666666-6666-4666-8666-666666666666", { picture_path: `${A}/incoming/66666666-6666-4666-8666-666666666666/picture.webp` }), // not the recipient's folder
  ];
  world.signed = [];
  world.signFails = false;
  const result = await actions.listIncomingSharesAction() as any;
  assert.equal(result.ok, true);
  assert.equal(world.signed.length, 1, "one batched signing call");
  assert.deepEqual(world.signed[0].paths, [incomingPath(SHARE)], "only the recipient's own pending picture is signed");
  assert.ok(world.signed[0].seconds <= 600 && shares.SHARE_PICTURE_URL_SECONDS <= 600);
  const first = result.shares.find((share: any) => share.id === SHARE);
  assert.match(first.pictureUrl, /^https:\/\/signed\.example\//);
  assert.equal(first.hasPicture, true);
  assert.equal(result.shares.find((share: any) => share.id === SHARE2).pictureUrl, null, "finished shares are not signed");
  const json = JSON.stringify(result);
  assert.ok(!json.includes("picturePath") && !json.includes("/incoming/") && !json.includes("picture_path"), "no storage path");
  assert.ok(!json.includes("RECIPE") && !json.includes("SPEC") && !json.includes("recipe"), "no recipe or overrides");
  assert.equal(world.adminCalls, 0);
});

test("incoming list: a signing failure only means no picture is shown", async () => {
  world.shares = [incomingRow(SHARE)];
  world.signFails = true;
  const result = await actions.listIncomingSharesAction() as any;
  assert.equal(result.ok, true);
  assert.equal(result.shares[0].pictureUrl, null);
  assert.equal(result.shares[0].hasPicture, true);
  world.signFails = false;
});

// ── Share button and dialog ──────────────────────────────────────────────────────────────────────────────────
const send = read("../../../components/products/my-collection-share-send.tsx");
const shared = read("../../../components/products/my-collection-shared.tsx");
const list = read("../../../components/products/my-collection-list.tsx");
const custom = read("../../../components/products/my-collection-custom-items.tsx");

test("Share button: on every configured-setup card (usable ones) and every custom-item card, next to the other buttons; the popup gets none", () => {
  assert.match(list, /extra=\{item\.usable \? <ShareControl kind="setup" itemId=\{item\.id\} itemName=\{item\.setupName\} \/> : null\}/);
  assert.match(custom, /extra=\{<ShareControl kind="custom_item" itemId=\{item\.id\} itemName=\{item\.itemName\} priceItem=\{\{ currency: item\.currency, sellingPrice: item\.sellingPrice \}\} \/>\}/);
  assert.match(list, /\{extra\}/);
  assert.match(custom, /\{extra\}/);
  // the popup components pass no extra, so they show no Share button (that is PR 4-3b)
  for (const file of ["add-from-my-collection-button.tsx", "custom-item-picker-pane.tsx"]) {
    const source = read(`../../../components/quotations/${file}`);
    assert.ok(!/ShareControl|my-collection-share|shares-actions/.test(source), `${file} is untouched by sharing`);
  }
  assert.doesNotMatch(read("../../../components/quotations/add-from-my-collection-button.tsx"), /extra=/);
});

test("send dialog: name search needs 2 letters and waits 300 ms, shows names only, note counter, single send, friendly errors, Escape", () => {
  assert.match(send, /SEARCH_DELAY_MS = 300/);
  assert.match(send, /SHARE_TARGET_QUERY_MIN/);
  assert.match(send, /searchShareTargetsAction\(text\)/);
  assert.match(send, /window\.clearTimeout\(handle\)/, "each keystroke cancels the previous wait");
  assert.match(send, /if \(id !== searchId\.current\) return;/, "a late, older search cannot overwrite a newer one");
  assert.match(send, /displayName/);
  assert.doesNotMatch(send.replace(/\/\/[^\n]*/g, ""), /email/i, "never an email in the code");
  assert.match(send, /\{note\.length\}\/\{SHARE_NOTE_MAX\}/);
  assert.match(send, /maxLength=\{SHARE_NOTE_MAX\}/);
  assert.match(send, /if \(sendingRef\.current \|\| !selected\) return;/, "double-send guard");
  assert.match(send, /disabled=\{sending \|\| !selected\}/);
  assert.match(send, /setError\(result\.message\)/, "the friendly message from the server");
  assert.match(send, /Sent to \{done\.name\}/);
  assert.match(send, /Sent, but the picture could not be included: \{done\.warning\}/);
  assert.match(send, /result\.pictureNote/);
  assert.match(send, /event\.key === "Escape"/);
  assert.match(send, /useEscapeLayer\(open, close\)/);
  assert.match(send, /sendShareAction\(\{ kind, itemId, recipientId: selected\.id, note: note\.trim\(\) \|\| null \}\)/);
  assert.match(send, /sharePriceNotice\(kind, priceItem\)/);
  assert.match(send, /w-full flex-col[^"]*sm:max-w-md/, "full screen on phones");
});

test("the price line is only for custom items: only the custom card passes a price, the setup card passes none", () => {
  assert.doesNotMatch(list.match(/<ShareControl[^>]*>/)![0], /priceItem/);
  assert.match(custom.match(/<ShareControl[^>]*>/)![0], /priceItem=/);
});

// ── Shared with you ──────────────────────────────────────────────────────────────────────────────────────────
test("Shared with you: pending first, recent history greyed, Add now / Review & edit / two-step Dismiss, one action at a time", () => {
  for (const text of ["Add now", "Review &amp; edit", "Dismiss", "Confirm dismiss", "Keep", "Earlier", "Nothing is waiting for you.", "Loading shared items...", "Try again"]) assert.ok(shared.includes(text), text);
  const card = shared.slice(shared.indexOf("function IncomingCard"), shared.indexOf("function statusChip"));
  assert.match(card, /onClick=\{\(\) => setConfirming\(true\)\}[^>]*>Dismiss</, "the first click only asks");
  assert.match(card, /onClick=\{\(\) => \{ setConfirming\(false\); onDismiss\(\); \}\}[^>]*>Confirm dismiss</, "only the second click dismisses");
  assert.equal((card.match(/onDismiss\(\)/g) ?? []).length, 1, "dismiss is called from one place only");
  assert.match(shared, /if \(busyRef\.current\) return; \/\/ one action at a time/);
  assert.match(shared, /acceptCustomItemShareAction\(\{ shareId: share\.id, brand: item\.brandName, name: item\.itemName, code: item\.itemCode \?\? "", spec: item\.specification \?\? "", unit: item\.unitLabel, price: String\(item\.sellingPrice\), currency: item\.currency, pictureMode: "keep" \}\)/);
  assert.match(shared, /acceptSetupShareAction\(\{ shareId: share\.id, setupName: item\.setupName, note: item\.note \}\)/);
  assert.match(shared, /dismissShareAction\(share\.id\)/);
  assert.match(shared, /router\.refresh\(\)/, "the Configured and Custom lists refresh after an accept");
  assert.match(shared, /Added &quot;|Added "\$\{share\.itemName\}" to your collection\./);
  assert.match(shared, /View in Custom items/);
  assert.match(shared, /View in Configured products/);
  assert.match(shared, /\.slice\(0, HISTORY_LIMIT\)/);
  assert.match(shared, /share\.status === "pending"/);
  // the sender's note is plain text only
  assert.doesNotMatch(shared, /dangerouslySetInnerHTML/);
});

test("Review & edit: custom item uses the brand combobox with the recipient's brands, all fields, picture keep / remove / replace with browser compression; setup edits only name and note", () => {
  const custom_ = shared.slice(shared.indexOf("function ReviewCustomItem"), shared.indexOf("function ReviewSetup"));
  assert.match(custom_, /<BrandCombobox brands=\{brands\}/);
  for (const label of ["Item name", "Code (optional)", "Unit", "Selling price", "Currency", "Specification (optional)", "Keep the sender", "No picture", "Use my own picture"]) assert.ok(custom_.includes(label), label);
  assert.match(custom_, /CUSTOM_ITEM_CURRENCIES\.map/);
  assert.match(custom_, /await compressToWebp\(chosen\)/);
  assert.match(custom_, /form\.set\("pictureMode", mode\)/);
  assert.match(custom_, /if \(mode === "replace" && file\) form\.set\("file", file\)/);
  assert.match(custom_, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(custom_, /up to 10 MB\. We compress it to a small WebP automatically\./);
  assert.match(custom_, /disabled=\{Boolean\(busy\)\}/, "no save while compressing or adding");
  assert.match(custom_, /acceptCustomItemShareAction\(form\)/);
  assert.match(custom_, /useEscapeLayer\(true, onCancel\)/);
  const setup = shared.slice(shared.indexOf("function ReviewSetup"), shared.indexOf("// ── One waiting share"));
  assert.match(setup, /label="Setup name"/);
  assert.match(setup, /label="Note \(optional\)"/);
  assert.match(setup, /label="Brand"><p /, "brand is read-only text");
  assert.match(setup, /label="Product"><p /, "product is read-only text");
  assert.equal((setup.match(/<input /g) ?? []).length, 1, "the only input is the name");
  assert.match(setup, /acceptSetupShareAction\(\{ shareId: share\.id, setupName: name, note \}\)/);
});

// ── Sent ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("Sent: name, 'To NAME', status chip, date; Unsend only while waiting and in two steps; never a price", () => {
  const sent = shared.slice(shared.indexOf("// ── \"Sent\" tab"));
  assert.match(sent, /To \{recipientDisplayName\(share\.recipientName\)\}/);
  assert.match(sent, /sentStatusLabel\(share\.status\)/);
  assert.match(sent, /canUnsend\(share\.status\) \? \(/);
  assert.match(sent, /Confirm unsend/);
  assert.match(sent, /onClick=\{\(\) => setConfirming\(true\)\} className=\{dangerButton\}>Unsend</);
  assert.match(sent, /unsendShareAction\(share\.id\)/);
  assert.match(sent, /You have not shared anything yet\./);
  assert.match(sent, /Loading sent items\.\.\./);
  assert.ok(!/price|selling|currency|formatCustomItemPrice|payload|recipe/i.test(sent), "the Sent list renders no price");
  assert.match(sent, /if \(busyRef\.current\) return;/);
});

// ── Guards ───────────────────────────────────────────────────────────────────────────────────────────────────
test("no admin client in any new UI or action file; no email; new files are client components", () => {
  for (const [name, source] of [["send", send], ["shared", shared], ["tabs", read("../../../components/products/my-collection-tabs.tsx")], ["page", read("../../../app/products/my-collection/page.tsx")], ["actions", read("./shares-actions.ts")]] as const) {
    assert.ok(!/createAdminClient|service[_-]?role|supabase\/admin|SUPABASE_SERVICE/i.test(source), `${name}: no admin client`);
  }
  assert.match(send, /^"use client";/);
  assert.match(shared, /^"use client";/);
  assert.equal(world.adminCalls, 0);
});

test("diff guard: popup, sidebar, notifications and the bell are untouched; no other SQL; at most 12 files", () => {
  let diff: string[];
  try {
    const root = new URL("../../../", import.meta.url);
    const run = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const base = run(["merge-base", "HEAD", "origin/main"]).trim();
    diff = [...run(["diff", "--name-only", base]).split("\n"), ...run(["ls-files", "--others", "--exclude-standard"]).split("\n")].map((line) => line.trim()).filter(Boolean);
  } catch {
    return;
  }
  for (const forbidden of ["components/quotations/add-from-my-collection-button.tsx", "components/quotations/custom-item-picker-pane.tsx", "components/layout/erp-sidebar.tsx", "components/notifications/notification-bell.tsx", "components/notifications/notifications-page-content.tsx", "lib/notifications/actions.ts", "package.json"]) {
    assert.ok(!diff.includes(forbidden), `${forbidden} must have an empty diff`);
  }
  const migrations = diff.filter((file) => file.startsWith("supabase/migrations/"));
  assert.ok(migrations.every((file) => file.endsWith("20261119120000_my_collection_share_recipient_name.sql")), "only the supplied migration");
  assert.ok(diff.length <= 12, `at most 12 files change (${diff.length})`);
});
