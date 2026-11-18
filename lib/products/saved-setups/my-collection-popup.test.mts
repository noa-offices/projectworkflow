import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONFIGURED_PAGE_SIZE,
  CONFIGURED_RECENT_LIMIT,
  brandsWithCounts,
  filterConfigured,
  groupByBrandProduct,
  hasActiveFilters,
  productsForBrand,
  recentlyUsed,
  showMoreSlice,
  sortSetups,
  type CollectionDisplayItem,
} from "./collection-view";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const popup = read("../../../components/quotations/add-from-my-collection-button.tsx");
const pane = read("../../../components/quotations/custom-item-picker-pane.tsx");
const list = read("../../../components/products/my-collection-list.tsx");
const custom = read("../../../components/products/my-collection-custom-items.tsx");
const escape = read("../../../components/products/escape-layer.tsx");
const tabs = read("../../../components/products/my-collection-tabs.tsx");

const setup = (id: string, brandName: string, productName: string, setupName: string, extra: Partial<CollectionDisplayItem> = {}): CollectionDisplayItem => ({ id, brandName, productName, setupName, createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, useCount: 0, ...extra });
const data = [
  setup("1", "Interstuhl", "Every", "Every white", { createdAt: "2026-03-01T00:00:00Z", lastUsedAt: "2026-05-01T00:00:00Z", code: "EV-100" }),
  setup("2", "Interstuhl", "Buddy", "Buddy blue", { createdAt: "2026-02-01T00:00:00Z" }),
  setup("3", "Interstuhl", "Every", "Every black", { createdAt: "2026-04-01T00:00:00Z", lastUsedAt: "2026-06-01T00:00:00Z" }),
  setup("4", "Vitra", "Alcove", "Alcove sofa", { createdAt: "2026-01-15T00:00:00Z" }),
  setup("5", "Acme", "Desk", "Standing desk"),
];

// ── Pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────
test("brandsWithCounts: each brand with its setup count, A-Z", () => {
  assert.deepEqual(brandsWithCounts(data), [{ name: "Acme", count: 1 }, { name: "Interstuhl", count: 3 }, { name: "Vitra", count: 1 }]);
  assert.deepEqual(brandsWithCounts([]), []);
});

test("productsForBrand: the products of one brand with counts, A-Z; none for no brand or an unknown brand", () => {
  assert.deepEqual(productsForBrand(data, "Interstuhl"), [{ name: "Buddy", count: 1 }, { name: "Every", count: 2 }]);
  assert.deepEqual(productsForBrand(data, "Vitra"), [{ name: "Alcove", count: 1 }]);
  assert.deepEqual(productsForBrand(data, null), []);
  assert.deepEqual(productsForBrand(data, "Nope"), []);
});

test("filterConfigured: brand, product, and search over name / product / brand / code, case-insensitive, combinable", () => {
  const ids = (filter: Parameters<typeof filterConfigured>[1]) => filterConfigured(data, filter).map((item) => item.id);
  assert.deepEqual(ids({}), ["1", "2", "3", "4", "5"], "no filter keeps everything in order");
  assert.deepEqual(ids({ brand: "Interstuhl" }), ["1", "2", "3"]);
  assert.deepEqual(ids({ brand: "Interstuhl", product: "Every" }), ["1", "3"]);
  assert.deepEqual(ids({ product: "Every" }), ["1", "3"]);
  assert.deepEqual(ids({ query: "BLUE" }), ["2"], "setup name, case-insensitive");
  assert.deepEqual(ids({ query: "alcove" }), ["4"], "product name");
  assert.deepEqual(ids({ query: "vitra" }), ["4"], "brand");
  assert.deepEqual(ids({ query: "ev-100" }), ["1"], "code (when the item carries one)");
  assert.deepEqual(ids({ query: "  every  " }), ["1", "3"], "query is trimmed");
  assert.deepEqual(ids({ brand: "Interstuhl", product: "Every", query: "black" }), ["3"], "combined filters");
  assert.deepEqual(ids({ brand: "Vitra", query: "every" }), []);
  assert.deepEqual(ids({ query: "zzz" }), []);
});

test("sorting and recently used reuse the shared helpers", () => {
  assert.deepEqual(sortSetups(data, "name").map((item) => item.setupName), ["Alcove sofa", "Buddy blue", "Every black", "Every white", "Standing desk"]);
  assert.deepEqual(sortSetups(data, "newest").map((item) => item.id).slice(0, 2), ["3", "1"]);
  assert.deepEqual(sortSetups(data, "recent").map((item) => item.id).slice(0, 2), ["3", "1"], "used ones first, latest use first");
  assert.deepEqual(recentlyUsed(data, CONFIGURED_RECENT_LIMIT).map((item) => item.id), ["3", "1"], "only setups that were used");
  const many = Array.from({ length: 10 }, (_, i) => setup(`u${i}`, "B", "P", `Setup ${i}`, { lastUsedAt: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
  assert.equal(recentlyUsed(many, CONFIGURED_RECENT_LIMIT).length, 6, "up to 6");
  assert.equal(CONFIGURED_RECENT_LIMIT, 6);
  assert.deepEqual(groupByBrandProduct(sortSetups(filterConfigured(data, { brand: "Interstuhl" }), "name")).map((group) => [group.brandName, group.products.map((product) => product.productName)]), [["Interstuhl", ["Buddy", "Every"]]]);
});

test("showMoreSlice: first 12, then Show more (N more)", () => {
  const fifteen = Array.from({ length: 15 }, (_, i) => i);
  assert.equal(CONFIGURED_PAGE_SIZE, 12);
  const first = showMoreSlice(fifteen, CONFIGURED_PAGE_SIZE);
  assert.equal(first.visible.length, 12);
  assert.equal(first.remaining, 3);
  const all = showMoreSlice(fifteen, CONFIGURED_PAGE_SIZE + CONFIGURED_PAGE_SIZE);
  assert.deepEqual([all.visible.length, all.remaining], [15, 0]);
  assert.deepEqual(showMoreSlice([], 12), { visible: [], remaining: 0 });
  assert.deepEqual(showMoreSlice(fifteen, -3).visible, []);
});

test("hasActiveFilters: a brand, a product or a non-blank search", () => {
  assert.equal(hasActiveFilters({}), false);
  assert.equal(hasActiveFilters({ query: "   " }), false);
  assert.equal(hasActiveFilters({ brand: "A" }), true);
  assert.equal(hasActiveFilters({ product: "P" }), true);
  assert.equal(hasActiveFilters({ query: "x" }), true);
});

// ── Popup: size, layout, one modal, Escape ───────────────────────────────────────────────────────────────────
test("popup size: up to min(1200px, 94vw) wide and 90vh tall, full screen on phones, fixed header and scrolling body", () => {
  assert.match(popup, /sm:w-\[min\(1200px,94vw\)\]/);
  assert.match(popup, /sm:max-w-\[1200px\]/);
  assert.match(popup, /sm:h-\[90vh\]/);
  assert.match(popup, /p-0 sm:items-center sm:p-\[3vw\]/, "no padding around it on phones");
  assert.match(popup, /flex h-full w-full flex-col overflow-hidden/, "full screen below sm");
  assert.match(popup, /sticky top-0/);
  assert.match(popup, /min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden/, "body scrolls (side by side on wide screens)");
  assert.doesNotMatch(popup, /max-w-\[880px\]/);
});

test("single modal: one dialog only; the edit form is an inline panel (aside), never a second fixed overlay", () => {
  assert.equal((popup.match(/role="dialog"/g) ?? []).length, 1);
  for (const [name, source] of [["pane", pane], ["list", list], ["custom items", custom]] as const) {
    assert.doesNotMatch(source, /role="dialog"|fixed inset-0|aria-modal/, `${name} opens no modal`);
  }
  assert.match(pane, /<aside aria-label=\{panel\.mode === "add" \? "Add custom item" : "Edit custom item"\}/);
  assert.match(pane, /lg:w-\[460px\] lg:shrink-0 lg:border-l/, "right-hand panel on wide screens");
  assert.match(pane, /\$\{panel \? "hidden lg:block" : ""\}/, "full-width panel on narrow screens");
  assert.match(pane, /<CustomItemForm[\s\S]*onDone=\{\(\) => setPanel\(null\)\}/);
});

test("Escape closes the innermost open thing first, the popup only when nothing inside is open", () => {
  assert.match(popup, /event\.key === "Escape"[\s\S]{0,80}if \(!closeTop\(\)\) setOpen\(false\)/);
  assert.match(popup, /document\.addEventListener\("keydown", onKey\)/);
  assert.match(popup, /<EscapeLayerProvider value=\{layers\}>/);
  assert.match(escape, /export function useEscapeLayer\(active: boolean, close: \(\) => void\)/);
  assert.match(escape, /stack\.current\[stack\.current\.length - 1\]/, "the innermost layer first");
  // inner pieces register while open: rename, delete confirm, removed-clear confirm, brand rename, the form
  assert.match(list, /useEscapeLayer\(editing, cancelRename\)/);
  assert.match(list, /useEscapeLayer\(confirmingDelete, \(\) => setConfirmingDelete\(false\)\)/);
  assert.match(list, /useEscapeLayer\(confirmingClear, \(\) => setConfirmingClear\(false\)\)/);
  assert.match(custom, /useEscapeLayer\(true, cancel\)/);
  assert.match(custom, /useEscapeLayer\(open, \(\) => setOpen\(false\)\)/);
  assert.match(custom, /useEscapeLayer\(confirmingDelete, \(\) => setConfirmingDelete\(false\)\)/);
  // the rename inputs handle their own Escape without closing the popup
  assert.match(list, /event\.key === "Escape"\) \{ event\.stopPropagation\(\); actions\.cancelRename\(\); \}/);
  assert.match(custom, /event\.key === "Escape"\) \{ event\.stopPropagation\(\); setOpen\(false\); \}/);
});

// ── Controls inside the popup ────────────────────────────────────────────────────────────────────────────────
test("Configured tab: Rename and two-step Delete on each card, Removed products with Clear removed, shared with the page", () => {
  assert.match(popup, /<SetupActionRow item=\{item\} actions=\{actions\} extra=\{<ShareControl kind="setup" itemId=\{item\.id\} itemName=\{item\.setupName\} \/>\} \/>/);
  assert.match(popup, /useSetupActions\(item, onMessage, callbacks\)/);
  assert.match(popup, /<RemovedProducts items=\{removed\}/);
  assert.match(popup, /onCleared=\{\(\) => setRemoved\(\[\]\)\}/);
  assert.match(popup, /from "@\/components\/products\/my-collection-list"/);
  for (const text of ["Rename", "Delete", "Confirm delete", "Keep", "Removed products (", "Clear removed", "Yes, clear", "These products are no longer available. You can clear them from here."]) assert.ok(list.includes(text), text);
  assert.match(list, /renameSetup\(item\.id, name\)/);
  assert.match(list, /deleteSetup\(item\.id\)/);
  assert.match(list, /clearRemovedSetups\(\)/);
  assert.match(list, /event\.key === "Enter"\) actions\.submitRename\(\)/, "Enter saves a rename");
  // the page still uses the same pieces
  assert.match(list, /function SetupCard[\s\S]*useSetupActions\(item, onMessage, callbacks\)/);
  assert.match(list, /<RemovedProducts items=\{removedItems\} onMessage=\{setMessage\} \/>/);
  assert.match(tabs, /<MyCollectionList items=\{items\} \/>/);
});

test("Configured filters: brand column with counts, product list under a brand, search, sort, Recently used, Show more, Clear filters, empty states", () => {
  assert.match(popup, /<ConfiguredFilterColumn/);
  for (const text of ["All brands", "All products", "aria-pressed"]) assert.ok(list.includes(text), text);
  assert.match(popup, /brandsWithCounts\(setups \?\? \[\]\)/);
  assert.match(popup, /productsForBrand\(setups \?\? \[\], activeBrand\)/);
  assert.match(popup, /filterConfigured\(setups \?\? \[\], \{ brand: activeBrand, product: activeProduct, query: search \}\)/);
  assert.match(popup, /COLLECTION_SORT_OPTIONS\.map/);
  assert.match(popup, /recentlyUsed\(setups \?\? \[\], CONFIGURED_RECENT_LIMIT\)/);
  assert.match(popup, /\(searching \|\| activeBrand \? \[\] :/, "Recently used only with no search and All brands");
  assert.match(popup, /showMoreSlice\(entry\.setups, limit\)/);
  assert.match(popup, /Show more \(\{remaining\} more\)/);
  assert.match(popup, /Clear filters/);
  assert.match(popup, /No setup matches your search or filters\./);
  assert.match(popup, /No saved setups yet\. Save a configured product from the Product Library and it appears here\./);
  assert.match(popup, /md:w-64 md:shrink-0/, "column beside the list on wide screens; stacked on phones");
  assert.match(popup, /<SetupThumbnail path=\{item\.imagePath\}/, "thumbnails kept");
  assert.doesNotMatch(popup.replace(/Prices are recalculated from the current price lists\./, ""), /unit_price|net_price|currency|formatMoney|sellingPrice/i, "no prices on configured cards");
});

test("Custom items tab: + Add custom item, Edit, two-step Delete, Rename brand, Clear filters, all inside the popup", () => {
  assert.match(pane, /\+ Add custom item/);
  assert.match(pane, /setPanel\(\{ mode: "add" \}\)/);
  assert.match(pane, /setPanel\(\{ mode: "edit", item \}\)/);
  assert.match(pane, /<CustomItemActionRow item=\{item\}/);
  assert.match(pane, /<RenameBrand/);
  assert.match(pane, /Clear filters/);
  assert.match(pane, /from "@\/components\/products\/my-collection-custom-items"/);
  for (const text of ["Confirm delete", "Keep", "Edit", "Delete"]) assert.ok(custom.includes(text), text);
  assert.match(custom, /deleteCustomItem\(item\.id\)/);
  assert.match(custom, /renameCustomBrand\(brand, name\)/);
  assert.match(custom, /createCustomItem\(payload\)/);
  assert.match(custom, /updateCustomItem\(item\.id, payload\)/);
  // same form (validator, brand combobox, picture upload) as the page
  assert.match(custom, /<BrandCombobox/);
  assert.match(custom, /await compressToWebp\(file\)/);
  assert.match(custom, /function CustomItemCard[\s\S]*<CustomItemActionRow/);
  // list refreshes after any change without closing the popup
  assert.match(pane, /function reload\(\)/);
  assert.match(pane, /onDeleted=\{reload\}/);
  assert.match(pane, /onSaved=\{\(\) => \{ setPanel\(null\); reload\(\); \}\}/);
  assert.match(pane, /reload\(\);\s*\}\}\s*\/>/, "rename brand reloads");
});

test("card action buttons never trigger the add: separate buttons that stop the click", () => {
  assert.match(list, /const stop = \(run: \(\) => void\) => \(event: \{ stopPropagation: \(\) => void \}\) => \{ event\.stopPropagation\(\); run\(\); \};/);
  assert.match(custom, /const stop = \(run: \(\) => void\) => \(event: \{ stopPropagation: \(\) => void \}\) => \{ event\.stopPropagation\(\); run\(\); \};/);
  // the card body button is a sibling of the action row, never its parent
  const card = popup.slice(popup.indexOf("function SetupPickCard"), popup.indexOf("export function AddFromMyCollectionButton"));
  assert.ok(card.indexOf("</button>") < card.indexOf("<SetupActionRow"), "body button closes before the action row");
  assert.equal((card.match(/<button/g) ?? []).length, 1, "one body button; the action buttons come from SetupActionRow");
  const paneCard = pane.slice(pane.indexOf("function CustomPickCard"), pane.indexOf("export function CustomItemPickerPane"));
  assert.ok(paneCard.indexOf("</button>") < paneCard.indexOf("<CustomItemActionRow"));
  assert.equal((paneCard.match(/<button/g) ?? []).length, 1);
});

test("header: secondary 'Open My Collection page' link, nothing essential needs it", () => {
  assert.equal((popup.match(/href="\/products\/my-collection"/g) ?? []).length, 2, "one link for wide screens, one inside the toolbar on phones");
  assert.match(popup, /Open My Collection page/);
  assert.doesNotMatch(popup, /Manage My Collection/);
});

test("the add flow is unchanged: load, hand over, close, then mark used, in that order; custom add and mark-used untouched", () => {
  const choose = popup.slice(popup.indexOf("function choose(id: string)"), popup.indexOf("// After a rename or delete"));
  const order = ["await loadSetupForReplay(id)", "onChoose(result.setup)", "setOpen(false);", "void markSetupUsed(id).catch(() => undefined)"].map((text) => choose.indexOf(text));
  assert.ok(order.every((index) => index >= 0) && [...order].sort((a, b) => a - b).join() === order.join(), "order kept");
  assert.ok(popup.includes("setSetups(await listPickerSetups());"));
  assert.match(pane, /const note = target\.onAdd\(item\);/);
  assert.match(pane, /void markCustomItemUsed\(item\.id\)\.catch\(\(\) => undefined\);/);
  assert.match(pane, /await addCustomItemToQuotation\(form\)/);
  assert.match(pane, /form\.set\("custom_item_id", item\.id\)/);
  assert.match(pane, /router\.refresh\(\);/);
});

test("actions: only the existing ones, plus one read-only list for Removed products; authenticated, no admin client", () => {
  const listActions = read("./saved-setups-list-actions.ts");
  assert.match(listActions, /^"use server";/);
  assert.equal((listActions.match(/await requireActiveUser\(\)/g) ?? []).length, 2, "listRemovedSetups and (PR 7) the read-only checkSetupDuplicate");
  assert.match(listActions, /listSetupsForUser\(supabase, user\.id, \{ withImages: false \}\)\)\.filter\(\(item\) => !item\.usable\)/);
  assert.equal((listActions.match(/export async function/g) ?? []).length, 2);
  // the existing action files are unchanged: no new action was added to them
  assert.equal((read("./actions.ts").match(/^export async function/gm) ?? []).length, 7);
  assert.equal((read("./saved-custom-items-actions.ts").match(/^export async function/gm) ?? []).length, 5);
  for (const [name, source] of [["popup", popup], ["pane", pane], ["list", list], ["custom", custom], ["escape", escape], ["list actions", listActions]] as const) {
    assert.ok(!/service[_-]?role|createAdmin|supabase\/admin|SUPABASE_SERVICE/i.test(source), `${name}: no admin client`);
  }
  assert.ok(!/@\/lib\/supabase/.test(popup + pane + list + custom + escape), "no Supabase client in the components");
  const imported = (source: string) => Array.from(source.matchAll(/import \{([^}]*)\} from "@\/lib\/products\/saved-setups\/(actions|saved-custom-items-actions|saved-custom-brands-actions|saved-setups-list-actions)"/g)).flatMap((match) => match[1].split(",").map((name) => name.trim()).filter(Boolean));
  const allowed = new Set(["renameSetup", "deleteSetup", "clearRemovedSetups", "listPickerSetups", "loadSetupForReplay", "markSetupUsed", "listRemovedSetups", "createCustomItem", "updateCustomItem", "deleteCustomItem", "renameCustomBrand", "listCustomItems", "markCustomItemUsed"]);
  for (const name of [...imported(popup), ...imported(pane), ...imported(list), ...imported(custom)]) assert.ok(allowed.has(name), name);
});

test("diff guard: replay, recipe, the selector, pricing, migrations, package files and picture code are untouched; at most 12 files", () => {
  let diff: string[];
  try {
    const root = new URL("../../../", import.meta.url);
    const run = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const base = run(["merge-base", "HEAD", "origin/main"]).trim();
    diff = [...run(["diff", "--name-only", base]).split("\n"), ...run(["ls-files", "--others", "--exclude-standard"]).split("\n")].map((line) => line.trim()).filter(Boolean);
  } catch {
    return;
  }
  for (const forbidden of [
    "lib/products/saved-setups/replay.ts", "lib/products/saved-setups/recipe.ts", "lib/products/saved-setups/actions.ts",
    "package.json", "package-lock.json",
    "lib/products/saved-setups/custom-item-image.ts", "lib/products/saved-setups/custom-item-image-sharp.ts", "lib/images/compress-custom-item-image.ts", "lib/products/saved-setups/saved-custom-images-actions.ts",
    "app/quotations/actions.ts",
  ]) assert.ok(!diff.includes(forbidden), `${forbidden} must have an empty diff`);
  assert.ok(!diff.some((file) => /^lib\/(quotations|pricing|noa)\//.test(file)));
  assert.ok(diff.length <= 12, `at most 12 files change (${diff.length})`);
});
