import assert from "node:assert/strict";
import { test } from "node:test";
import { moveRect, nudgeRect, resizeRect } from "./presentation-image-rect";

const start = { x: 20, y: 20, w: 40, h: 30 };
const inside = (r: { x: number; y: number; w: number; h: number }) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= 100.0001 && r.y + r.h <= 100.0001 && r.w >= 10 && r.h >= 10;

test("move shifts the rect and keeps it inside the box", () => {
  assert.deepEqual(moveRect(start, 5, -5), { x: 25, y: 15, w: 40, h: 30 });
  assert.deepEqual(moveRect(start, -500, -500), { x: 0, y: 0, w: 40, h: 30 });
  assert.deepEqual(moveRect(start, 500, 500), { x: 60, y: 70, w: 40, h: 30 });
});

test("resize from each corner keeps the opposite corner fixed and the ratio", () => {
  const right = start.x + start.w, bottom = start.y + start.h;
  const se = resizeRect(start, "se", 10, 0);
  assert.deepEqual([se.x, se.y], [start.x, start.y]);
  assert.equal(Math.round((se.w / se.h) * 1000), Math.round((start.w / start.h) * 1000));
  const nw = resizeRect(start, "nw", -10, 0);
  assert.equal(Math.round((nw.x + nw.w) * 100), right * 100);
  assert.equal(Math.round((nw.y + nw.h) * 100), bottom * 100);
  const ne = resizeRect(start, "ne", 10, 0);
  assert.equal(ne.x, start.x);
  assert.equal(Math.round((ne.y + ne.h) * 100), bottom * 100);
  const sw = resizeRect(start, "sw", -10, 0);
  assert.equal(Math.round((sw.x + sw.w) * 100), right * 100);
  assert.equal(sw.y, start.y);
  for (const r of [se, nw, ne, sw]) assert.ok(r.w > start.w, "dragging outwards grows the rect");
});

test("a mostly vertical drag still resizes", () => {
  assert.ok(resizeRect(start, "se", 0, 12).h > start.h);
  assert.ok(resizeRect(start, "se", 0, -8).h < start.h);
});

test("resize respects the 10% minimum and the box edges", () => {
  const small = resizeRect(start, "se", -500, -500);
  assert.ok(small.w >= 10 && small.h >= 10);
  const huge = resizeRect({ x: 50, y: 50, w: 30, h: 30 }, "se", 500, 500);
  assert.ok(inside(huge));
  assert.equal(Math.round((huge.x + huge.w) * 100) / 100, 100);
  const hugeNw = resizeRect({ x: 50, y: 50, w: 30, h: 30 }, "nw", -500, -500);
  assert.ok(inside(hugeNw));
  assert.equal(hugeNw.x, 0);
});

test("a rect smaller than the minimum is raised without leaving the box", () => {
  const r = resizeRect({ x: 95, y: 95, w: 5, h: 5 }, "nw", 0, 0);
  assert.ok(inside(r));
});

test("arrow nudge moves 0.5, shift moves 2, clamps at the edges, ignores other keys", () => {
  assert.deepEqual(nudgeRect(start, "ArrowRight", 0.5), { x: 20.5, y: 20, w: 40, h: 30 });
  assert.deepEqual(nudgeRect(start, "ArrowUp", 2), { x: 20, y: 18, w: 40, h: 30 });
  assert.deepEqual(nudgeRect({ x: 0, y: 0, w: 40, h: 30 }, "ArrowLeft", 2), { x: 0, y: 0, w: 40, h: 30 });
  assert.deepEqual(nudgeRect(start, "a", 2), start);
});
