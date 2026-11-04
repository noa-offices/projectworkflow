import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The topbar is checked from its source: its children are client components that need the browser, and the point of the test is the layout classes.
const source = readFileSync(new URL("./erp-topbar.tsx", import.meta.url), "utf8");

test("on desktop the title block takes the free space and the account bar stays on the same row", () => {
  assert.match(source, /"flex-wrap gap-4 lg:flex-nowrap"/); // not compact: wraps below lg as before, never wraps at lg
  assert.doesNotMatch(source, /lg:flex-wrap/);
  assert.match(source, /<div className="lg:min-w-0 lg:flex-1">/); // title block
  assert.match(source, /lg:shrink-0/); // account bar
});

test("the account bar gets smaller when the space is tight: name from xl, email from 2xl, buttons always", () => {
  assert.match(source, /hidden min-w-0 max-w-56 text-right xl:block/);
  assert.match(source, /hidden truncate text-xs text-zinc-500 2xl:block/);
  assert.match(source, /<GlobalRefreshButton[^>]*\/>/); assert.match(source, /<NotificationBell \/>/); assert.match(source, /<ReadCacheSignOut \/>/);
});

test("phone and tablet behaviour and the compact option are unchanged", () => {
  assert.match(source, /compact \? "flex-nowrap gap-2 lg:gap-4"/);
  assert.match(source, /compact \? "px-3 py-1" : "px-4 py-3"/);
});
