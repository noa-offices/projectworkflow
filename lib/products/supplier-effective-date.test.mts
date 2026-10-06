import assert from "node:assert/strict";
import test from "node:test";
import { resolveApplicableSupplierSourceVersion, supplierBusinessDate, upcomingSupplierSourceVersions } from "./supplier-price-repository.js";

type V = { id: string; status: string; effective_from: string | null; created_at: string };
const v = (id: string, extra: Partial<V> = {}): V => ({ id, status: "imported", effective_from: null, created_at: "2026-01-01T00:00:00Z", ...extra });
const pick = (versions: V[], day: string) => resolveApplicableSupplierSourceVersion(versions, day)?.id ?? null;

test("one imported undated version is applicable", () => {
  assert.equal(pick([v("a")], "2026-10-20"), "a");
});

test("one past-effective version is applicable", () => {
  assert.equal(pick([v("a", { effective_from: "2026-10-01" })], "2026-10-20"), "a");
});

test("only a future-dated version means there is no applicable version, and it stays upcoming", () => {
  const versions = [v("nov", { effective_from: "2026-11-01" })];
  assert.equal(pick(versions, "2026-10-20"), null);
  assert.deepEqual(upcomingSupplierSourceVersions(versions, "2026-10-20").map((item) => item.id), ["nov"]);
});

test("October stays current on 20 October while November is upcoming", () => {
  const versions = [v("oct", { effective_from: "2026-10-01" }), v("nov", { effective_from: "2026-11-01" })];
  assert.equal(pick(versions, "2026-10-20"), "oct");
  assert.deepEqual(upcomingSupplierSourceVersions(versions, "2026-10-20").map((item) => item.id), ["nov"]);
});

test("November becomes applicable on its effective date, with no manual step", () => {
  const versions = [v("oct", { effective_from: "2026-10-01" }), v("nov", { effective_from: "2026-11-01" })];
  assert.equal(pick(versions, "2026-10-31"), "oct");
  assert.equal(pick(versions, "2026-11-01"), "nov");
  assert.deepEqual(upcomingSupplierSourceVersions(versions, "2026-11-01"), []);
});

test("two applicable dated versions: the latest effective date wins, regardless of import order", () => {
  const versions = [v("late-import", { effective_from: "2026-09-01", created_at: "2026-10-15T00:00:00Z" }), v("newer-date", { effective_from: "2026-10-01", created_at: "2026-02-01T00:00:00Z" })];
  assert.equal(pick(versions, "2026-10-20"), "newer-date");
});

test("deterministic tie-break: same effective date, newest import, then id", () => {
  const sameDate = [v("a", { effective_from: "2026-10-01", created_at: "2026-10-01T00:00:00Z" }), v("b", { effective_from: "2026-10-01", created_at: "2026-10-02T00:00:00Z" })];
  assert.equal(pick(sameDate, "2026-10-20"), "b");
  const sameInstant = [v("a", { effective_from: "2026-10-01" }), v("b", { effective_from: "2026-10-01" })];
  assert.equal(pick(sameInstant, "2026-10-20"), "b");
});

test("archived, failed, uploading and importing versions are ignored", () => {
  const versions = [v("archived", { status: "archived", created_at: "2026-10-05T00:00:00Z" }), v("failed", { status: "failed" }), v("uploading", { status: "uploading" }), v("importing", { status: "importing" }), v("ok")];
  assert.equal(pick(versions, "2026-10-20"), "ok");
});

test("undated legacy: the newest imported version stays current as before", () => {
  const versions = [v("old", { created_at: "2025-01-01T00:00:00Z" }), v("new", { created_at: "2026-01-01T00:00:00Z" })];
  assert.equal(pick(versions, "2026-10-20"), "new");
});

test("an undated version is not treated as future and ranks below a dated applicable version", () => {
  const versions = [v("undated", { created_at: "2026-10-10T00:00:00Z" }), v("dated", { effective_from: "2026-10-01" })];
  assert.equal(pick(versions, "2026-10-20"), "dated");
  assert.equal(upcomingSupplierSourceVersions(versions, "2026-10-20").length, 0);
});

test("business date is the Dubai date: 00:30 in Dubai on 6 Oct is still 6 Oct, while UTC is 5 Oct", () => {
  const dubaiMidnight = new Date("2026-10-05T20:30:00Z"); // 00:30 on 6 October in Dubai (UTC+4)
  assert.equal(supplierBusinessDate(dubaiMidnight), "2026-10-06");
  assert.equal(new Date("2026-10-05T20:30:00Z").toISOString().slice(0, 10), "2026-10-05");
});

test("a version effective on the Dubai business date is applicable on that day", () => {
  const dubaiMorning = new Date("2026-11-01T00:30:00Z"); // 04:30 on 1 November in Dubai
  const versions = [v("nov", { effective_from: "2026-11-01" })];
  assert.equal(resolveApplicableSupplierSourceVersion(versions, supplierBusinessDate(dubaiMorning))?.id, "nov");
});
