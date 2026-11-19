import assert from "node:assert/strict";
import test, { mock } from "node:test";

const calls: Array<[string, unknown?]> = [];
const saved = { currency: "EUR", rate_to_aed: 4.25, updated_at: "2026-11-19T10:00:00Z", updated_by: "owner" };
let canEdit = false;
let canView = false;
let failAt: "auth" | "rpc" | "rpc-result" | undefined;

mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => {
    if (failAt === "auth") throw new Error("internal authentication error");
    return { user: { id: "owner" }, displayName: "Owner" };
  },
} });
mock.module("@/lib/supabase/server", { namedExports: {
  createClient: async () => ({
    rpc: async (name: string, args?: unknown) => {
      calls.push([name, args]);
      if (failAt === "rpc") throw new Error("internal database error");
      if (name === "currency_rates_can_edit") return { data: canEdit };
      if (name === "currency_rates_can_view") return { data: canView };
      return failAt === "rpc-result" ? { error: { message: "private error" } } : { data: true };
    },
    from: (table: string) => {
      const query = {
        select: (columns: string) => {
          calls.push([table, columns]);
          return query;
        },
        order: () => query,
        in: () => query,
        returns: async () => ({ data: table === "profiles" ? [{ id: "owner", full_name: "Company Owner" }] : [saved] }),
      };
      return query;
    },
  }),
} });
mock.module("next/cache", { namedExports: { revalidatePath: (path: string) => calls.push(["revalidate", path]) } });

const { listCurrencyDefaultRatesAction, getCurrencyRateSettings, setCurrencyDefaultRateAction, removeCurrencyDefaultRateAction } =
  await import("./currency-default-rates-actions");

test.beforeEach(() => {
  calls.length = 0;
  canEdit = false;
  canView = false;
  failAt = undefined;
});

test("a price reader gets one public rate list but no settings or writes", async () => {
  assert.deepEqual(await listCurrencyDefaultRatesAction(), []);
  assert.deepEqual(calls, [["currency_rates_can_view", undefined]]);
  canView = true;
  assert.deepEqual(await listCurrencyDefaultRatesAction(), [{ currency: "EUR", rate: 4.25, updatedAt: saved.updated_at }]);
  assert.equal(await getCurrencyRateSettings(), null);
  assert.deepEqual(await setCurrencyDefaultRateAction("EUR", 4.25), { ok: false, message: "You cannot manage currency rates." });
  assert.deepEqual(await removeCurrencyDefaultRateAction("EUR"), { ok: false, message: "You cannot manage currency rates." });
  assert.ok(calls.every(([name]) => !/^(set_|remove_|revalidate)/.test(name)));
});

test("edits reject invalid currency and rate values without a write", async () => {
  canEdit = true;
  for (const code of ["AED", "EU", "€UR", "EURO"]) {
    assert.equal((await setCurrencyDefaultRateAction(code, 4.25)).ok, false);
    assert.equal((await removeCurrencyDefaultRateAction(code)).ok, false);
  }
  for (const rate of [0, 0.000099, 100001, 4.1234567, NaN, Infinity]) {
    assert.equal((await setCurrencyDefaultRateAction("EUR", rate)).ok, false);
  }
  assert.ok(calls.every(([name]) => name === "currency_rates_can_edit"));
});

test("authorized writes use the session RPCs and refresh both pages", async () => {
  canEdit = true;
  assert.deepEqual(await setCurrencyDefaultRateAction(" gbp ", 4.123456), { ok: true });
  assert.deepEqual(await removeCurrencyDefaultRateAction("GBP"), { ok: true });
  assert.deepEqual(calls, [
    ["currency_rates_can_edit", undefined], ["set_currency_default_rate", { p_currency: "GBP", p_rate: 4.123456 }],
    ["revalidate", "/settings/company"], ["revalidate", "/products/gallery"],
    ["currency_rates_can_edit", undefined], ["remove_currency_default_rate", { p_currency: "GBP" }],
    ["revalidate", "/settings/company"], ["revalidate", "/products/gallery"],
  ]);
  assert.deepEqual(await getCurrencyRateSettings(), [{
    currency: "EUR", rate: 4.25, updatedAt: saved.updated_at, updatedBy: "Company Owner",
  }]);
});

test("auth redirects, exceptions and database errors never escape to callers", async () => {
  canEdit = true;
  for (const failure of ["auth", "rpc"] as const) {
    failAt = failure;
    assert.deepEqual(await listCurrencyDefaultRatesAction(), []);
    assert.equal(await getCurrencyRateSettings(), null);
    assert.deepEqual(await setCurrencyDefaultRateAction("EUR", 4), { ok: false, message: "Could not update the currency rate." });
    assert.equal((await removeCurrencyDefaultRateAction("EUR")).ok, false);
  }
  failAt = "rpc-result";
  assert.deepEqual(await removeCurrencyDefaultRateAction("EUR"), { ok: false, message: "Could not update the currency rate." });
  assert.ok(calls.every(([name]) => name !== "revalidate"));
});
