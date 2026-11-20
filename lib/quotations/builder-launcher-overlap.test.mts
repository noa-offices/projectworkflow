import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const zOf = (classes: string) => Number(/\bz-(\d+)\b/.exec(classes)?.[1] ?? "0");

const launcher = read("components/noa/noa-launcher.tsx");
const launcherClasses = /fixed bottom-20 z-40 print:hidden sm:bottom-24/.exec(launcher);
const sheet = read("components/quotations/quotation-sheet-table.tsx");
const menu = read("components/quotations/shared-quotation-row-details-panel.tsx");
const local = read("components/quotations/local-quotation-builder.tsx");

test("the sheet's scroll wrapper is back to its original width (no extra right padding)", () => {
  assert.match(sheet, /ref=\{mainScrollRef\} className="w-full overflow-x-auto overscroll-x-contain pb-2">/);
  assert.doesNotMatch(sheet, /pr-24|print:pr-0/);
  assert.match(sheet, /setStickySpacerWidth\(mainScroll\.scrollWidth\)/);
  assert.match(sheet, /<col key=\{column\.key\} style=\{\{ width: `\$\{widths\[column\.key\] \?\? column\.width\}px` \}\} \/>/);
});

test("an open row menu (More, and the Details panel inside it) is lifted above the launcher; closed buttons keep their stacking", () => {
  assert.ok(launcherClasses, "the launcher keeps its own position and z-40");
  assert.match(menu, /className=\{isOpen \? `\$\{className \?\? ""\} z-50` : className\}/);
  assert.ok(zOf("z-50") > 40);
  assert.match(menu, /<ClickAwayWrapper\s+className="relative"[\s\S]*?buttonLabel="More"/);
  assert.match(local, /<SharedQuotationMoreMenu actionButtons=/);
  assert.match(read("app/quotations/[id]/builder/page.tsx"), /<SharedQuotationMoreMenu/);
});

// The pure route test, copied out of the launcher source so it runs without React.
const pathRule = /const QUOTATION_BUILDER_PATH = (\/.*\/);/.exec(launcher)?.[1];
const isBuilderPath = (pathname: string | null | undefined) => {
  assert.ok(pathRule);
  const body = pathRule.slice(1, pathRule.lastIndexOf("/"));
  return Boolean(pathname && new RegExp(body).test(pathname));
};

test("launcher: docks in sneak mode on the two quotation builder routes only", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(isBuilderPath(`/quotations/${id}/builder`), true);
  assert.equal(isBuilderPath(`/quotations/${id}/local-builder`), true);
  assert.equal(isBuilderPath(`/quotations/${id}/local-builder/`), true);
  for (const other of [`/quotations/${id}`, `/quotations/${id}/pdf`, `/quotations/${id}/specification`, `/quotations/${id}/presentation`, `/quotations/${id}/builder/extra`, "/quotations", "/products/gallery", "/dashboard", "", null, undefined]) {
    assert.equal(isBuilderPath(other), false, String(other));
  }
  // Only these two pages render the quotation sheet table.
  assert.match(local, /<QuotationSheetTable/);
  assert.match(read("app/quotations/[id]/builder/page.tsx"), /<QuotationSheetTable/);
});

test("launcher: uses the pathname, docks when entering, returns to full only if the app docked it, and never forces again on the same page", () => {
  assert.match(launcher, /import \{ usePathname \} from "next\/navigation";/);
  assert.match(launcher, /const onBuilderRoute = isQuotationBuilderPath\(usePathname\(\)\);/);
  assert.ok(launcher.includes('useState<NoaLauncherMode>("full")'), "Full stays the default state (two older tests require it); a builder page flips it before first paint");
  assert.match(launcher, /const \[lastOnBuilderRoute, setLastOnBuilderRoute\] = useState\(false\);/);
  assert.match(launcher, /if \(lastOnBuilderRoute !== onBuilderRoute\) \{/);
  assert.match(launcher, /setDockedByRoute\(mode === "full"\);\s*setMode\("sneak"\);/, "entering: dock, and remember whether the app did it");
  assert.match(launcher, /if \(dockedByRoute\) setMode\("full"\);\s*setDockedByRoute\(false\);/, "leaving: back to full only when the app docked it");
  // The forcing only runs when the route kind changes, so a manual drag out on the builder page stays.
  assert.doesNotMatch(launcher, /useEffect\([^)]*setMode\("sneak"\)/);
});

test("launcher: position classes, drag logic and the click that opens the chat are unchanged", () => {
  assert.ok(launcherClasses);
  assert.match(launcher, /\$\{isSneak \? "right-0" : "right-2 sm:right-3"\}/);
  assert.match(launcher, /const DRAG_ACTIVATION_PX = 6;/);
  assert.match(launcher, /const MODE_DRAG_THRESHOLD_PX = 38;/);
  assert.match(launcher, /if \(suppressClickRef\.current\) \{\s*suppressClickRef\.current = false;\s*return;\s*\}\s*onToggle\(\);/);
  assert.match(launcher, /if \(event\.key === "ArrowRight" && !isSneak\) \{[\s\S]*?setMode\("sneak"\);/);
  assert.match(launcher, /if \(event\.key === "ArrowLeft" && isSneak\) \{[\s\S]*?setMode\("full"\);/);
  assert.doesNotMatch(launcher, /(onBuilderRoute|dockedByRoute)[^\n]*(hidden|display)/, "the route rule only changes the mode; it never hides the launcher");
});
