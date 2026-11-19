import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("../../../app/products/gallery/page.tsx");
const browser = read("../../../components/products/product-gallery-browser.tsx");
const dialogs = read("../../../components/products/product-gallery-dialogs.tsx");
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
  for (const [name, text] of Object.entries({ page, browser, dialogs, view })) {
    assert.doesNotMatch(code(text), /price|discount|\bcost\b|\btotal_|net_?price|list_?price|selling/i, name);
  }
});

test("the page never uses a recipe, an admin client or the add-for-quote action", () => {
  for (const [name, text] of Object.entries({ page, browser, dialogs })) {
    assert.doesNotMatch(code(text), /recipe|getGalleryItemForAdd|createAdminClient|supabase\/admin|service_role|createClient|from\("/i, name);
    assert.doesNotMatch(code(text), /Add to quot|Add to quote|openSetupFromCollection/i, `${name}: no Add button on this page`);
  }
});

test("curator buttons exist only behind canCurate; staff get no edit, hide or merge", () => {
  assert.match(browser, /\{canCurate \? \(\s*<>\s*<button[\s\S]*?>Edit<\/button>/);
  assert.match(browser, /Merge into\.\.\./);
  assert.match(browser, /\{canCurate \? \(\s*<label[^>]*>\s*<input type="checkbox"[\s\S]*?Show hidden/);
  assert.match(browser, /includeHidden: canCurate && current\.showHidden/);
  for (const kind of ["edit", "hide", "merge"]) assert.match(browser, new RegExp(`canCurate && dialog\\?\\.kind === "${kind}"`));
  assert.match(page, /canCurate = capabilities\.ok && capabilities\.canView && capabilities\.canCurate/);
  const editLine = browser.split("\n").find((line) => /^\s*<button .*>Edit<\/button>/.test(line)) ?? "";
  assert.ok(editLine, "the Edit button exists");
  assert.ok(browser.indexOf("canCurate ? (") < browser.indexOf(editLine), "and sits inside the canCurate branch");
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

test("the filter bar has every control, accessible labels, counts in the select labels, and a Filters button for small screens", () => {
  for (const label of ["Brand", "Category", "Sub-category", "Currency", "Sort by"]) assert.match(browser, new RegExp(`aria-label="${label}"`));
  assert.match(browser, /aria-label="Search the gallery"/);
  assert.match(browser, /disabled=\{!state\.categoryId\}/, "sub-category is disabled until a category is chosen");
  assert.match(browser, /subCategoriesFor\(filters\.subCategories, state\.categoryId\)/);
  assert.match(browser, /filterOptionLabel\(/);
  assert.match(browser, /aria-pressed=\{active\}/, "tag chips toggle");
  assert.match(browser, /Clear filters/);
  assert.match(browser, /showingText\(items\.length, total\)/);
  assert.match(browser, /md:hidden/, "the Filters button shows only on small screens");
  assert.match(browser, /aria-expanded=\{filtersOpen\}/);
  assert.match(browser, /Load more/);
  assert.doesNotMatch(code(browser), /IntersectionObserver|onScroll/, "a button, not infinite scroll");
});

test("every state is there: loading skeleton, empty, empty after a filter, and a failure with Retry", () => {
  assert.match(browser, /data-testid="gallery-skeleton"/);
  assert.match(browser, /The gallery is empty\. Products appear here when a quotation that uses them is sent or confirmed\./);
  assert.match(browser, /No products match\./);
  assert.match(browser, />Retry</);
});

test("cards show the agreed facts and a View product link, and nothing else is linked", () => {
  assert.match(browser, /SetupThumbnail path=\{item\.picture\?\.kind === "template" \? item\.picture\.path : null\}/);
  assert.match(browser, /quotedText\(item\.quotedCount\)/);
  assert.match(browser, /lastQuotedText\(item\.lastQuotedAt\)/);
  assert.match(browser, /No longer available/);
  assert.match(browser, />Hidden</);
  assert.match(browser, /View product/);
  assert.match(browser, /productLibraryHref\(item\.templateId\)/);
});

test("dialogs are labelled modals that close on Escape", () => {
  assert.match(dialogs, /role="dialog"/);
  assert.match(dialogs, /aria-modal="true"/);
  assert.match(dialogs, /event\.key === "Escape"/);
});

test("the sidebar has Product Gallery next to My Collection with the Product Library visibility rule", () => {
  const lines = sidebar.split("\n");
  const mine = lines.findIndex((line) => line.includes('label: "My Collection"'));
  const gallery = lines.findIndex((line) => line.includes('label: "Product Gallery"'));
  assert.ok(mine >= 0 && gallery > mine && gallery - mine <= 3, "right after My Collection");
  assert.match(lines[gallery], /href: "\/products\/gallery"/);
  assert.match(lines[gallery], /hidden: !canManageProducts/);
  assert.match(sidebar, /label: "Product Library".*hidden: !canManageProducts/);
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
