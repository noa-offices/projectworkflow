import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePresentationImageRect, normalizePresentationSettings } from "./presentation-settings";

const oldItem = {
  imageUrl: "quotation-presentations/q/item.png",
  imageFit: "cover",
  imageFrameSize: "medium",
  imagePosition: "center",
  imagePositionX: 20,
  imagePositionY: 80,
  imageScale: 1.1,
};
const itemOf = (settings: ReturnType<typeof normalizePresentationSettings>, id = "item-1") => settings.itemOverrides[id];
const normalizeWith = (override: Record<string, unknown>) => normalizePresentationSettings({ itemOverrides: { "item-1": { ...oldItem, ...override } } });

test("old settings without imageRect are unchanged and gain no imageRect key", () => {
  const once = normalizePresentationSettings({ itemOverrides: { "item-1": oldItem } });
  assert.deepEqual(itemOf(once), oldItem);
  assert.equal("imageRect" in itemOf(once), false);
  assert.deepEqual(normalizePresentationSettings(JSON.parse(JSON.stringify(once))), once);
});

test("a valid imageRect survives normalize and a second normalize", () => {
  const rect = { x: 10, y: 5, w: 60, h: 70 };
  const once = normalizeWith({ imageRect: rect });
  assert.deepEqual(itemOf(once).imageRect, rect);
  assert.deepEqual(itemOf(normalizePresentationSettings(JSON.parse(JSON.stringify(once)))).imageRect, rect);
  // The other fields are left untouched next to it.
  assert.equal(itemOf(once).imageScale, 1.1);
  assert.equal(itemOf(once).imagePositionX, 20);
});

test("an override that only has an imageRect is kept, not dropped as empty", () => {
  const settings = normalizePresentationSettings({ itemOverrides: { "item-1": { imageRect: { x: 0, y: 0, w: 50, h: 50 } } } });
  assert.deepEqual(itemOf(settings).imageRect, { x: 0, y: 0, w: 50, h: 50 });
});

test("out-of-range values are clamped: w/h 10-100, x/y 0-100, rect stays inside the box", () => {
  assert.deepEqual(normalizePresentationImageRect({ x: -5, y: 200, w: 2, h: 500 }), { x: 0, y: 0, w: 10, h: 100 });
  assert.deepEqual(normalizePresentationImageRect({ x: 80, y: 90, w: 50, h: 40 }), { x: 50, y: 60, w: 50, h: 40 });
  assert.deepEqual(normalizePresentationImageRect({ x: 100, y: 100, w: 10, h: 10 }), { x: 90, y: 90, w: 10, h: 10 });
  const rect = normalizePresentationImageRect({ x: 33.3, y: 12.5, w: 100, h: 100 })!;
  assert.deepEqual(rect, { x: 0, y: 0, w: 100, h: 100 });
  assert.deepEqual(itemOf(normalizeWith({ imageRect: { x: 95, y: 0, w: 30, h: 30 } })).imageRect, { x: 70, y: 0, w: 30, h: 30 });
});

test("garbage imageRect values are dropped and the rest of the override is kept", () => {
  const bad: unknown[] = [
    null, "x", 5, [], {}, { x: 1, y: 1, w: 50 },
    { x: "10", y: 10, w: 50, h: 50 },
    { x: Number.NaN, y: 10, w: 50, h: 50 },
    { x: 10, y: 10, w: Infinity, h: 50 },
    { x: 10, y: 10, w: 50, h: null },
  ];
  for (const imageRect of bad) {
    const settings = normalizeWith({ imageRect });
    assert.equal(itemOf(settings).imageRect, undefined, JSON.stringify(imageRect));
    assert.equal("imageRect" in itemOf(settings), false);
    assert.equal(itemOf(settings).imageScale, 1.1);
  }
  // Garbage on an override with nothing else custom removes the whole override.
  assert.equal(normalizePresentationSettings({ itemOverrides: { "item-1": { imageRect: { x: "a" } } } }).itemOverrides["item-1"], undefined);
});

test("existing scale and position clamps still apply next to imageRect", () => {
  const item = itemOf(normalizeWith({ imageScale: 9, imagePositionX: -4, imageRect: { x: 0, y: 0, w: 50, h: 50 } }));
  assert.equal(item.imageScale, 1.2);
  assert.equal(item.imagePositionX, 0);
});
