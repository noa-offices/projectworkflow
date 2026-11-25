/* eslint-disable @typescript-eslint/no-explicit-any -- small fixtures for the polish tests */
import assert from "node:assert/strict";
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

// ══ PR 7: duplicate warning ══════════════════════════════════════════════════════════════════════════════════════
import {
  SETUP_COMPARE_MAX_CHARS,
  acceptDuplicateMessage,
  canonicalSetup,
  findCustomDuplicate,
  findSetupDuplicate,
  isIdenticalDuplicate,
  normaliseDuplicateKey,
  saveDuplicateMessage,
} from "./duplicates";
import { createCustomItemForUser, updateCustomItemForUser } from "./saved-custom-items-service";
import { findSetupDuplicateForUser } from "./saved-setups-service";

const duplicateShared = read("../../../components/products/my-collection-shared.tsx");
const saveButton = read("../../../components/quotations/save-to-my-collection-button.tsx");

const stored = (id: string, brandName: string, itemName: string, extra: Record<string, unknown> = {}) => ({ id, brandName, itemName, itemCode: null, sellingPrice: 100, currency: "AED", priceSavedAt: "2026-03-01T00:00:00Z", ...extra });

test("duplicate key: trim, lower case, ignores spaces, dashes, underscores and dots", () => {
  assert.equal(normaliseDuplicateKey("  Acme-Office_Co. "), "acmeofficeco");
  assert.equal(normaliseDuplicateKey("ACME   office"), normaliseDuplicateKey("acme-office"));
  assert.equal(normaliseDuplicateKey(null), "");
  assert.equal(normaliseDuplicateKey(5), "");
});

test("custom item: same brand + name (case, spaces, dashes ignored) is a duplicate; identical price vs different price is reported", () => {
  const existing = [stored("1", "Acme Office", "Standing Desk"), stored("2", "Zeta", "Lamp")];
  const same = findCustomDuplicate({ brandName: "acme-office", itemName: "STANDING  desk", sellingPrice: "100", currency: "aed" }, existing)!;
  assert.equal(same.id, "1");
  assert.equal(same.reason, "name");
  assert.equal(same.samePrice, true);
  assert.equal(isIdenticalDuplicate(same), true);
  assert.equal(same.existingPrice, undefined);
  const other = findCustomDuplicate({ brandName: "Acme Office", itemName: "Standing Desk", sellingPrice: 150, currency: "AED" }, existing)!;
  assert.equal(other.samePrice, false);
  assert.deepEqual(other.existingPrice, { currency: "AED", amount: 100 });
  assert.equal(isIdenticalDuplicate(other), false);
  assert.equal(findCustomDuplicate({ brandName: "Acme Office", itemName: "Standing Desk", sellingPrice: 100, currency: "EUR" }, existing)!.samePrice, false, "same number, other currency");
  assert.equal(findCustomDuplicate({ brandName: "Acme Office", itemName: "Standing Desk" }, existing)!.samePrice, false, "no price given");
  assert.equal(findCustomDuplicate({ brandName: "Other", itemName: "Standing Desk" }, existing), null, "same name, different brand");
  assert.equal(findCustomDuplicate({ brandName: "", itemName: "" }, [stored("3", "", "")]), null, "empty brand and name never match");
  assert.equal(findCustomDuplicate({ brandName: "Acme Office", itemName: "Standing Desk" }, []), null);
});

test("custom item: the same item code is a duplicate even when the names differ; the item being edited never matches itself", () => {
  const existing = [stored("1", "Acme", "Desk One", { itemCode: "DSK-1" }), stored("2", "Acme", "Chair", { itemCode: null })];
  const byCode = findCustomDuplicate({ brandName: "Other", itemName: "Totally different", itemCode: "dsk 1" }, existing)!;
  assert.equal(byCode.id, "1");
  assert.equal(byCode.reason, "code");
  assert.equal(findCustomDuplicate({ brandName: "x", itemName: "y", itemCode: "" }, existing), null, "an empty code never matches");
  assert.equal(findCustomDuplicate({ brandName: "Acme", itemName: "Desk One", itemCode: "DSK-1" }, existing, "1"), null, "editing item 1 is not a duplicate of item 1");
  assert.equal(findCustomDuplicate({ brandName: "Acme", itemName: "Desk One" }, existing, "2")!.id, "1", "but another item still is");
  assert.doesNotThrow(() => findCustomDuplicate(null as any, null as any));
});

const recipeA = { recipe_version: 1, template_id: "t1", display: { main_code: "EV211" }, selected_image: "a.png", selections: { variant_row_id: "v1", modular_quantities: { b: 2, a: 1 }, skipped_accessory_group_ids: ["g2", "g1"] }, finishes: [{ id: "f1", name: "Oak" }], linked: { instances: {}, selections: {} } };
const setupRow = (id: string, extra: Record<string, unknown> = {}) => ({ id, templateId: "t1", setupName: `Setup ${id}`, brandName: "Interstuhl", recipe: recipeA, specOverrides: { specification_edited: false, generated_specification_hash: "abc" }, archived: false, createdAt: "2026-04-01T00:00:00Z", ...extra });

test("setup: same template and same canonical recipe is a duplicate, keys in any order", () => {
  const reordered = { linked: { selections: {}, instances: {} }, finishes: [{ name: "Oak", id: "f1" }], selections: { skipped_accessory_group_ids: ["g1", "g2"], modular_quantities: { a: 1, b: 2 }, variant_row_id: "v1" }, template_id: "t1", recipe_version: 1 };
  const found = findSetupDuplicate({ templateId: "t1", recipe: reordered, specOverrides: { generated_specification_hash: "abc", specification_edited: false } }, [setupRow("1")])!;
  assert.equal(found.id, "1");
  assert.equal(found.kind, "setup");
  assert.equal(found.reason, "recipe");
  assert.equal(found.name, "Setup 1");
  assert.equal(found.brand, "Interstuhl");
  assert.equal(found.samePrice, undefined, "a setup has no price");
  assert.equal(canonicalSetup(recipeA), canonicalSetup(reordered), "canonical text is order independent");
});

test("setup: one different selection, finish or spec edit is NOT a duplicate; display-only differences are ignored", () => {
  const candidate = (recipe: unknown, spec: unknown = { specification_edited: false, generated_specification_hash: "abc" }) => findSetupDuplicate({ templateId: "t1", recipe, specOverrides: spec }, [setupRow("1")]);
  assert.equal(candidate({ ...recipeA, selections: { ...recipeA.selections, variant_row_id: "v2" } }), null, "one selection");
  assert.equal(candidate({ ...recipeA, finishes: [{ id: "f1", name: "Walnut" }] }), null, "a finish (unclear fields count as content)");
  assert.equal(candidate({ ...recipeA, selections: { ...recipeA.selections, modular_quantities: { a: 1, b: 3 } } }), null, "a quantity");
  assert.equal(candidate(recipeA, { specification_edited: true, edited_specification: "x", generated_specification_hash: "abc" }), null, "an edited specification");
  assert.notEqual(candidate({ ...recipeA, display: { main_code: "OTHER" }, selected_image: null }), null, "display label and selected image are ignored");
  assert.notEqual(candidate(recipeA, { specification_edited: false, generated_specification_hash: "different" }), null, "the specification hash is bookkeeping");
});

test("setup: archived, removed, other-template and the setup itself are ignored; a huge or odd recipe is skipped safely", () => {
  const find = (rows: any[], exclude?: string) => findSetupDuplicate({ templateId: "t1", recipe: recipeA, specOverrides: { specification_edited: false, generated_specification_hash: "abc" } }, rows, exclude);
  assert.equal(find([setupRow("1", { archived: true })]), null);
  assert.equal(find([setupRow("1", { templateId: null })]), null, "removed product");
  assert.equal(find([setupRow("1", { templateId: "t2" })]), null);
  assert.equal(find([setupRow("1")], "1"), null, "never itself");
  assert.equal(find([setupRow("1", { archived: true }), setupRow("2")])!.id, "2");
  const huge = { ...recipeA, finishes: Array.from({ length: 4000 }, (_, i) => ({ id: `f${i}`, name: "x".repeat(40) })) };
  assert.equal(canonicalSetup(huge), null, "over the cap: no comparison");
  assert.ok(SETUP_COMPARE_MAX_CHARS <= 70_000);
  assert.equal(findSetupDuplicate({ templateId: "t1", recipe: huge }, [setupRow("1", { recipe: huge })]), null, "no warning, no throw");
  let deep: any = {};
  const root = deep;
  for (let i = 0; i < 60; i += 1) { deep.next = {}; deep = deep.next; }
  assert.equal(canonicalSetup(root), null, "too deep: skipped");
  const loop: any = { a: 1 };
  loop.self = loop;
  assert.doesNotThrow(() => canonicalSetup(loop));
  assert.equal(canonicalSetup(loop), null);
  assert.doesNotThrow(() => findSetupDuplicate(null as any, null as any));
});

test("wording: one place; saving and accepting read differently; a setup never mentions a price", () => {
  const custom = findCustomDuplicate({ brandName: "Acme", itemName: "Desk", sellingPrice: 100, currency: "AED" }, [stored("1", "Acme", "Desk")])!;
  assert.equal(saveDuplicateMessage(custom), "Already in your collection: Desk (Acme), same price.");
  const different = findCustomDuplicate({ brandName: "Acme", itemName: "Desk", sellingPrice: 5, currency: "AED" }, [stored("1", "Acme", "Desk", { sellingPrice: 120 })])!;
  assert.equal(saveDuplicateMessage(different), "Already in your collection: Desk (Acme), saved at a different price AED 120.00.");
  assert.equal(acceptDuplicateMessage(different), "You already have Desk (Acme).");
  const setup = findSetupDuplicate({ templateId: "t1", recipe: recipeA, specOverrides: { specification_edited: false, generated_specification_hash: "abc" } }, [setupRow("1")])!;
  assert.equal(saveDuplicateMessage(setup), "Already in your collection: Setup 1 (Interstuhl).");
  assert.equal(isIdenticalDuplicate(setup), true, "an equal setup is identical");
  assert.equal(saveDuplicateMessage({ ...custom, brand: "" }), "Already in your collection: Desk, same price.");
});

// ── Services: no write on a duplicate; the option only skips the warning ─────────────────────────────────────
type DupRow = Record<string, any>;
function dupFake(items: DupRow[], setups: DupRow[] = []) {
  const log = { inserts: 0, updates: 0 };
  let counter = 0;
  class Query {
    private filters: Array<(row: DupRow) => boolean> = [];
    private op: "select" | "insert" | "update" = "select";
    private payload: DupRow = {};
    constructor(private table: string) {}
    select() { return this; }
    insert(payload: DupRow) { this.op = "insert"; this.payload = payload; log.inserts += 1; return this; }
    update(payload: DupRow) { this.op = "update"; this.payload = payload; log.updates += 1; return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
    in() { return this; }
    order() { return this; }
    private run() {
      const rows = this.table === "saved_setups" ? setups : items;
      if (this.op === "insert") { const row = { id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`, ...this.payload }; rows.push(row); return [row]; }
      const matched = rows.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.op === "update") { matched.forEach((row) => Object.assign(row, this.payload)); return matched; }
      return matched.map((row) => ({ ...row }));
    }
    single() { return Promise.resolve({ data: this.run()[0] ?? null, error: null }); }
    maybeSingle() { return Promise.resolve({ data: this.run()[0] ?? null, error: null }); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve({ data: this.run(), error: null }).then(resolve, reject); }
  }
  return { client: { from: (table: string) => new Query(table) } as any, log };
}
const OWNER = "11111111-1111-4111-8111-111111111111";
const dbItem = (id: string, extra: DupRow = {}): DupRow => ({ id, owner_id: OWNER, brand_name: "Acme", item_name: "Desk", item_code: null, specification: null, unit_label: "Pc", selling_price: 100, currency: "AED", price_saved_at: "2026-01-01", created_at: "2026-01-01", last_used_at: null, use_count: 0, ...extra });
const goodInput = { brandName: "Acme", itemName: "Desk", sellingPrice: "100", currency: "AED" };

test("create custom item: warn mode returns the duplicate and WRITES NOTHING; without the option (confirmed) it writes once", async () => {
  const items = [dbItem("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")];
  const { client, log } = dupFake(items);
  const warned = await createCustomItemForUser(client, OWNER, { ...goodInput, brandName: "acme", itemName: "DESK" }, { warnOnDuplicate: true }) as any;
  assert.equal(warned.ok, false);
  assert.equal(warned.duplicate.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(warned.duplicate.samePrice, true);
  assert.equal(warned.error, "Already in your collection: Desk (Acme), same price.");
  assert.equal(log.inserts, 0);
  assert.equal(items.length, 1);
  const confirmed = await createCustomItemForUser(client, OWNER, goodInput) as any;
  assert.equal(confirmed.ok, true);
  assert.equal(log.inserts, 1, "written exactly once");
  assert.equal(items.length, 2);
  // a different price is still a warning, never a block
  const diff = await createCustomItemForUser(client, OWNER, { ...goodInput, sellingPrice: "250" }, { warnOnDuplicate: true }) as any;
  assert.equal(diff.duplicate.samePrice, false);
  assert.deepEqual(diff.duplicate.existingPrice, { currency: "AED", amount: 100 });
  // validation still runs first, flag or not
  assert.equal(((await createCustomItemForUser(client, OWNER, { ...goodInput, itemName: "" }, { warnOnDuplicate: true })) as any).duplicate, undefined);
  // another user's items are never looked at (the service reads only the owner's rows)
  const foreign = dupFake([dbItem("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { owner_id: "22222222-2222-4222-8222-222222222222" })]);
  assert.equal(((await createCustomItemForUser(foreign.client, OWNER, goodInput, { warnOnDuplicate: true })) as any).ok, true);
});

test("edit custom item: never its own duplicate; renaming it onto another item warns; 'update the existing' goes through the existing update", async () => {
  const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const idB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const items = [dbItem(idA), dbItem(idB, { item_name: "Chair" })];
  const { client, log } = dupFake(items);
  assert.equal(((await updateCustomItemForUser(client, OWNER, idA, { ...goodInput, sellingPrice: "120" }, { warnOnDuplicate: true })) as any).ok, true, "its own name is not a duplicate");
  assert.equal(log.updates, 1);
  const clash = await updateCustomItemForUser(client, OWNER, idB, { ...goodInput, itemName: "desk" }, { warnOnDuplicate: true }) as any;
  assert.equal(clash.ok, false);
  assert.equal(clash.duplicate.id, idA);
  assert.equal(log.updates, 1, "no write on the warning");
  assert.equal(items[1].item_name, "Chair");
  // "Update the existing one": the form calls the same update on the DUPLICATE's id with the new values
  assert.equal(((await updateCustomItemForUser(client, OWNER, idA, { ...goodInput, specification: "new spec", sellingPrice: "300" }, { warnOnDuplicate: true })) as any).ok, true);
  assert.equal(items[0].specification, "new spec");
  assert.equal(Number(items[0].selling_price), 300);
  assert.equal(items.length, 2, "no new row");
  // confirmed ("anyway") edit
  assert.equal(((await updateCustomItemForUser(client, OWNER, idB, { ...goodInput, itemName: "desk" })) as any).ok, true);
});

test("setup duplicate lookup: the caller's own live setups of the same product only; a read problem means no warning", async () => {
  const sameRecipe = { ...recipeA, template_id: "t1" };
  const rows = [
    { id: "s1", owner_id: OWNER, template_id: "t1", brand_name: "Interstuhl", product_name: "Every", setup_name: "Mine", recipe: sameRecipe, spec_overrides: {}, archived: false, created_at: "2026-02-01T00:00:00Z" },
    { id: "s2", owner_id: OWNER, template_id: "t1", brand_name: "I", product_name: "E", setup_name: "Old", recipe: sameRecipe, spec_overrides: {}, archived: true, created_at: "2026-02-01T00:00:00Z" },
    { id: "s3", owner_id: "22222222-2222-4222-8222-222222222222", template_id: "t1", brand_name: "I", product_name: "E", setup_name: "Theirs", recipe: sameRecipe, spec_overrides: {}, archived: false, created_at: "2026-02-01T00:00:00Z" },
  ];
  const { client } = dupFake([], rows);
  const found = await findSetupDuplicateForUser(client, OWNER, "t1", { ...sameRecipe, display: { main_code: "x" } }, {});
  assert.equal(found!.id, "s1");
  assert.equal(found!.name, "Mine");
  assert.ok(!("recipe" in (found as object)));
  assert.equal(await findSetupDuplicateForUser(client, OWNER, "t1", { ...sameRecipe, selections: { variant_row_id: "other" } }, {}), null);
  const broken = { from: () => { throw new Error("db down"); } } as any;
  assert.equal(await findSetupDuplicateForUser(broken, OWNER, "t1", sameRecipe, {}), null);
});

// ── Actions and screens ──────────────────────────────────────────────────────────────────────────────────────
test("custom item actions: the server warns unless the user confirmed; the flag only skips the warning", () => {
  const actions_ = read("./saved-custom-items-actions.ts");
  assert.match(actions_, /createCustomItem\(input: CustomItemSaveInput, options\?: \{ allowDuplicate\?: boolean \}\)/);
  assert.match(actions_, /createCustomItemForUser\(supabase, user\.id, pickInput\(input\), \{ warnOnDuplicate: options\?\.allowDuplicate !== true \}\)/);
  assert.match(actions_, /updateCustomItemForUser\(supabase, user\.id, String\(itemId \?\? ""\), pickInput\(input\), \{ warnOnDuplicate: options\?\.allowDuplicate !== true \}\)/);
  assert.equal((actions_.match(/await requireActiveUser\(\)/g) ?? []).length, 5, "still five authenticated actions");
  assert.doesNotMatch(actions_ + read("./duplicates.ts"), /createAdminClient|service[_-]?role|supabase\/admin/i);
  const service = read("./saved-custom-items-service.ts");
  assert.match(service, /if \(options\.warnOnDuplicate\) \{\s*const duplicate = findCustomDuplicate/);
  assert.ok(service.indexOf("validateCustomItem(input)") < service.indexOf("findCustomDuplicate("), "validation runs before the duplicate check");
});

test("setup save: a read-only server pre-check; the existing saveSetup action is unchanged; no update path exists for setups", () => {
  const listActions = read("./saved-setups-list-actions.ts");
  const check = listActions.slice(listActions.indexOf("export async function checkSetupDuplicate"));
  assert.match(check, /const \{ user \} = await requireActiveUser\(\);/);
  assert.match(check, /findSetupDuplicateForUser\(supabase, user\.id, input\.templateId, recipe, specOverrides\)/);
  assert.doesNotMatch(check, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/, "the pre-check writes nothing");
  assert.doesNotMatch(check, /createAdminClient|service[_-]?role/i);
  assert.ok(!read("./actions.ts").includes("duplicate"), "saveSetup itself is untouched");
  assert.ok(!/recipe\s*[,}]\s*\}\s*;?\s*$/m.test(check), "the recipe is not returned");
  assert.match(check, /return \{ ok: true, duplicate: await findSetupDuplicateForUser/);
  // the screen: check first, save only when nothing was found or the user chose to go on
  assert.match(saveButton, /const check = await checkSetupDuplicate\(\{ templateId, state \}\);/);
  assert.match(saveButton, /function submit\(anyway = false\)/);
  assert.match(saveButton, /if \(!anyway\) \{[\s\S]*?setDuplicate\(check\.duplicate\);\s*return;/);
  assert.match(saveButton, /await saveSetup\(\{ templateId, setupName: name, state \}\)/);
  assert.match(saveButton, /onClick=\{\(\) => submit\(\)\}/, "the click event is never passed as the 'anyway' flag");
  assert.match(saveButton, /label: "Save as new anyway"/);
  assert.match(saveButton, /label: "Cancel"/);
  assert.doesNotMatch(saveButton, /Update the existing/, "a setup has no update path today");
});

test("accept actions: the duplicate check runs on the server before any copy or write and returns data, not the recipe", () => {
  const sa = read("./shares-actions.ts");
  const custom = sa.slice(sa.indexOf("export async function acceptCustomItemShareAction"), sa.indexOf("async function listCustomItemsForUserSafe"));
  assert.ok(custom.indexOf("findCustomDuplicate(") < custom.indexOf("copyIncomingPictureForAccept("), "no picture copy before the check");
  assert.ok(custom.indexOf("findCustomDuplicate(") < custom.indexOf("acceptCustomItemShare(supabase"), "no write before the check");
  assert.match(custom, /raw\.allowDuplicate !== true && raw\.allowDuplicate !== "true" && raw\.allowDuplicate !== "1"/);
  assert.match(sa, /return \{ ok: false, message: acceptDuplicateMessage\(duplicate\), duplicate \};/);
  const setup = sa.slice(sa.indexOf("export async function acceptSetupShareAction"), sa.indexOf("async function setupDuplicateForShare"));
  assert.ok(setup.indexOf("setupDuplicateForShare(") < setup.indexOf("acceptSetupShare(supabase"));
  assert.match(setup, /input\.allowDuplicate !== true/);
  assert.equal((sa.match(/^export async function/gm) ?? []).length, 9, "no new action in the shares file");
  assert.doesNotMatch(sa, /createAdminClient|service[_-]?role|supabase\/admin/i);
});

test("ONE warning component is used on every screen, with the right buttons", () => {
  assert.match(duplicateShared, /export function DuplicateWarning\(\{ message, choices, busy = false \}/);
  assert.match(duplicateShared, /role="alert"/);
  const form = read("../../../components/products/my-collection-custom-items.tsx");
  // 1. custom item form (page, popup, "Save as custom item" popup all render CustomItemForm)
  assert.match(form, /import \{ DuplicateWarning, PanelBackBar \} from "@\/components\/products\/my-collection-shared";/);
  assert.match(form, /<DuplicateWarning\s+message=\{saveDuplicateMessage\(duplicate\.info\)\}/);
  for (const label of ["Save as new anyway", "Update the existing one", "Cancel", "Save anyway"]) assert.ok(form.includes(`label: "${label}"`), label);
  assert.match(form, /choices=\{item\s*\? \[\s*\{ label: "Save anyway"/, "editing: no 'update the existing'");
  assert.match(form, /mode === "update" && duplicate\s*\? await updateCustomItem\(duplicate\.info\.id, payload\)/, "the existing update action");
  assert.match(form, /createCustomItem\(payload, \{ allowDuplicate: true \}\)/);
  assert.match(form, /updateCustomItem\(item\.id, payload, \{ allowDuplicate: true \}\)/);
  assert.match(form, /duplicate\.key === duplicateKey/, "the warning hides if the form changes");
  assert.match(form, /if \(result\.duplicate\) \{[\s\S]*?setDuplicate\(\{ info: result\.duplicate, key: duplicateKey \}\);\s*return;/);
  const popupSave = read("../../../components/quotations/save-as-custom-item-button.tsx");
  assert.match(popupSave, /<CustomItemForm /, "'Save as custom item' uses the same form");
  assert.match(read("../../../components/quotations/custom-item-picker-pane.tsx"), /<CustomItemForm/, "the popup panel uses the same form");
  // 2. save a configured line / setup
  assert.match(saveButton, /import \{ DuplicateWarning \} from "@\/components\/products\/my-collection-shared";/);
  assert.match(saveButton, /<DuplicateWarning\s+message=\{saveDuplicateMessage\(duplicate\)\}/);
  // 3. accepting a share: Add now, Review & edit (custom item and setup)
  assert.equal((duplicateShared.match(/<DuplicateWarning\s/g) ?? []).length, 3, "Add now, review custom item, review setup");
  assert.equal((duplicateShared.match(/label: "Add anyway"/g) ?? []).length, 3);
  assert.equal((duplicateShared.match(/label: "Skip \\u2014 don't add"/g) ?? []).length, 3);
  assert.equal((duplicateShared.match(/label: "Cancel"/g) ?? []).length, 3);
  assert.equal((duplicateShared.match(/highlighted: isIdenticalDuplicate\(/g) ?? []).length, 3, "Skip is the highlighted default for an identical item");
  assert.match(duplicateShared, /\{ label: "Skip \\u2014 don't add", onClick: \(\) => dismiss\(share\)/, "Skip uses the existing dismiss");
  assert.match(duplicateShared, /onSkip=\{\(\) => dismiss\(share\)\}/);
  assert.match(duplicateShared, /if \(allowDuplicate\) form\.set\("allowDuplicate", "true"\);/);
  assert.match(duplicateShared, /else if \(result\.duplicate\) setDupe\(\{ shareId: share\.id, info: result\.duplicate \}\)/);
  assert.equal((duplicateShared.match(/allowDuplicate: true/g) ?? []).length, 3, "only the confirmed calls carry the flag: Add now (custom item and setup) and the setup review");
  assert.match(duplicateShared, /if \(busyRef\.current\) return; \/\/ one action at a time/, "a double click cannot add twice");
  // the quote popup renders the same shared tab, so it shows the same warning
  assert.match(popup, /<SharedWithYouTab/);
  // no recipe or other user's price anywhere in the shared shape
  assert.doesNotMatch(read("./duplicates.ts"), /recipe:\s*unknown;\s*\}\s*\n\nexport type DuplicateInfo/);
});
