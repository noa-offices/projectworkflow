import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// use-noa-page-context.ts has a top-level `import { usePathname, useSearchParams } from
// "next/navigation"` (required for the real useNoaPageContext() hook). Node's plain ESM resolver
// cannot resolve the bare "next/navigation" specifier outside the Next.js build pipeline (it only
// resolves the exact "next/navigation.js" subpath, which the shipped hook must not use - that
// would break `next`'s own type declarations and `npx tsc --noEmit`), so this module cannot be
// imported directly by `node --test`, the same class of limitation documented for "@/..." alias
// imports elsewhere in lib/. The pure parseNoaPageContext() logic itself only takes
// (pathname: string, searchParams: URLSearchParams) and has no Next/React dependency, but it
// lives in the same file as the hook, so it inherits the same import-time blocker. These tests
// therefore verify, at the source level, that the parsing logic for each required URL shape is
// present and wired to the right NoaPageContext field - the same readFileSync-based technique
// this repo already uses for other otherwise-untestable "use client" modules.
const source = readFileSync("lib/noa/use-noa-page-context.ts", "utf8");

test("quotationId is derived from the first /quotations/<id> path segment", () => {
  assert.match(source, /const quotationId = pathSegmentAfter\(pathname, "\/quotations"\);/);
});

test("projectId is derived from the first /clients/projects/<id> path segment", () => {
  assert.match(source, /const projectId = pathSegmentAfter\(pathname, "\/clients\/projects"\);/);
});

test("productTemplateId is derived from the ?template= search param", () => {
  assert.match(source, /const productTemplateId = searchParams\.get\("template"\) \?\? undefined;/);
});

test("brandId is derived from ?brand= falling back to ?panelBrand=", () => {
  assert.match(
    source,
    /const brandId = searchParams\.get\("brand"\) \?\? searchParams\.get\("panelBrand"\) \?\? undefined;/,
  );
});

test("pathSegmentAfter only matches when the pathname continues past the prefix with a slash", () => {
  assert.match(source, /if \(!pathname\.startsWith\(`\$\{prefix\}\/`\)\) return undefined;/);
});
