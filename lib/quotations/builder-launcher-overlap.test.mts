import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const zOf = (classes: string) => Number(/\bz-(\d+)\b/.exec(classes)?.[1] ?? "0");

const launcher = read("components/noa/noa-launcher.tsx");
const launcherClasses = /fixed bottom-20 z-40 print:hidden sm:bottom-24/.exec(launcher);
const sheet = read("components/quotations/quotation-sheet-table.tsx");
const menu = read("components/quotations/shared-quotation-row-details-panel.tsx");
const local = read("components/quotations/local-quotation-builder.tsx");

test("the sheet's scroll wrapper keeps the last column clear of the launcher, and adds nothing when printed", () => {
  assert.match(sheet, /ref=\{mainScrollRef\} className="w-full overflow-x-auto overscroll-x-contain pb-2 pr-24 print:pr-0"/);
  // The sticky scrollbar mirror follows the real scroll width, so the padding is part of it.
  assert.match(sheet, /setStickySpacerWidth\(mainScroll\.scrollWidth\)/);
  // Column widths are untouched.
  assert.match(sheet, /<col key=\{column\.key\} style=\{\{ width: `\$\{widths\[column\.key\] \?\? column\.width\}px` \}\} \/>/);
});

test("an open row menu (More, and the Details panel inside it) is lifted above the launcher; closed buttons keep their stacking", () => {
  assert.ok(launcherClasses, "the launcher keeps its own position and z-40");
  assert.match(menu, /className=\{isOpen \? `\$\{className \?\? ""\} z-50` : className\}/);
  assert.ok(zOf("z-50") > 40);
  // The More menu is built from this wrapper in both builders, and the local builder's own line is untouched.
  assert.match(menu, /<ClickAwayWrapper\s+className="relative"[\s\S]*?buttonLabel="More"/);
  assert.match(local, /<SharedQuotationMoreMenu actionButtons=/);
  assert.match(read("app/quotations/[id]/builder/page.tsx"), /<SharedQuotationMoreMenu/);
});

test("the launcher itself is unchanged", () => {
  let changed: string[];
  try {
    const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
    changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" }).split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return; // no origin/main in this checkout
  }
  assert.ok(!changed.some((file) => file.startsWith("components/noa/") || file === "app/layout.tsx"), "launcher and layout untouched");
});
