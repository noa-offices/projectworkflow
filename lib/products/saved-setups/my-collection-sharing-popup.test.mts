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
  for (const forbidden of ["lib/products/saved-setups/shares-actions.ts", "lib/products/saved-setups/shares-service.ts", "lib/products/saved-setups/shares-picture.ts", "lib/notifications/actions.ts", "components/quotations/product-library-selector.tsx", "package.json", "app/quotations/actions.ts"]) {
    assert.ok(!diff.includes(forbidden), `${forbidden} must have an empty diff`);
  }
  assert.ok(diff.length <= 12, `at most 12 files change (${diff.length})`);
});
