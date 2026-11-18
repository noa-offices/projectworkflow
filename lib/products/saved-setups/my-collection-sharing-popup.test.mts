/* eslint-disable @typescript-eslint/no-explicit-any -- small fixtures for the polish tests */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COLLECTION_TABS, PENDING_SHARES_EVENT, notificationLinkLabel, parseCollectionTab, sharedTabLabel } from "./shares";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const popup = read("../../../components/quotations/add-from-my-collection-button.tsx");
const pane = read("../../../components/quotations/custom-item-picker-pane.tsx");
const shared = read("../../../components/products/my-collection-shared.tsx");
const send = read("../../../components/products/my-collection-share-send.tsx");
const tabs = read("../../../components/products/my-collection-tabs.tsx");
const sidebar = read("../../../components/layout/erp-sidebar.tsx");
const bell = read("../../../components/notifications/notification-bell.tsx");
const inbox = read("../../../components/notifications/notifications-page-content.tsx");

// ── Popup: third tab ─────────────────────────────────────────────────────────────────────────────────────────
test("popup: a third tab 'Shared with you (N)' next to the two lists; hidden at 0 unless the user is on it", () => {
  assert.match(popup, /pendingShares > 0 \|\| tab === "shared" \? \(/);
  assert.match(popup, /\{sharedTabLabel\(pendingShares\)\}/);
  assert.match(popup, /setTab\("shared"\)/);
  assert.match(popup, /aria-selected=\{tab === "shared"\}/);
  assert.equal(sharedTabLabel(4), "Shared with you (4)");
  assert.equal(sharedTabLabel(0), "Shared with you");
  // the two existing tabs and their pinned structure are still there
  assert.match(popup, /\[\["configured", "Configured products"\], \["custom", "Custom items"\]\]/);
  assert.match(popup, /customTarget \? \(\s*<div role="tablist"/);
  assert.match(popup, /const showConfigured = tab === "configured" \|\| !customTarget;/);
  // the same rule on the page
  assert.match(tabs, /pending > 0 \|\| tab === "shared" \? \(/);
});

test("popup: the count is one light call when the popup opens; a failure shows no count; the tab keeps the count up to date", () => {
  assert.match(popup, /const waiting = await pendingShareCountAction\(\);/);
  assert.match(popup, /setPendingShares\(waiting\.ok \? waiting\.count : 0\)/);
  assert.match(popup, /catch \{\s*setPendingShares\(0\);/);
  assert.match(popup, /onPendingChange=\{setPendingShares\}/);
  // the pinned load line of the configured list is untouched
  assert.ok(popup.includes("setSetups(await listPickerSetups());"));
});

test("popup: the Shared tab is the SAME component and actions as the page (one implementation), nothing duplicated", () => {
  assert.match(popup, /import \{ SharedWithYouTab \} from "@\/components\/products\/my-collection-shared";/);
  assert.match(tabs, /import \{ SentTab, SharedWithYouTab \} from "@\/components\/products\/my-collection-shared";/);
  assert.match(popup, /<SharedWithYouTab[\s\S]*?\/>/);
  for (const action of ["acceptCustomItemShareAction", "acceptSetupShareAction", "dismissShareAction", "listIncomingSharesAction"]) {
    assert.ok(shared.includes(action), `the shared component calls ${action}`);
    assert.ok(!popup.includes(action), `the popup does not duplicate ${action}`);
  }
  assert.match(shared, /<BrandCombobox brands=\{brands\}/, "own brand via the brand combobox in the review form");
  assert.match(shared, /await compressToWebp\(chosen\)/);
  assert.ok(!/createAdminClient|service[_-]?role|supabase\/admin/i.test(popup + pane + shared + send + sidebar), "no admin client in the changed UI");
});

test("popup: accepting refreshes the popup's own lists, never the quotation page; the review form loads the recipient's brands itself", () => {
  assert.match(popup, /refreshPage=\{false\}/);
  assert.match(shared, /refreshPage = true/, "the page keeps refreshing its server lists");
  assert.match(shared, /if \(refreshPage\) router\.refresh\(\);/);
  assert.match(shared, /onAccepted\?\.\(share\.kind\);/);
  assert.match(popup, /function afterShareAccepted\(kind: ShareKind\) \{\s*if \(kind !== "setup"\) return;/);
  assert.match(popup, /setSetups\(await listPickerSetups\(\)\);\s*\} catch \{\s*\/\/ the list refreshes the next time the popup opens/);
  assert.match(popup, /onAccepted=\{afterShareAccepted\}/);
  assert.match(popup, /if \(next === "configured" \|\| next === "custom"\) setTab\(next\);/, "the banner buttons switch the popup's tab");
  assert.match(shared, /brands\?: BrandCount\[\]/);
  assert.match(shared, /listCustomItems\(\)\.then\(\(list\) => \{ if \(!cancelled\) setLoadedBrands\(distinctBrands\(list\)\); \}\)/);
  assert.match(shared, /const brandList = brands \?\? loadedBrands;/);
  // the page passes its own brands and its behaviour is unchanged
  assert.match(tabs, /<SharedWithYouTab brands=\{brands\} onPendingChange=\{setPending\} onOpenTab=\{setTab\} \/>/);
  // "Add to quote now" was deliberately not added: the add paths stay exactly as they were
  assert.doesNotMatch(shared, /addCustomItemToQuotation|loadSetupForReplay|onChoose/);
});

test("popup: the Shared tab links to the sent list on the page (new tab), so the popup stays simple", () => {
  assert.match(popup, /href="\/products\/my-collection\?tab=sent" target="_blank" rel="noopener noreferrer"/);
  assert.equal(parseCollectionTab("sent"), "sent");
  assert.ok(COLLECTION_TABS.includes("sent"));
  assert.equal((popup.match(/href="\/products\/my-collection"/g) ?? []).length, 2, "the existing 'Open My Collection page' links are unchanged");
});

// ── Popup: initial tab ───────────────────────────────────────────────────────────────────────────────────────
test("popup: accepts an optional initial tab (configured | custom | shared); the default and the selector call are unchanged", () => {
  assert.match(popup, /initialTab = "configured",/);
  assert.match(popup, /initialTab\?: "configured" \| "custom" \| "shared";/);
  assert.match(popup, /useState<"configured" \| "custom" \| "shared">\(initialTab\)/);
  assert.match(popup, /setOpen\(true\);\s*setTab\(initialTab\);/, "every open starts on the initial tab");
  const selector = read("../../../components/quotations/product-library-selector.tsx");
  assert.ok(selector.includes("<AddFromMyCollectionButton onChoose={openSetupFromCollection} />"), "the Product Library selector is untouched");
});

// ── Share button in the popup ────────────────────────────────────────────────────────────────────────────────
test("popup: Share on every configured-setup card and every custom-item card, the same dialog as the page", () => {
  assert.match(popup, /import \{ ShareControl \} from "@\/components\/products\/my-collection-share-send";/);
  assert.match(popup, /extra=\{<ShareControl kind="setup" itemId=\{item\.id\} itemName=\{item\.setupName\} \/>\}/);
  assert.match(pane, /import \{ ShareControl \} from "@\/components\/products\/my-collection-share-send";/);
  assert.match(pane, /extra=\{<ShareControl kind="custom_item" itemId=\{item\.id\} itemName=\{item\.itemName\} priceItem=\{\{ currency: item\.currency, sellingPrice: item\.sellingPrice \}\} \/>\}/);
  // only the custom card passes a price; the setup card passes none
  assert.doesNotMatch(popup.match(/<ShareControl[^>]*>/)![0], /priceItem/);
  // the card body is still the only add-to-quote target: the button is a sibling in the action row
  const card = popup.slice(popup.indexOf("function SetupPickCard"), popup.indexOf("export function AddFromMyCollectionButton"));
  assert.equal((card.match(/<button/g) ?? []).length, 1);
  assert.ok(card.indexOf("</button>") < card.indexOf("<SetupActionRow"));
  const paneCard = pane.slice(pane.indexOf("function CustomPickCard"), pane.indexOf("export function CustomItemPickerPane"));
  assert.equal((paneCard.match(/<button/g) ?? []).length, 1);
  assert.ok(paneCard.indexOf("</button>") < paneCard.indexOf("<CustomItemActionRow"));
});

test("Esc layering: the send dialog is its own escape layer, so Escape closes it before the popup; it is above the popup and full screen on phones", () => {
  assert.match(send, /useEscapeLayer\(open, close\)/);
  assert.match(send, /if \(event\.key === "Escape"\) \{\s*event\.stopPropagation\(\);\s*close\(\);/);
  // the popup closes the innermost layer first and only closes itself when nothing is open
  assert.match(popup, /if \(!closeTop\(\)\) setOpen\(false\);/);
  assert.match(popup, /<EscapeLayerProvider value=\{layers\}>/);
  const escape = read("../../../components/products/escape-layer.tsx");
  assert.match(escape, /stack\.current\[stack\.current\.length - 1\]/, "the most recently opened layer closes first");
  // the dialog sits above the popup (z-[60]) and is full screen below the sm breakpoint
  assert.match(popup, /fixed inset-0 z-\[60\]/);
  assert.match(send, /fixed inset-0 z-\[70\][^"]*p-0 sm:items-center/);
  assert.match(send, /h-full w-full flex-col[^"]*sm:max-w-md/);
  // the review panels and confirms inside the Shared tab are layers too
  assert.match(shared, /useEscapeLayer\(true, onCancel\)/);
  assert.match(shared, /useEscapeLayer\(confirming, \(\) => setConfirming\(false\)\)/);
});

// ── Sidebar badge ────────────────────────────────────────────────────────────────────────────────────────────
test("sidebar: the My Collection entry shows the pending share count; 0 or a failure shows nothing and never an error", () => {
  assert.match(sidebar, /label: "My Collection", href: "\/products\/my-collection", icon: Bookmark, active: isMyCollectionActive\(pathname\), badge: pendingShares/);
  assert.match(sidebar, /\{item\.badge && item\.badge > 0 \? \(/, "no badge for 0 or undefined");
  assert.match(sidebar, /item\.badge > 9 \? "9\+" : item\.badge/);
  assert.match(sidebar, /if \(!cancelled\) setPendingShares\(result\.ok \? result\.count : 0\)/, "a failed count is 0");
  assert.match(sidebar, /\.catch\(\(\) => \{ if \(!cancelled\) setPendingShares\(0\); \}\)/, "a thrown error is 0");
  assert.match(sidebar, /if \(role === "warehouse_staff"\) return;/, "no call for roles without My Collection");
  assert.match(sidebar, /\}, \[pathname, role\]\);/, "one call per navigation, no polling");
  assert.doesNotMatch(sidebar, /setInterval/);
  assert.match(sidebar, /bg-red-500[^"]*text-white/, "the same red badge style as the bell");
  // the page and popup tell the sidebar when the count changes
  assert.match(sidebar, /window\.addEventListener\(PENDING_SHARES_EVENT, onChange\)/);
  assert.match(sidebar, /window\.removeEventListener\(PENDING_SHARES_EVENT, onChange\)/);
  assert.match(shared, /window\.dispatchEvent\(new CustomEvent\(PENDING_SHARES_EVENT, \{ detail: pending\.length \}\)\)/);
  assert.equal(PENDING_SHARES_EVENT, "my-collection-pending-shares");
  // the sidebar only calls the existing action
  assert.match(sidebar, /import \{ pendingShareCountAction \} from "@\/lib\/products\/saved-setups\/shares-actions";/);
});

// ── Notification links ───────────────────────────────────────────────────────────────────────────────────────
test("notification link label: only My Collection paths get a friendly label; everything else is returned unchanged", () => {
  for (const path of ["/products/my-collection", "/products/my-collection?tab=shared", "/products/my-collection?tab=sent", "/products/my-collection/anything", " /products/my-collection?tab=shared "]) {
    assert.equal(notificationLinkLabel(path), "My Collection", path);
  }
  const unchanged = ["/inventory/requests?tab=products&status=pending_review", "/inventory/requests?tab=movements&status=approved", "ORD-1001", "/products/my-collection-old", "/products/templates", "inventory_managers", ""];
  for (const value of unchanged) assert.equal(notificationLinkLabel(value), value, value);
  assert.equal(notificationLinkLabel(null), "");
  assert.equal(notificationLinkLabel(undefined), "");
});

test("bell and inbox: the label is used for display only; navigation still uses the raw order_no", () => {
  for (const [name, source] of [["bell", bell], ["inbox", inbox]] as const) {
    assert.match(source, /import \{ notificationLinkLabel \} from "@\/lib\/products\/saved-setups\/shares";/, name);
    assert.match(source, /\{notificationLinkLabel\(item\.order_no\)\}/, name);
    assert.doesNotMatch(source, />\s*\{item\.order_no\}\s*</, `${name}: the raw path is no longer printed as text`);
  }
  assert.match(bell, /const destination = item\.order_no\?\.trim\(\);/, "the bell's link is unchanged");
  assert.match(bell, /destination\.startsWith\("\/"\)\s*\? destination/);
  assert.match(inbox, /router\.push\(item\.order_no\.startsWith\("\/"\) \? item\.order_no : `\/projects\/orders\/\$\{item\.order_no\}`\)/, "the inbox navigation is unchanged");
  // the page opens the right tab from ?tab= (verified from PR 4-3a)
  const page = read("../../../app/products/my-collection/page.tsx");
  assert.match(page, /parseCollectionTab\(params\.tab\)/);
  assert.equal(parseCollectionTab("shared"), "shared");
  assert.equal(parseCollectionTab("sent"), "sent");
  assert.equal(parseCollectionTab("nope"), "configured");
});

// ── Guards ───────────────────────────────────────────────────────────────────────────────────────────────────
test("diff guard: no SQL, no server logic, no package changes; at most 12 files", () => {
  let diff: string[];
  try {
    const root = new URL("../../../", import.meta.url);
    const run = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const base = run(["merge-base", "HEAD", "origin/main"]).trim();
    diff = [...run(["diff", "--name-only", base]).split("\n"), ...run(["ls-files", "--others", "--exclude-standard"]).split("\n")].map((line) => line.trim()).filter(Boolean);
  } catch {
    return;
  }
  assert.ok(!diff.some((file) => file.startsWith("supabase/")), "no SQL");
  for (const forbidden of ["lib/products/saved-setups/shares-actions.ts", "lib/products/saved-setups/shares-service.ts", "lib/products/saved-setups/shares-picture.ts", "lib/notifications/actions.ts", "package.json", "app/quotations/actions.ts"]) {
    assert.ok(!diff.includes(forbidden), `${forbidden} must have an empty diff`);
  }
  assert.ok(diff.length <= 12, `at most 12 files change (${diff.length})`);
});

// ══ PR 5: My Collection polish ═══════════════════════════════════════════════════════════════════════════════════
import { COLLECTION_TIME_ZONE, filterSetups, formatSavedDate, normaliseSearchKey, savedLine } from "./collection-view";
import { customItemPriceLine, toCollectionItem } from "./custom-item";
import { listSetupsForUser } from "./saved-setups-service";

const list = read("../../../components/products/my-collection-list.tsx");
const customItems = read("../../../components/products/my-collection-custom-items.tsx");
const selector = read("../../../components/quotations/product-library-selector.tsx");

// ── FIX 1: main code search ──────────────────────────────────────────────────────────────────────────────────
const setup = (id: string, setupName: string, productCode?: string) => ({ id, brandName: "Interstuhl", productName: "Every", setupName, ...(productCode ? { productCode } : {}) });

test("code search: 'ev211' finds 'EV-211' ignoring case, spaces and dashes; partial codes work; no code never crashes", () => {
  const items = [setup("1", "Every white", "EV-211"), setup("2", "Every black", "EV 305"), setup("3", "Buddy blue"), setup("4", "Plain", "AB_12.3")];
  const ids = (query: string) => filterSetups(items, query).map((item) => item.id);
  assert.deepEqual(ids("ev211"), ["1"]);
  assert.deepEqual(ids("EV211"), ["1"]);
  assert.deepEqual(ids("ev-211"), ["1"]);
  assert.deepEqual(ids("ev 211"), ["1"]);
  assert.deepEqual(ids("EV-2"), ["1"], "a partial code");
  assert.deepEqual(ids("ev305"), ["2"], "a code saved with a space is found without one");
  assert.deepEqual(ids("ab123"), ["4"], "underscores and dots are ignored too");
  assert.deepEqual(ids("ev"), ["1", "2", "3", "4"], "every product here is called 'Every', so a name match still works as before");
  assert.deepEqual(ids("zzz"), []);
  assert.deepEqual(ids("--"), [], "a query of only dashes does not match everything");
  assert.equal(ids("").length, 4, "an empty query keeps everything");
  assert.deepEqual(ids("buddy"), ["3"], "a setup without a code still matches by name");
  assert.doesNotThrow(() => filterSetups([{ id: "x", brandName: "B", productName: "P", setupName: "N", productCode: null }], "ev"));
  assert.equal(normaliseSearchKey(" EV-211_x.y "), "ev211xy");
  assert.equal(normaliseSearchKey(undefined), "");
});

test("code search: custom items still match their own item code (now also ignoring dashes), brand and name", () => {
  const entries = [
    toCollectionItem({ id: "1", brandName: "Acme", itemName: "Desk", itemCode: "DSK-1" } as any),
    toCollectionItem({ id: "2", brandName: "Zeta", itemName: "Lamp", itemCode: "LMP-9" } as any),
    toCollectionItem({ id: "3", brandName: "Acme", itemName: "Chair", itemCode: null } as any),
  ];
  assert.deepEqual(filterSetups(entries, "lmp-9").map((entry) => entry.id), ["2"]);
  assert.deepEqual(filterSetups(entries, "dsk1").map((entry) => entry.id), ["1"]);
  assert.deepEqual(filterSetups(entries, "zeta").map((entry) => entry.id), ["2"]);
  assert.deepEqual(filterSetups(entries, "chair").map((entry) => entry.id), ["3"]);
});

test("setups list read: the main code comes from the saved configuration, else the product's item code; absent when there is none", async () => {
  const rows = [
    { id: "a", brand_name: "I", product_name: "Every", setup_name: "One", note: null, template_id: "t1", use_count: 0, updated_at: "2026-01-01", created_at: "2026-01-01", last_used_at: null, main_code: "EV211", product_templates: { is_active: true, lifecycle_status: "active", item_code: "ITEM-1" } },
    { id: "b", brand_name: "I", product_name: "Every", setup_name: "Two", note: null, template_id: "t1", use_count: 0, updated_at: "2026-01-01", created_at: "2026-01-01", last_used_at: null, main_code: null, product_templates: [{ is_active: true, lifecycle_status: "active", item_code: " ITEM-2 " }] },
    { id: "c", brand_name: "I", product_name: "Every", setup_name: "Three", note: null, template_id: null, use_count: 0, updated_at: "2026-01-01", created_at: "2026-01-01", last_used_at: null, main_code: "  ", product_templates: null },
  ];
  let selectText = "";
  const query: any = { select: (text: string) => { selectText = text; return query; }, eq: () => query, order: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) };
  const result = await listSetupsForUser({ from: () => query } as any, "user-1", { withImages: false });
  assert.equal(result.find((item) => item.id === "a")!.productCode, "EV211");
  assert.equal(result.find((item) => item.id === "b")!.productCode, "ITEM-2");
  assert.ok(!("productCode" in result.find((item) => item.id === "c")!), "no code: the key is absent");
  assert.match(selectText, /main_code:recipe->display->>main_code/, "read-only JSON path of the saved recipe");
  assert.match(selectText, /product_templates\(is_active,lifecycle_status,item_code\)/, "read-only join through the existing template relation");
  assert.doesNotMatch(selectText, /price/i);
});

test("code is shown as small grey text on the page card and the popup card; both lists search it", () => {
  assert.match(list, /\{item\.productCode \? <p className="mt-1 truncate text-xs text-zinc-400">\{item\.productCode\}<\/p> : null\}/);
  assert.match(popup, /\{item\.productCode \? <span className="mt-1 block truncate text-xs text-zinc-400">\{item\.productCode\}<\/span> : null\}/);
  assert.match(popup, /filterConfigured\(setups \?\? \[\]/, "the popup search goes through filterSetups");
  assert.match(list, /filterSetups\(usable, search\)/);
  assert.doesNotMatch(list, /unit_price|net_price|currency/i, "no price on the configured card");
});

// ── FIX 2: Dubai time ────────────────────────────────────────────────────────────────────────────────────────
test("dates are shown in Dubai time: 21:30 UTC is already the next day in Dubai", () => {
  assert.equal(COLLECTION_TIME_ZONE, "Asia/Dubai");
  assert.equal(formatSavedDate("2026-11-17T21:30:00Z"), "18 Nov 2026");
  assert.equal(formatSavedDate("2026-11-17T19:59:59Z"), "17 Nov 2026", "19:59 UTC is 23:59 in Dubai: still the same day");
  assert.equal(formatSavedDate("2026-11-17T20:00:00Z"), "18 Nov 2026", "20:00 UTC is midnight in Dubai");
  assert.equal(formatSavedDate("2026-12-31T20:00:00Z"), "1 Jan 2027", "across a year end");
  assert.equal(formatSavedDate("2026-11-17T09:30:00Z"), "17 Nov 2026", "the format is unchanged");
  assert.equal(formatSavedDate(null), "");
  assert.equal(formatSavedDate("garbage"), "");
  assert.equal(savedLine({ createdAt: "2026-11-17T21:30:00Z", useCount: 2 }), "Saved 18 Nov 2026 · Used 2 times");
  assert.equal(customItemPriceLine({ currency: "AED", sellingPrice: 1200, priceSavedAt: "2026-11-17T21:30:00Z" }), "AED 1,200 · Saved price 18 Nov 2026");
});

test("ONE date helper for all of My Collection: every date goes through formatSavedDate; nothing formats a date on its own", () => {
  const files = { list, customItems, shared, popup, pane, tabs, collectionView: read("./collection-view.ts"), customItem: read("./custom-item.ts") };
  assert.equal((files.collectionView.match(/timeZone:/g) ?? []).length, 1, "the zone appears once");
  for (const [name, source] of Object.entries(files)) {
    if (name === "collectionView") continue;
    assert.ok(!/toLocale(Date|Time)String|Intl\.DateTimeFormat|timeZone/.test(source), `${name} formats no date itself`);
  }
  assert.match(shared, /formatSavedDate\(share\.createdAt\)/);
  assert.equal((shared.match(/formatSavedDate\(/g) ?? []).length, 3, "from-date, earlier list and sent list");
  assert.match(files.customItem, /formatSavedDate\(item\.priceSavedAt\)/);
  assert.match(files.collectionView, /formatSavedDate\(createdAt\)/);
});

// ── FIX 3: Back to list ──────────────────────────────────────────────────────────────────────────────────────
test("popup Back button: shown at the top of every edit panel in the popup only; returns without saving; two-step discard when dirty", () => {
  const bar = shared.slice(shared.indexOf("export function PanelBackBar"), shared.indexOf("function PictureBox"));
  assert.match(bar, /Back to list/);
  assert.match(bar, /onClick=\{\(\) => \(dirty \? setAsking\(true\) : onBack\(\)\)\}/, "clean: straight back; dirty: ask first");
  assert.match(bar, /Discard changes\?/);
  assert.match(bar, /onClick=\{onBack\}[^>]*>Discard changes</, "the second step discards");
  assert.match(bar, /onClick=\{\(\) => setAsking\(false\)\}[^>]*>Keep editing</);
  assert.equal((bar.match(/type="button"/g) ?? []).length, 3, "no Back button can submit the form");
  assert.doesNotMatch(bar, /Action|save|submit/i, "Back never saves");
  assert.doesNotMatch(bar, /useEscapeLayer/, "the bar adds no Escape layer: Escape behaves as before");
  // where it is wired in: the popup's edit / add panel, and the popup's review panels; NOT the page
  assert.match(pane, /<CustomItemForm[\s\S]*?showBack[\s\S]*?onDone=\{\(\) => setPanel\(null\)\}/);
  assert.match(popup, /<SharedWithYouTab[\s\S]*?showBack[\s\S]*?\/>/);
  assert.match(shared, /\{showBack \? <PanelBackBar dirty=\{dirty\} onBack=\{onCancel\} \/> : null\}/);
  assert.equal((shared.match(/<PanelBackBar/g) ?? []).length, 2, "custom review and setup review");
  assert.match(customItems, /\{showBack \? <PanelBackBar dirty=\{dirty\} onBack=\{cancel\} \/> : null\}/);
  assert.doesNotMatch(tabs, /showBack/, "the page does not turn it on");
  assert.doesNotMatch(customItems.slice(customItems.indexOf("function CustomItemCard"), customItems.indexOf("function RenameBrand")), /showBack/, "the page's inline edit form is unchanged");
  // Back uses the same cancel as the Cancel button (an unsaved uploaded picture is removed), never the save path
  assert.match(customItems, /function cancel\(\) \{\s*if \(image\.kind === "uploaded"\) void removeCustomItemImage\(image\.path\);\s*onDone\(\);/);
});

test("dirty means 'typed something': a field, the picture, or a chosen file", () => {
  assert.match(customItems, /const dirty = JSON\.stringify\(values\) !== JSON\.stringify\(initialValues\) \|\| image\.kind !== initialImageKind \|\| image\.kind === "uploaded";/);
  assert.match(shared, /const dirty =\s*brand !== item\.brandName \|\| name !== item\.itemName/);
  assert.match(shared, /mode !== \(share\.hasPicture \? "keep" : "remove"\) \|\| file !== null/);
  assert.match(shared, /const dirty = name !== item\.setupName \|\| note !== \(item\.note \?\? ""\);/);
});

test("Escape order is unchanged: the open panel closes first, then the popup", () => {
  assert.match(customItems, /useEscapeLayer\(true, cancel\);/);
  assert.match(shared, /useEscapeLayer\(true, onCancel\)/);
  assert.match(popup, /if \(!closeTop\(\)\) setOpen\(false\);/);
  assert.match(popup, /document\.addEventListener\("keydown", onKey\)/);
});

// ── FIX 4: findings ──────────────────────────────────────────────────────────────────────────────────────────
test("FIX 4c: the finishes editor starts from its saved finishes only once, so a replay remounts it", () => {
  const editor = read("../../../components/quotations/finish-selections-editor.tsx");
  assert.match(editor, /const \[finishes, setFinishes\] = useState\(\(\) => initialFinishes\.map\(normalizeFinish\)\);/, "the cause: the editor copies initialFinishes once");
  assert.match(selector, /<FinishSelectionsEditor\s+key=\{`finishes-\$\{replay\?\.key \?\? 0\}`\}/, "the fix: a new key on every replay");
  assert.match(selector, /setReplay\(\{ key: Date\.now\(\)/, "every replay gets a new key");
  assert.match(selector, /<BaseModelHierarchySelector key=\{`\$\{nativeSystem\.selected\?\.row\.id \?\? "no-system"\}:\$\{replay\?\.key \?\? 0\}`\}/, "same pattern as the model selector");
  // nothing else about the replay or the recipe changed
  assert.match(selector, /put\(setSelectedFinishesByTemplate, plain\.finishes as FinishSelectionEditorRow\[\] \| undefined\);/);
});

test("FIX 4a/4b: no change was needed or safe; the facts that were checked", () => {
  // (a) rename: the service updates by id and owner and returns the new name through the callbacks; nothing drops a name
  const service = read("./saved-setups-service.ts");
  assert.match(service, /\.update\(\{ setup_name: name \}\)\s*\.eq\("id", setupId\)\s*\.eq\("owner_id", userId\)\s*\.select\("id"\)/);
  assert.match(list, /callbacks\.onRenamed\?\.\(item\.id, name\.trim\(\)\)/);
  // (b) skipped accessory groups: the recipe has the field, the Product Library configurator never fills it
  const recipe = read("./recipe.ts");
  assert.match(recipe, /skipped_accessory_group_ids: Array\.from\(new Set\(\(state\.skippedAccessoryGroupIds \?\? \[\]\)/);
  assert.doesNotMatch(selector, /skippedAccessoryGroupIds/, "the configurator has no skipped-group state to save");
  assert.match(read("./replay.ts"), /skippedAccessoryGroupIds: plain\.skippedAccessoryGroupIds/);
});

test("PR 5 diff guard: no SQL, no recipe or replay change, no package change; at most 12 files", () => {
  let diff: string[];
  try {
    const root = new URL("../../../", import.meta.url);
    const run = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const base = run(["merge-base", "HEAD", "origin/main"]).trim();
    diff = [...run(["diff", "--name-only", base]).split("\n"), ...run(["ls-files", "--others", "--exclude-standard"]).split("\n")].map((line) => line.trim()).filter(Boolean);
  } catch {
    return;
  }
  assert.ok(!diff.some((file) => file.startsWith("supabase/")));
  for (const forbidden of ["lib/products/saved-setups/recipe.ts", "lib/products/saved-setups/replay.ts", "lib/products/saved-setups/shares.ts", "lib/products/saved-setups/shares-actions.ts", "package.json", "components/quotations/finish-selections-editor.tsx"]) {
    assert.ok(!diff.includes(forbidden), `${forbidden} must have an empty diff`);
  }
  assert.ok(diff.length <= 12, `at most 12 files change (${diff.length})`);
});
