import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("../../../app/products/gallery/page.tsx");
const browser = read("../../../components/products/product-gallery-browser.tsx");
const dialogs = read("../../../components/products/product-gallery-dialogs.tsx");
const detailDialog = read("../../../components/products/product-gallery-detail-dialog.tsx");
const service = read("./gallery-service.ts");
const actionsSource = read("./gallery-actions.ts");
const sidebar = read("../../../components/layout/erp-sidebar.tsx");
const view = read("./gallery-view.ts");
const code = (text: string) => text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n");

test("the page checks the capabilities FIRST and shows a short message when the user cannot view", () => {
  assert.match(page, /await requireActiveUser\(\)/);
  assert.ok(page.indexOf("requireActiveUser()") < page.indexOf("getGalleryCapabilitiesAction()"), "sign-in check, then capabilities");
  assert.ok(page.indexOf("getGalleryCapabilitiesAction()") < page.indexOf("<ProductGalleryBrowser"), "capabilities before the browser");
  assert.match(page, /canView \? \(\s*<ProductGalleryBrowser/);
  assert.match(page, /You do not have access to the gallery\./);
  assert.match(page, /Configured products that your company has quoted\. They grow by themselves\./);
  assert.match(page, /title="Product Gallery"/);
  assert.match(page, /searchParams: Promise</, "this Next.js version passes searchParams as a Promise");
});

test("no price, discount or cost word is rendered or typed anywhere on the page or its components", () => {
  for (const [name, text] of Object.entries({ page, browser, dialogs, view, detailDialog })) {
    assert.doesNotMatch(code(text), /price|discount|\bcost\b|\btotal_|net_?price|list_?price|selling/i, name);
  }
});

test("the page never uses a recipe, an admin client or the add-for-quote action", () => {
  for (const [name, text] of Object.entries({ page, browser, dialogs, detailDialog })) {
    assert.doesNotMatch(code(text), /recipe|getGalleryItemForAdd|createAdminClient|supabase\/admin|service_role|createClient|from\("/i, name);
    assert.doesNotMatch(code(text), /Add to quot|Add to quote|openSetupFromCollection/i, `${name}: no Add button on this page`);
  }
});

test("edit mode: one Edit/Done toggle for editors only; cards are clean until it is on; merge only for curators", () => {
  assert.match(page, /canEdit = capabilities\.ok && capabilities\.canView && capabilities\.canEdit/);
  assert.match(page, /canCurate = capabilities\.ok && capabilities\.canView && capabilities\.canCurate/);
  assert.match(page, /<ProductGalleryBrowser canEdit=\{canEdit\} canCurate=\{canCurate\}/);
  assert.match(browser, /const \[editMode, setEditMode\] = useState\(false\)/, "off by default, React state only");
  assert.doesNotMatch(code(browser), /localStorage|sessionStorage|document\.cookie/, "never saved");
  assert.match(browser, /const editing = canEdit && editMode/);
  assert.match(browser, /\{canEdit \? \(\s*<div className="flex justify-end">\s*<button[\s\S]*?\{editing \? "Done" : "Edit"\}/, "the toggle is only for editors and says Done while on");
  // The card buttons sit inside the editMode branch; Merge is inside a canCurate branch inside it.
  const card = browser.slice(browser.indexOf("function GalleryCard"), browser.indexOf("function Skeleton"));
  const editBranch = card.indexOf("{editMode ? (");
  assert.ok(editBranch > 0, "an edit-mode branch exists on the card");
  assert.ok(card.indexOf(">Edit</button>") > editBranch, "Edit only inside the edit-mode branch");
  assert.ok(card.indexOf('"Unhide" : "Hide"') > editBranch, "Hide / Unhide only inside the edit-mode branch");
  assert.ok(card.indexOf("{canCurate ? <button") > editBranch, "Merge is behind canCurate inside the edit-mode branch");
  assert.ok(card.indexOf("Merge into...") > card.indexOf("{canCurate ? <button"));
  assert.match(browser, /includeHidden: editing/, "hidden items are listed only in edit mode");
  assert.match(browser, /item\.isHidden \? "opacity-60" : ""/, "hidden items are dimmed");
  assert.match(browser, /editing && dialog\?\.kind === "edit"/);
  assert.match(browser, /editing && dialog\?\.kind === "hide"/);
  assert.match(browser, /editing && canCurate && dialog\?\.kind === "merge"/);
  assert.doesNotMatch(code(browser), /Show hidden|showHidden/, "no separate hidden toggle any more");
});

test("hide asks first (Hidden items are not shown to staff) and merge explains the effect; edit uses the gallery action", () => {
  assert.match(dialogs, /Hidden items are not shown to staff\./);
  assert.match(dialogs, /Counts are added and this item is removed\./);
  assert.match(dialogs, /mergeGalleryItemsAction\(\{ fromId: item\.id, toId: target\.id \}\)/);
  assert.match(dialogs, /updateGalleryItemDetailsAction\(/);
  assert.match(browser, /setGalleryItemHiddenAction\(\{ id: item\.id, hidden \}\)/);
});

test("merge is limited to the SAME template: candidates are filtered by template id before they are shown", () => {
  assert.match(dialogs, /mergeCandidates\(found, item\)/);
  assert.match(view, /item\.templateId !== source\.templateId/);
  assert.match(dialogs, /includeHidden: true/);
  assert.match(dialogs, /Only other items of the same product are listed\./);
  // The only items the merge buttons can send are the candidates list entries.
  assert.match(dialogs, /candidates\.map\(\(candidate\) =>[\s\S]*?setTarget\(candidate\)/);
});

test("the filters are kept in the URL query string and the server passes the parsed state in", () => {
  assert.match(browser, /history\.replaceState\(/);
  assert.match(browser, /buildGalleryQuery\(state\)/);
  assert.match(page, /parseGalleryQuery\(\(key\) => params\[key\]\)/);
  assert.match(browser, /initialState/);
});

test("the filters are separate: Category, Sub-category (never disabled, all of them) and Tag are their own selects", () => {
  for (const label of ["Brand", "Category", "Sub-category", "Tag", "Currency", "Sort by"]) assert.match(browser, new RegExp(`aria-label=\\{?"?${label}|label="${label}"`));
  assert.match(browser, /aria-label=\{label\}/, "the select helper labels every select");
  assert.match(browser, /<Select label="Sub-category" value=\{state\.subCategoryId\} onChange=\{\(value\) => change\(\{ subCategoryId: value \}\)\}>/, "choosing a sub-category changes only the sub-category");
  assert.match(browser, /<Select label="Category" value=\{state\.categoryId\} onChange=\{\(value\) => change\(\{ categoryId: value \}\)\}>/, "choosing a category does not reset the sub-category");
  assert.match(browser, /<Select label="Tag" /);
  assert.match(browser, /filters\.subCategories\.map\(\(entry\) => <option[^\n]*subCategoryLabel\(entry, filters\.subCategories\)/, "ALL sub-categories");
  assert.doesNotMatch(code(browser), /disabled=\{!state\.categoryId\}|subCategoriesFor|withGalleryCategory/, "no longer tied to the category");
  assert.doesNotMatch(code(browser), /aria-pressed=\{active\}/, "no tag chip bar in the toolbar any more");
});

test("the toolbar reuses the Product Library styles; search, Clear filters, count, Load more, phone Filters button", () => {
  assert.match(browser, /from "@\/components\/products\/product-toolbar-styles"/);
  assert.match(browser, /aria-label="Search the gallery"/);
  assert.match(browser, /filterOptionLabel\(/);
  assert.match(browser, /Clear filters/);
  assert.match(browser, /showingText\(items\.length, total\)/);
  assert.match(browser, /@xl:hidden/, "the Filters button shows only on narrow content");
  assert.match(browser, /aria-expanded=\{filtersOpen\}/);
  assert.match(browser, /Load more/);
  assert.doesNotMatch(code(browser), /IntersectionObserver|onScroll/, "a button, not infinite scroll");
  assert.match(browser, /min-\[480px\]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5/, "denser grid: 1-2, 3, 4 and 5 columns");
});

test("every state is there: loading skeleton, empty, empty after a filter, and a failure with Retry", () => {
  assert.match(browser, /data-testid="gallery-skeleton"/);
  assert.match(browser, /The gallery is empty\. Products appear here when a quotation that uses them is sent or confirmed\./);
  assert.match(browser, /No products match\./);
  assert.match(browser, />Retry</);
});

test("cards show the agreed facts: Category and Sub-category as two separate labels, no joined string", () => {
  assert.match(browser, /SetupThumbnail path=\{item\.picture\?\.kind === "template" \? item\.picture\.path : null\}/);
  assert.match(browser, /quotedText\(item\.quotedCount\)/);
  assert.match(browser, /\{item\.categoryName \? <span[^\n]*title="Category">\{item\.categoryName\}<\/span>/);
  assert.match(browser, /\{item\.subCategoryName \? <span[^\n]*title="Sub-category">\{item\.subCategoryName\}<\/span>/);
  assert.doesNotMatch(code(browser), /categoryLine/);
  assert.match(browser, /No longer available/);
  assert.match(browser, />Hidden</);
  assert.match(browser, />Details</);
  assert.doesNotMatch(browser, /View product|productLibraryHref|\/products\?template=|next\/link/, "the link that left the gallery is gone");
});

test("dialogs are labelled modals that close on Escape", () => {
  assert.match(dialogs, /role="dialog"/);
  assert.match(dialogs, /aria-modal="true"/);
  assert.match(dialogs, /event\.key === "Escape"/);
});

test("the sidebar shows Product Gallery next to My Collection to every role that can view the gallery, not only product managers", () => {
  const lines = sidebar.split("\n");
  const mine = lines.findIndex((line) => line.includes('label: "My Collection"'));
  const gallery = lines.findIndex((line) => line.includes('label: "Product Gallery"'));
  assert.ok(mine >= 0 && gallery > mine && gallery - mine <= 3, "right after My Collection");
  assert.match(lines[gallery], /href: "\/products\/gallery"/);
  assert.match(lines[gallery], /hidden: !canViewGallery/);
  assert.doesNotMatch(lines[gallery], /canManageProducts/);
  const roles = (sidebar.match(/const canViewGallery =([\s\S]*?);/)?.[1] ?? "").match(/"(\w+)"/g)?.map((role) => role.replace(/"/g, "")) ?? [];
  assert.deepEqual(roles.sort(), ["admin_manager", "designer", "sales_coordinator", "sales_designer", "system_owner"], "the same roles as product_gallery_can_view");
  assert.doesNotMatch(sidebar.match(/const canViewGallery =([\s\S]*?);/)?.[1] ?? "", /procurement_manager/);
  assert.match(sidebar, /label: "Product Library".*hidden: !canManageProducts/, "the Product Library entry is unchanged");
});

test("the editors migration is attached unchanged and is the only new SQL here", () => {
  const sql = read("../../../supabase/migrations/20261119180000_product_gallery_editors.sql");
  assert.match(sql, /create or replace function public\.product_gallery_is_editor\(\)/);
  assert.match(sql, /'system_owner','admin_manager','sales_designer','sales_coordinator','designer'/);
  assert.match(sql, /product_gallery_set_hidden[\s\S]*product_gallery_is_editor\(\)/);
  assert.doesNotMatch(sql, /product_gallery_merge/, "merge stays curator-only and is not touched");
});

test("PR G-C diff guard: at most 12 files, no SQL, no package change, and none of the protected areas", () => {
  let base: string;
  try {
    base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  } catch {
    return; // no origin/main in this checkout
  }
  const changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" }).split("\n").map((line) => line.trim()).filter((line) => line && line !== "AGENTS.md");
  if (!changed.some((file) => file === "app/products/gallery/page.tsx")) return; // only meaningful on the G-C branch
  assert.ok(changed.length <= 12, `${changed.length} files`);
  assert.ok(!changed.some((file) => /^supabase\/|^package(-lock)?\.json$/.test(file)), "no SQL, no package change");
  // The one legitimate exception: the sidebar label-list assertion in ui-polish.test.mts gained "Product Gallery".
  const protectedChanged = changed.filter((file) => /client-history|saved-setups|my-collection|replay|configurator|pricing/i.test(file) && !file.startsWith("lib/products/gallery/") && file !== "lib/products/saved-setups/ui-polish.test.mts");
  assert.deepEqual(protectedChanged, [], "protected areas untouched");
  const allowed = (file: string) =>
    file.startsWith("lib/products/gallery/") ||
    file === "app/products/gallery/page.tsx" ||
    file === "components/layout/erp-sidebar.tsx" ||
    file === "lib/products/saved-setups/ui-polish.test.mts" ||
    /^components\/products\/product-gallery-(browser|dialogs)\.tsx$/.test(file);
  const outside = changed.filter((file) => !allowed(file));
  assert.deepEqual(outside, [], `unexpected files: ${outside.join(", ")}`);
});

test("details popup: a Details button, the picture and the title open it with the item id; the old link is gone", () => {
  const card = browser.slice(browser.indexOf("function GalleryCard"), browser.indexOf("function Skeleton"));
  assert.equal((card.match(/onDialog\(\{ kind: "detail", item \}\)/g) ?? []).length, 3, "button, picture and title");
  assert.match(card, /<button .*>Details<\/button>/);
  assert.match(browser, /dialog\?\.kind === "detail" \? <GalleryDetailDialog itemId=\{dialog\.item\.id\}/, "the popup gets the item id");
  assert.doesNotMatch(browser, /dialog\?\.kind === "detail".*editing/, "the popup is not an edit-mode feature: every viewer gets it");
  assert.doesNotMatch(code(browser), /\/products\?template=/);
  assert.doesNotMatch(read("./gallery-view.ts"), /productLibraryHref/);
});

test("details popup: Close and Open full detail, the canonical URL, Retry, the unavailable state, collapsible sections, a G-S1 marker", () => {
  assert.match(detailDialog, /onClick=\{onClose\}>Close</);
  assert.match(detailDialog, /Open full detail/);
  assert.match(detailDialog, /fullDetailHref\(phase\.detail\.templateId\)/);
  assert.match(read("./gallery-view.ts"), /`\/products\/manage\?template=\$\{encodeURIComponent\(templateId\)\}`/);
  assert.match(detailDialog, />Retry</);
  assert.match(detailDialog, /This product is no longer available\./);
  assert.match(detailDialog, /data-testid="gallery-detail-skeleton"/);
  for (const title of ["Saved configuration", "Specification", "Available materials", "Options and accessories"]) assert.match(detailDialog, new RegExp(`<Section title="${title}"`));
  assert.match(detailDialog, /<Section title="Saved configuration" defaultOpen>/);
  assert.match(detailDialog, /<Section title="Specification" defaultOpen>/);
  assert.doesNotMatch(detailDialog, /<Section title="Available materials" defaultOpen|<Section title="Options and accessories" defaultOpen/, "only the first two start open");
  assert.match(detailDialog, /G-S1 \(later PR\)/, "the marked place for the gallery-owned specification");
  assert.doesNotMatch(code(detailDialog), /<textarea|updateGallery|Edit/, "no specification editing yet");
  assert.doesNotMatch(code(detailDialog), /Add to quote|openSetupFromCollection/);
  assert.match(detailDialog, /ProductLibraryPreviewImage/);
  assert.match(detailDialog, /<DialogShell title=\{title\} onClose=\{onClose\} wide>/);
  assert.match(dialogs, /h-\[100dvh\] max-w-none/, "a full-screen sheet on a phone");
  assert.match(dialogs, /event\.key === "Escape"/);
  assert.match(dialogs, /returnTo\?\.focus/, "focus goes back to the card");
});

test("details service: signed in, canView first, the caller's client, a short list of selects, no price column", () => {
  const body = actionsSource.slice(actionsSource.indexOf("export async function getGalleryItemDetailAction"), actionsSource.indexOf("export async function setGalleryItemHiddenAction"));
  assert.ok(body.indexOf("await requireActiveUser()") > 0 && body.indexOf("await requireActiveUser()") < body.indexOf("createClient()"));
  assert.match(body, /catch \(problem\)/);
  const detail = service.slice(service.indexOf("export async function getGalleryItemDetail"), service.indexOf("export type GalleryChangeResult"));
  assert.ok(detail.indexOf('rpcBoolean(supabase, "product_gallery_can_view")') > 0 && detail.indexOf('rpcBoolean(supabase, "product_gallery_can_view")') < detail.indexOf(".from("), "canView before any read");
  const section = service.slice(service.indexOf("const DETAIL_ITEM_COLUMNS ="), service.indexOf("export type GalleryChangeResult"));
  const selects = [
    ...Array.from(section.matchAll(/\.select\("([^"]*)"/g), (match) => match[1]),
    ...Array.from(section.matchAll(/const (?:DETAIL_ITEM_COLUMNS|DETAIL_TEMPLATE_SELECT) = ([\s\S]*?);\r?\n/g), (match) => match[1]),
  ];
  assert.ok(selects.length >= 9);
  for (const text of selects) assert.doesNotMatch(text, /price|discount|cost|total/i, text);
  assert.doesNotMatch(section, /createAdminClient|supabase\/admin|service_role/i);
  assert.deepEqual(selects.filter((text) => /recipe/.test(text)).length, 1, "one select reads the recipe, on the server only, to name the saved choices");
  const detailSource = read("./gallery-detail.ts");
  const detailType = detailSource.slice(detailSource.indexOf("export type GalleryDetail = {"), detailSource.indexOf("// ── Images"));
  assert.ok(detailType.includes("configuration: GalleryDetailLine[]"), "the type block was found");
  assert.doesNotMatch(detailType, /recipe/i, "the detail type has no recipe field");
});
