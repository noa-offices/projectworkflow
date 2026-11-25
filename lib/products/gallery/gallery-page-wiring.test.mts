import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("../../../app/products/gallery/page.tsx");
const browser = read("../../../components/products/product-gallery-browser.tsx");
const dialogs = read("../../../components/products/product-gallery-dialogs.tsx");
const detailDialog = read("../../../components/products/product-gallery-detail-dialog.tsx");
const priceBlock = read("../../../components/products/product-gallery-price.tsx");
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

test("the gallery displays source list prices without commercial fields from a quotation", () => {
  for (const [name, text] of Object.entries({ page, browser, dialogs, view, detailDialog, priceBlock })) {
    // The one allowed line: the required help text under the specification box ("... prices or quote numbers"), which tells editors not to type them.
    const scanned = code(text).split(String.fromCharCode(10)).filter((line) => !line.includes("SPECIFICATION_HELP_TEXT =")).join(String.fromCharCode(10));
    assert.doesNotMatch(scanned, /discount|\bcost\b|net_?price|internal_?cost|supplier_?price|margin|selling|exchange_?rate/i, name);
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
  assert.match(browser, /\{canEdit \? \(\s*<div className="flex justify-end gap-2">[\s\S]*?<button[\s\S]*?\{editing \? "Done" : "Edit"\}/, "the toggle is only for editors and says Done while on");
  // The card buttons sit inside the editMode branch; Merge is inside a canCurate branch inside it.
  const card = browser.slice(browser.indexOf("function GalleryCard"), browser.indexOf("function Skeleton"));
  const editBranch = card.indexOf("{editMode ? (");
  assert.ok(editBranch > 0, "an edit-mode branch exists on the card");
  assert.ok(card.indexOf(">Rename / Tags</button>") > editBranch, "Rename / Tags (the existing edit dialog) only inside the edit-mode branch");
  assert.ok(card.indexOf(">Remove</button>") > editBranch, "Remove only inside the edit-mode branch");
  assert.doesNotMatch(code(browser), /Unhide|>Hide<|onUnhide|isHidden|"Hidden"|>Hidden</, "no Hide, Unhide or Hidden badge in the UI any more");
  assert.ok(card.indexOf("{canCurate ? <button") > editBranch, "Merge is behind canCurate inside the edit-mode branch");
  assert.ok(card.indexOf("Merge into...") > card.indexOf("{canCurate ? <button"));
  assert.doesNotMatch(code(browser), /includeHidden/, "the page no longer asks for hidden items");
  assert.doesNotMatch(code(browser), /opacity-60/, "no dimmed hidden state");
  assert.match(browser, /editing && dialog\?\.kind === "edit"/);
  assert.match(browser, /editing && dialog\?\.kind === "remove"/);
  assert.match(browser, /editing && canCurate && dialog\?\.kind === "merge"/);
  assert.doesNotMatch(code(browser), /Show hidden|showHidden/, "no separate hidden toggle any more");
});

test("remove asks first with the agreed text; merge explains the effect; edit uses the gallery action; nothing in the UI calls the hide action", () => {
  assert.match(dialogs, /title="Remove from gallery\?"/);
  assert.match(dialogs, /This removes \$\{item\.displayName\} from the gallery for good\. If the same configuration is quoted again it will NOT come back\. Quotations are not affected\./);
  assert.match(dialogs, /onClick=\{onClose\} disabled=\{busy\}>Cancel</);
  assert.match(dialogs, /disabled=\{busy\}>\{busy \? "Removing…" : "Remove"\}/, "both buttons are disabled while working");
  assert.match(dialogs, /Counts are added and this item is removed\./);
  assert.match(dialogs, /mergeGalleryItemsAction\(\{ fromId: item\.id, toId: target\.id \}\)/);
  assert.match(dialogs, /updateGalleryItemDetailsAction\(/);
  assert.match(browser, /removeGalleryItemAction\(\{ id: item\.id \}\)/);
  assert.match(browser, /result\.alreadyRemoved \? "Already removed\." : "Removed from the gallery\."/);
  for (const [name, text] of Object.entries({ browser, dialogs, detailDialog })) assert.doesNotMatch(code(text), /setGalleryItemHidden|ConfirmHiddenDialog|Hidden items are not shown/, `${name}: the hide action is not used by the UI`);
  // The server action stays (and its database function) but only the removal is wired to the UI.
  assert.match(actionsSource, /export async function setGalleryItemHiddenAction/);
});

test("remove action: editors only, signed in first, the caller's client, role checked before the database function", () => {
  const body = actionsSource.slice(actionsSource.indexOf("export async function removeGalleryItemAction"), actionsSource.indexOf("export async function updateGalleryItemSpecificationAction"));
  assert.ok(body.indexOf("await requireActiveUser()") > 0 && body.indexOf("await requireActiveUser()") < body.indexOf("createClient()"));
  assert.match(body, /catch \(problem\)/);
  assert.match(service, /product_gallery_is_editor"\)\)\) return \{ ok: false, kind: "not_allowed" \};\s*try \{\s*const \{ data, error \} = await supabase\.rpc\("product_gallery_remove", \{ p_id: input\.id \}\)/);
  assert.doesNotMatch(body, /createAdminClient|supabase\/admin/);
  const sql = read("../../../supabase/migrations/20261119220000_product_gallery_remove.sql");
  assert.match(sql, /create or replace function public\.product_gallery_remove\(p_id uuid\)/);
});

test("merge is limited to the SAME template: candidates are filtered by template id before they are shown", () => {
  assert.match(dialogs, /mergeCandidates\(found, item\)/);
  assert.match(view, /item\.templateId !== source\.templateId/);
  assert.doesNotMatch(dialogs, /includeHidden/, "no hidden items in the merge list either");
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
  assert.match(browser, /grid grid-cols-\[repeat\(auto-fill,minmax\(210px,1fr\)\)\] gap-x-5 gap-y-7/, "compact auto-fill grid, 28px rows / 20px columns");
  assert.doesNotMatch(browser, /grid-cols-1 gap-3 min-\[480px\]:grid-cols-2 lg:grid-cols-3/, "not the old fixed 2-column steps");
});

test("every state is there: loading skeleton, empty, empty after a filter, and a failure with Retry", () => {
  assert.match(browser, /data-testid="gallery-skeleton"/);
  assert.match(browser, /The gallery is empty\. Products appear here when a quotation that uses them is sent or confirmed\./);
  assert.match(browser, /No products match\./);
  assert.match(browser, />Retry</);
});

test("cards show the agreed facts: Category and Sub-category as two separate labels, no joined string", () => {
  assert.match(browser, /SetupThumbnail path=\{item\.picture\?\.kind === "template" \? item\.picture\.path : null\}/);
  assert.match(browser, /const kind = \[item\.brandName, item\.categoryName\]\.filter\(Boolean\)\.join\(" · "\)/, "one muted BRAND · Category line");
  assert.doesNotMatch(browser.slice(browser.indexOf("function GalleryCard"), browser.indexOf("function Skeleton")), /quotedText|item\.tags|item\.subCategoryName|item\.itemCode|specification/, "tags, quoted count and the rest stay in the popup");
  assert.doesNotMatch(code(browser), /categoryLine/);
  assert.match(browser, /No longer available/);
  assert.doesNotMatch(code(browser), />Hidden</, "no Hidden badge any more");
  assert.match(browser, /Open details of \$\{item\.displayName\}/, "the picture is a real button");
  assert.doesNotMatch(browser, /View product|productLibraryHref|\/products\?template=|next\/link/, "the link that left the gallery is gone");
});

test("dialogs are labelled modals that close on Escape", () => {
  assert.match(dialogs, /role="dialog"/);
  assert.match(dialogs, /aria-modal="true"/);
  assert.match(dialogs, /event\.key === "Escape"/);
});

test("the sidebar shows Product Gallery next to My Collection to every role that can view the gallery, including procurement managers", () => {
  const lines = sidebar.split("\n");
  const mine = lines.findIndex((line) => line.includes('label: "My Collection"'));
  const gallery = lines.findIndex((line) => line.includes('label: "Product Gallery"'));
  assert.ok(mine >= 0 && gallery > mine && gallery - mine <= 3, "right after My Collection");
  assert.match(lines[gallery], /href: "\/products\/gallery"/);
  assert.match(lines[gallery], /hidden: !canViewGallery/);
  assert.doesNotMatch(lines[gallery], /canManageProducts/);
  const roles = (sidebar.match(/const canViewGallery =([\s\S]*?);/)?.[1] ?? "").match(/"(\w+)"/g)?.map((role) => role.replace(/"/g, "")) ?? [];
  assert.deepEqual(roles.sort(), ["admin_manager", "designer", "procurement_manager", "sales_coordinator", "sales_designer", "system_owner"], "the same roles as product_gallery_can_view after the procurement migration");
  assert.match(sidebar, /label: "Product Library".*hidden: !canManageProducts/, "the Product Library entry is unchanged");
});

test("sidebar visibility by role: procurement manager sees Product Gallery; viewer and warehouse staff do not", () => {
  const body = sidebar.match(/const canViewGallery =([\s\S]*?);/)?.[1] ?? "";
  const sees = (role: string) => new RegExp(`role === "${role}"`).test(body);
  for (const role of ["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer"]) assert.equal(sees(role), true, role);
  for (const role of ["viewer", "warehouse_staff"]) assert.equal(sees(role), false, role);
  // Warehouse staff get their own sidebar, which is returned before the Products group is built.
  assert.ok(sidebar.indexOf('if (role === "warehouse_staff") {') < sidebar.indexOf("const canViewGallery"));
  // The gallery code never hard-codes a role: the server capabilities decide (canView, canEdit, canCurate).
  for (const [name, text] of Object.entries({ page, browser, dialogs, detailDialog, service, actionsSource })) assert.doesNotMatch(code(text), /role\s*===|role\s*!==|includes\(role\)|"system_owner"|"sales_designer"/, `${name}: no role checks in the gallery code`);
});

test("the procurement migration is attached unchanged: view and edit for procurement managers, merge stays with owner and admin", () => {
  const sql = read("../../../supabase/migrations/20261119230000_product_gallery_procurement.sql");
  assert.match(sql, /product_gallery_can_view\(\)[\s\S]*'system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer'/);
  assert.match(sql, /product_gallery_is_editor\(\)[\s\S]*'procurement_manager'/);
  assert.doesNotMatch(sql, /product_gallery_is_curator|product_gallery_merge/, "merge is not touched");
});

test("the editors migration is attached unchanged and is the only new SQL here", () => {
  const sql = read("../../../supabase/migrations/20261119180000_product_gallery_editors.sql");
  assert.match(sql, /create or replace function public\.product_gallery_is_editor\(\)/);
  assert.match(sql, /'system_owner','admin_manager','sales_designer','sales_coordinator','designer'/);
  assert.match(sql, /product_gallery_set_hidden[\s\S]*product_gallery_is_editor\(\)/);
  assert.doesNotMatch(sql, /product_gallery_merge/, "merge stays curator-only and is not touched");
});

test("details popup: a Details button, the picture and the title open it with the item id; the old link is gone", () => {
  const card = browser.slice(browser.indexOf("function GalleryCard"), browser.indexOf("function Skeleton"));
  assert.equal((card.match(/onDialog\(\{ kind: "detail", item \}\)/g) ?? []).length, 2, "the picture and the name, both real buttons");
  assert.match(browser, /dialog\?\.kind === "detail" \? <GalleryDetailDialog itemId=\{dialog\.item\.id\}/, "the popup gets the item id");
  assert.doesNotMatch(browser, /\{editing && dialog\?\.kind === "detail"/, "the popup is not an edit-mode feature: every viewer gets it");
  assert.match(browser, /<GalleryDetailDialog [^\n]*canEdit=\{canEdit\}/, "the popup gets the server capability, not the page toggle");
  assert.doesNotMatch(browser, /<GalleryDetailDialog [^\n]*editing/, "the Edit toggle of the page does not decide the popup's edit button");
  assert.doesNotMatch(code(browser), /\/products\?template=/);
  assert.doesNotMatch(read("./gallery-view.ts"), /productLibraryHref/);
});

test("details popup: Close and Open full detail, the canonical URL, Retry, the unavailable state, collapsible sections, the specification block", () => {
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
  assert.doesNotMatch(detailDialog, /G-S1/, "the placeholder comment is gone");
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

test("specification editing: the button needs canEdit only (not the page toggle); textarea, counter, helper text, Save/Cancel, saving disabled, in-place update", () => {
  assert.match(detailDialog, /\{canEdit \? <div><button[^\n]*onClick=\{startEditing\}>Edit specification<\/button><\/div> : null\}/, "the button only when the dialog was told the user may edit");
  assert.match(detailDialog, /canEdit = false/, "off by default: a user who cannot edit sees no button");
  assert.doesNotMatch(code(detailDialog), /canEditSpecification|editMode|editing &&/, "no coupling to the page's Edit mode in the popup");
  assert.match(detailDialog, /onClick=\{\(\) => setEditing\(false\)\}/);
  assert.match(detailDialog, /<textarea[\s\S]*?maxLength=\{GALLERY_SPECIFICATION_MAX\}/);
  assert.match(detailDialog, /\{draft\.length\} \/ \{GALLERY_SPECIFICATION_MAX\}/, "character counter");
  assert.match(detailDialog, /\{SPECIFICATION_HELP_TEXT\}/);
  assert.match(view, /Generic text only\. Do not include client names, project names, prices or quote numbers\./);
  assert.match(detailDialog, /disabled=\{saving\}>\{saving \? "Saving…" : "Save"\}/, "Save is disabled while saving");
  assert.match(detailDialog, /updateGalleryItemSpecificationAction\(\{ id: detail\.id, specification: draft \}\)/);
  assert.match(detailDialog, /await onSaved\(\);\s*setEditing\(false\)/, "the text is swapped in place and the popup stays open");
  assert.match(detailDialog, /Specification saved\./);
  assert.match(detailDialog, /setDraft\(specificationDraft\(detail\.specification\)\)/, "the box starts with the text that is shown (saved, generated or template)");
  assert.match(detailDialog, /whitespace-pre-line/, "line breaks are kept");
  for (const label of ["Saved specification", "Generated from the saved configuration", "From product template"]) assert.match(view, new RegExp(label));
  const actions = actionsSource.slice(actionsSource.indexOf("export async function updateGalleryItemSpecificationAction"), actionsSource.indexOf("export async function mergeGalleryItemsAction"));
  assert.ok(actions.indexOf("await requireActiveUser()") > 0 && actions.indexOf("await requireActiveUser()") < actions.indexOf("createClient()"));
  assert.match(service, /product_gallery_is_editor"\)\)\) return \{ ok: false, kind: "not_allowed" \};\s*return callCuration\(supabase, "product_gallery_update_specification"/);
});

test("finish swatches: sections per material group, each collection its own sub-section with its own Show all, 24 first, lazy fixed-size pictures, no text line", () => {
  assert.match(detailDialog, /function SwatchGroup/);
  assert.match(detailDialog, /function SwatchGrid/);
  assert.match(detailDialog, /data-testid="swatch-group"/);
  assert.match(detailDialog, /data-testid="swatch-collection"/);
  assert.match(detailDialog, /\{group\.groupName\} <span[^\n]*\(\{group\.count\}\)/, "the group heading with its count");
  assert.match(detailDialog, /\{collection\.name\} \(\{collection\.swatches\.length\}\)/, "each collection heading with its count, for example Era (24)");
  assert.doesNotMatch(detailDialog, /gradeBadge|collection\.grade/, "the heading is the selector's own 'category · collection'; there is no separate grade badge");
  assert.match(detailDialog, /<SwatchGrid swatches=\{collection\.swatches\}/, "one grid per collection");
  assert.match(detailDialog, /swatches\.slice\(0, SWATCHES_SHOWN_FIRST\)/);
  assert.match(view, /SWATCHES_SHOWN_FIRST = 24/);
  assert.match(detailDialog, /`Show all \(\$\{total\}\)`/, "per-collection Show all (N)");
  assert.match(detailDialog, /"Show less"/);
  assert.match(view, /COLLECTIONS_COLLAPSE_ABOVE = 12/);
  assert.match(view, /COLLECTIONS_SHOWN_FIRST = 6/);
  assert.match(detailDialog, /collapsible = group\.collections\.length > COLLECTIONS_COLLAPSE_ABOVE/);
  assert.match(detailDialog, /group\.collections\.slice\(0, COLLECTIONS_SHOWN_FIRST\)/);
  assert.match(detailDialog, /Show all collections \(\$\{group\.collections\.length\}\)/, "the group-level button");
  assert.match(detailDialog, /"Show fewer collections"/);
  assert.match(detailDialog, /loading="lazy"/);
  assert.match(detailDialog, /width=\{size\}\s*height=\{size\}/);
  assert.match(detailDialog, /h-12 w-12[^"]*sm:h-14 sm:w-14/, "48px on a phone, 56px on a desktop");
  assert.match(detailDialog, /rounded-md/);
  assert.match(detailDialog, /title=\{swatchCaption\(swatch\)\}\s*aria-label=\{swatchCaption\(swatch\)\}/, "full name as tooltip and accessible label");
  assert.match(detailDialog, /\{selected \? swatchCaption\(selected\) : ""\}/, "a click shows code and full name above the grid");
  assert.match(detailDialog, /\{swatch\.code\}<\/span>/, "no picture: the code in a neutral box");
  assert.match(detailDialog, /No finishes connected to this product\./);
  assert.match(detailDialog, /resolveQuotationImageUrl\(path\)/, "the same picture helper the Product Library uses");
  const materialsSection = detailDialog.slice(detailDialog.indexOf('<Section title="Available materials">'), detailDialog.indexOf('<Section title="Options and accessories">'));
  assert.ok(materialsSection.includes("SwatchGroup"), "the materials section is the swatch grid");
  assert.doesNotMatch(materialsSection, /\.items|join\(/, "no joined text line of finish names in the materials section");
  assert.doesNotMatch(detailDialog.slice(detailDialog.indexOf("function SwatchGroup"), detailDialog.indexOf("function SpecificationBlock")), /join\(/, "and none in the swatch group");
});

test("popup fixes: materials are read in group/subgroup/sort order with subgroup names; the picture column is read with a retry and validated against the template", () => {
  assert.match(service, /\.order\("material_group_id", \{ ascending: true \}\)\.order\("subgroup_id", \{ ascending: true \}\)\.order\("sort_order", \{ ascending: true \}\)/, "the read order, so a cap cuts the tail");
  assert.match(service, /from\("brand_material_subgroups"\)\.select\("id,name,grade,sort_order"\)/);
  assert.match(service, /material_category,material_collection,subgroup_id/, "the selector's own section fields");
  assert.match(service, /link\.selection_mode === "full_group"\)\.map\(\(link\) => link\.material_group_id\)/, "only full_group means the whole brand group");
  assert.match(service, /link\.selection_mode !== "full_group"\)\.map\(\(link\) => link\.id\)/, "any other mode reads the item rows");
  assert.match(service, /chunk\(Array\.from\(new Set\(linkItems/, "the connected materials are read in chunks");
  assert.match(read("./gallery-detail.ts"), /import \{ groupMaterialsIntoSections \} from "\.\.\/\.\.\/quotations\/finish-material-groups"/, "the selector's own grouping helper is reused");
  assert.match(service, /"is_hidden", "selected_image",/, "the list reads the chosen picture");
  assert.match(service, /LIST_COLUMNS_NO_IMAGE/, "and still works before the migration");
  assert.match(service, /DETAIL_ITEM_COLUMNS_NO_IMAGE/);
  assert.match(service, /validSelectedImage\(template, row\.selected_image\)/, "a card only uses a picture that is still the template's own");
  assert.match(service, /"default_image_url", "reference_image_url", \.\.\.PROPOSED_IMAGE_FIELDS/, "the one extra column the list reads for this");
  assert.doesNotMatch(service.slice(service.indexOf("const LIST_COLUMNS"), service.indexOf("const LIST_COLUMNS_NO_IMAGE")), /recipe/);
  const sql = read("../../../supabase/migrations/20261119210000_product_gallery_selected_image.sql");
  assert.match(sql, /add column if not exists selected_image text/);
  assert.match(sql, /product_gallery_clean_image/);
});

test("popup: a Required components block inside Saved configuration, supplier codes after names, no price", () => {
  const saved = detailDialog.slice(detailDialog.indexOf('<Section title="Saved configuration" defaultOpen>'), detailDialog.indexOf('<Section title="Specification" defaultOpen>'));
  assert.match(saved, /data-testid="required-components"/);
  assert.match(saved, /<h4 [^>]*>Required components<\/h4>/);
  assert.match(saved, /detail\.requiredComponents\.map\(\(component\) =>/);
  assert.match(saved, /<\/span> x \{component\.quantity\}/, "name x quantity");
  assert.match(saved, /Size: \{component\.size\}/);
  assert.match(saved, /Supplier code: \{component\.supplierCode\}/);
  assert.match(saved, /Supplier code: \{line\.supplierCode\}/, "on the saved configuration lines");
  const options = detailDialog.slice(detailDialog.indexOf('<Section title="Options and accessories">'));
  assert.match(options, /Supplier code: \{item\.supplierCode\}/, "in the options and accessories lists");
  assert.doesNotMatch(code(saved), /price|cost|currency|amount/i);
  assert.match(read("./gallery-detail.ts"), /supplier_price_list_code/, "the field the quotation selector shows as Supplier Code");
  assert.match(read("./gallery-detail.ts"), /requiredComponentsFromEngine\(engineState\.autoApplied/, "the engine's own required-companion output");
});

test("restore and updates: editors only in the UI, the four actions are imported, no admin client, no price words, no hidden-item calls", () => {
  assert.match(browser, /\{editing \? <button[^>]*onClick=\{\(\) => setRemovedOpen\(true\)\}>Removed items<\/button> : null\}/, "Removed items only in Edit mode");
  assert.match(browser, /\{editing && removedOpen \? <RemovedItemsDialog/);
  assert.match(dialogs, /listRemovedGalleryItemsAction/);
  assert.match(dialogs, /restoreGalleryItemAction\(\{ key: item\.identityKey \}\)/);
  assert.match(dialogs, /restoreButtonLabel\(item\)/, "Restore / Allow again");
  assert.match(dialogs, /OLD_REMOVAL_NOTE/);
  assert.match(browser, /\{updateTagText\(item\) \?/, "the card tag");
  assert.match(browser, /\{canEdit \? \(\s*<button[^>]*aria-pressed=\{state\.updateAvailable\}/, "the filter chip is for editors");
  assert.match(browser, /updateAvailable: canEdit && current\.updateAvailable/, "the filter is only sent for editors");
  assert.match(detailDialog, /applyGalleryUpdateAction/);
  assert.match(detailDialog, /ignoreGalleryUpdateAction/);
  assert.match(detailDialog, /<Section title=\{UPDATE_AVAILABLE_TEXT\} defaultOpen>/);
  assert.match(detailDialog, />\{which === "update" \? "Working…" : "Update"\}|"Update"\}/);
  assert.match(detailDialog, /kind: "configuration", value: fingerprint/);
  assert.match(detailDialog, /STALE_CHOICES_TEXT/);
  assert.match(detailDialog, /STALE_CHOICES_HELP/);
  assert.match(read("./gallery-view.ts"), /Some saved choices changed in the product/);
  assert.match(read("./gallery-view.ts"), /To fix, quote the corrected configuration and remove this old item\./);
  assert.match(detailDialog, /<ProductLibraryPreviewImage alt="New picture" path=\{updates\.picture\.proposedPath\}/, "the same picture helper as the rest of the popup");
  for (const action of ["listRemovedGalleryItemsAction", "restoreGalleryItemAction", "applyGalleryUpdateAction", "ignoreGalleryUpdateAction"]) {
    const body = actionsSource.slice(actionsSource.indexOf(`export async function ${action}`));
    const head = body.slice(0, body.indexOf("\n}\n"));
    assert.ok(head.indexOf("await requireActiveUser()") > 0 && head.indexOf("await requireActiveUser()") < head.indexOf("createClient()"), `${action}: signed in first`);
    assert.match(head, /catch \(problem\)/, `${action}: never throws`);
  }
  assert.match(actionsSource, /revalidatePath\("\/products\/gallery"\)/);
  for (const [name, text] of Object.entries({ browser, dialogs, detailDialog, service, actionsSource })) {
    assert.doesNotMatch(code(text), /createAdminClient|supabase\/admin|service_role|SUPABASE_SERVICE/i, `${name}: no admin client`);
  }
  // the new service functions check the editor role before the database function
  for (const rpc of ["product_gallery_restore", "product_gallery_update_apply", "product_gallery_update_ignore", "product_gallery_removed_list"]) {
    const at = service.indexOf(rpc);
    assert.ok(at > 0, rpc);
  }
  assert.match(service, /product_gallery_is_editor"\)\)\) return \{ ok: false, kind: "not_allowed" \};\s*try \{\s*const \{ data, error \} = await supabase\.rpc\("product_gallery_restore"/);
  assert.match(service, /product_gallery_is_editor"\)\)\) return \{ ok: false, kind: "not_allowed" \};\s*return callCuration\(supabase, "product_gallery_update_apply"/);
  assert.match(service, /product_gallery_is_editor"\)\)\) return \{ ok: false, kind: "not_allowed" \};\s*return callCuration\(supabase, "product_gallery_update_ignore"/);
  assert.match(service, /from\("product_gallery_updates"\)\.select\("kind,proposed_value,status"\)/);
  const sql = read("../../../supabase/migrations/20261119240000_product_gallery_restore_updates.sql");
  assert.match(sql, /create table if not exists public\.product_gallery_updates/);
  assert.match(sql, /create or replace function public\.product_gallery_restore\(p_key text\)/);
});

test("check for updates is only rendered for editors", () => {
  assert.match(browser, /\{canEdit \? <button[^\n]*Check for updates[^\n]*: null\}/);
});
