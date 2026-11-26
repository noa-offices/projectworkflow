import assert from "node:assert/strict";
import test from "node:test";
import { finishLayout, planProductFinishes, type FinishCardSegment, type FinishGroup } from "./specification-finish-layout";

type Swatch = { code: string; name: string };
const group = (title: string, count: number, name = "Grey"): FinishGroup<Swatch> => ({
  key: title, title, swatches: Array.from({ length: count }, (_, i) => ({ code: `${title}-${i}`, name })),
});
const codes = (segments: FinishCardSegment<Swatch>[]) => segments.flatMap((segment) => segment.swatches.map((swatch) => swatch.code));
const allCodes = (groups: FinishGroup<Swatch>[]) => groups.flatMap((item) => item.swatches.map((swatch) => swatch.code));
const on = { allowContinuation: true, descriptionContinues: false };
const off = { allowContinuation: false, descriptionContinues: false };

for (const count of [3, 12, 40, 131]) {
  test(`${count} finishes, continuation on: nothing lost, order kept, whole rows, every page fits`, () => {
    const groups = [group("Wood", 8), group("Metal", 4), group("Fabric", count)];
    const plan = planProductFinishes(groups, on);
    const pages = [plan.productPage, ...plan.continuationPages];
    assert.equal(plan.hiddenCount, 0);
    assert.deepEqual(codes(pages.flat()), allCodes(groups));
    for (const [pageIndex, segments] of pages.entries()) {
      assert.ok(finishLayout.cardsHeight(segments) <= (pageIndex ? finishLayout.continuationCapacity : finishLayout.productCapacity), `page ${pageIndex}`);
      for (const segment of segments) {
        const source = groups.find((item) => item.key === segment.key)!;
        const start = source.swatches.indexOf(segment.swatches[0]);
        assert.equal(start % finishLayout.columns, 0, "a segment starts on a row boundary");
        assert.ok(segment.swatches.length % finishLayout.columns === 0 || start + segment.swatches.length === source.swatches.length, "a segment ends on a row boundary");
        assert.equal(segment.total, source.swatches.length);
      }
    }
  });

  test(`${count} finishes, continuation off: one page, shown plus hidden equals all`, () => {
    const groups = [group("Wood", 8), group("Metal", 4), group("Fabric", count)];
    const plan = planProductFinishes(groups, off);
    assert.deepEqual(plan.continuationPages, []);
    assert.deepEqual(codes(plan.productPage), allCodes(groups).slice(0, codes(plan.productPage).length));
    assert.equal(codes(plan.productPage).length + plan.hiddenCount, allCodes(groups).length);
    const reserved = plan.hiddenCount ? finishLayout.moreLineHeight : 0;
    assert.ok(finishLayout.cardsHeight(plan.productPage) + reserved <= finishLayout.productCapacity);
  });
}

test("the approved sample (8 wood, 4 metal, 12 fabric) fits on the product page", () => {
  for (const options of [on, off]) {
    const plan = planProductFinishes([group("Wood", 8), group("Metal", 4), group("Fabric", 12)], options);
    assert.equal(plan.productPage.length, 3);
    assert.equal(plan.continuationPages.length, 0);
    assert.equal(plan.hiddenCount, 0);
  }
});

test("a card split between pages is marked continued only after its first rows", () => {
  const plan = planProductFinishes([group("Fabric", 131)], on);
  const segments = [plan.productPage, ...plan.continuationPages].flat();
  assert.ok(segments.length > 1);
  assert.deepEqual(segments.map((segment) => segment.continued), segments.map((_, index) => index > 0));
  // A group that only starts on a later page is not a continuation.
  const moved = planProductFinishes([group("Wood", 48), group("Metal", 4)], on);
  assert.equal(moved.continuationPages[0][0].key, "Metal");
  assert.equal(moved.continuationPages[0][0].continued, false);
});

test("a long description puts every finish on continuation pages, even with the setting off", () => {
  const groups = [group("Fabric", 131)];
  const plan = planProductFinishes(groups, { allowContinuation: false, descriptionContinues: true });
  assert.deepEqual(plan.productPage, []);
  assert.equal(plan.hiddenCount, 0);
  assert.deepEqual(codes(plan.continuationPages.flat()), allCodes(groups));
});

test("empty groups are hidden and no finishes means no cards or pages", () => {
  assert.deepEqual(planProductFinishes([], on), { productPage: [], continuationPages: [], hiddenCount: 0 });
  assert.deepEqual(planProductFinishes([group("Empty", 0)], off), { productPage: [], continuationPages: [], hiddenCount: 0 });
  assert.deepEqual(planProductFinishes([group("Empty", 0), group("Metal", 2)], on).productPage.map((segment) => segment.key), ["Metal"]);
});

test("long finish names make rows taller, so fewer rows go on a page", () => {
  const longName = "Extra long melange fabric name with recycled wool and a second colour reference";
  const short = planProductFinishes([group("Fabric", 131)], on);
  const long = planProductFinishes([group("Fabric", 131, longName)], on);
  assert.ok(long.productPage[0].swatches.length < short.productPage[0].swatches.length);
  assert.ok(long.continuationPages.length > short.continuationPages.length);
  assert.equal(codes([long.productPage, ...long.continuationPages].flat()).length, 131);
});
