import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = () => read("../../supabase/migrations/20261119270000_product_library_default_rates.sql");

// The mock answers each permission RPC from the role list written in the new migration.
function rolesIn(name: string) {
  const body = migration().split(`function public.${name}()`)[1]?.split("$$")[1] ?? "";
  assert.match(body, /public\.current_user_is_active\(\)/);
  return [...(/ in \(([^)]*)\)/.exec(body)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

const calls: Array<[string, unknown?]> = [];
const saved = { currency: "EUR", rate_to_aed: 4.3, updated_at: "2026-11-27T10:00:00Z", updated_by: "buyer" };
let role = "viewer";
let failAt: "auth" | "rpc" | "rpc-result" | "select" | undefined;

mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => {
    if (failAt === "auth") throw new Error("internal authentication error");
    return { user: { id: "me" }, displayName: "Me" };
  },
} });
mock.module("@/lib/supabase/server", { namedExports: {
  createClient: async () => ({
    rpc: async (name: string, args?: unknown) => {
      calls.push([name, args]);
      if (failAt === "rpc") throw new Error("internal database error");
      if (/_can_(view|edit)$/.test(name)) return { data: rolesIn(name).includes(role) };
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
        returns: async () => failAt === "select" && table !== "profiles"
          ? { data: null, error: { message: "private error" } }
          : { data: table === "profiles" ? [{ id: "buyer", full_name: "Company Buyer" }] : [saved] },
      };
      return query;
    },
  }),
} });
mock.module("next/cache", { namedExports: { revalidatePath: (path: string) => calls.push(["revalidate", path]) } });

const {
  listProductLibraryDefaultRatesAction,
  getProductLibraryRateSettings,
  setProductLibraryDefaultRateAction,
  removeProductLibraryDefaultRateAction,
} = await import("./product-library-default-rates-actions");

const listed = [{ currency: "EUR", rate: 4.3, updatedAt: saved.updated_at }];
const denied = { ok: false, message: "You cannot manage currency rates." };

test.beforeEach(() => {
  calls.length = 0;
  role = "viewer";
  failAt = undefined;
});

for (const editor of ["system_owner", "admin_manager", "procurement_manager"]) {
  test(`${editor} can read, set and remove Product Library rates`, async () => {
    role = editor;
    assert.deepEqual(await listProductLibraryDefaultRatesAction(), listed);
    assert.deepEqual(await getProductLibraryRateSettings(), [{ ...listed[0], updatedBy: "Company Buyer" }]);
    calls.length = 0;
    assert.deepEqual(await setProductLibraryDefaultRateAction(" gbp ", 4.123456), { ok: true });
    assert.deepEqual(await removeProductLibraryDefaultRateAction("GBP"), { ok: true });
    assert.deepEqual(calls, [
      ["product_library_rates_can_edit", undefined],
      ["set_product_library_default_rate", { p_currency: "GBP", p_rate: 4.123456 }],
      ["revalidate", "/settings/company"],
      ["product_library_rates_can_edit", undefined],
      ["remove_product_library_default_rate", { p_currency: "GBP" }],
      ["revalidate", "/settings/company"],
    ]);
  });
}

for (const reader of ["sales_designer", "sales_coordinator", "designer"]) {
  test(`${reader} can only view Product Library rates`, async () => {
    role = reader;
    assert.deepEqual(await listProductLibraryDefaultRatesAction(), listed);
    assert.equal(await getProductLibraryRateSettings(), null);
    assert.deepEqual(await setProductLibraryDefaultRateAction("EUR", 4), denied);
    assert.deepEqual(await removeProductLibraryDefaultRateAction("EUR"), denied);
    assert.ok(calls.every(([name]) => !/^(set_|remove_|revalidate)/.test(name)));
  });
}

for (const outsider of ["viewer", "warehouse_staff"]) {
  test(`${outsider} gets nothing`, async () => {
    role = outsider;
    assert.deepEqual(await listProductLibraryDefaultRatesAction(), []);
    assert.equal(await getProductLibraryRateSettings(), null);
    assert.deepEqual(await setProductLibraryDefaultRateAction("EUR", 4), denied);
    assert.deepEqual(await removeProductLibraryDefaultRateAction("EUR"), denied);
    assert.ok(calls.every(([name]) => /_can_(view|edit)$/.test(name)));
  });
}

test("invalid currencies and rates are rejected without a write", async () => {
  role = "procurement_manager";
  for (const code of ["AED", "EU", "€UR", "EURO"]) {
    assert.equal((await setProductLibraryDefaultRateAction(code, 4.25)).ok, false);
    assert.equal((await removeProductLibraryDefaultRateAction(code)).ok, false);
  }
  for (const rate of [0, -1, 0.000099, 100001, 4.1234567, NaN, Infinity, "4" as unknown as number]) {
    assert.equal((await setProductLibraryDefaultRateAction("EUR", rate)).ok, false);
  }
  assert.ok(calls.every(([name]) => name === "product_library_rates_can_edit"));
});

test("auth, database and read errors never escape to callers", async () => {
  role = "system_owner";
  for (const failure of ["auth", "rpc"] as const) {
    failAt = failure;
    assert.deepEqual(await listProductLibraryDefaultRatesAction(), []);
    assert.equal(await getProductLibraryRateSettings(), null);
    assert.equal((await setProductLibraryDefaultRateAction("EUR", 4)).ok, false);
    assert.equal((await removeProductLibraryDefaultRateAction("EUR")).ok, false);
  }
  failAt = "select";
  assert.deepEqual(await listProductLibraryDefaultRatesAction(), []);
  assert.equal(await getProductLibraryRateSettings(), null);
  failAt = "rpc-result";
  assert.deepEqual(await removeProductLibraryDefaultRateAction("EUR"), { ok: false, message: "Could not update the currency rate." });
  assert.ok(calls.every(([name]) => name !== "revalidate"));
});

test("the library actions use only the new table, never the gallery ones or the admin client", () => {
  const source = read("./product-library-default-rates-actions.ts");
  assert.doesNotMatch(source, /currency_default_rates|currency_rates_can|_currency_default_rate|createAdminClient|supabase\/admin|service_role/);
  const sql = migration().replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /currency_default_rates|currency_rates_can|_currency_default_rate/);
  assert.match(migration(), /NOT applied automatically/);
});

test("settings shows both sections, each gated and wired to its own actions", () => {
  const section = read("../../components/settings/company-settings-section.tsx");
  const card = read("../../components/settings/currency-rates-card.tsx");
  assert.match(section, /isCompany \? await getProductLibraryRateSettings\(\) : null/);
  assert.match(section, /\{currencyRates \? <CurrencyRatesCard rates=\{currencyRates\} \/> : null\}/);
  assert.match(section, /\{libraryRates \? <CurrencyRatesCard rates=\{libraryRates\} library \/> : null\}/);
  assert.match(card, /Product Gallery currency rates/);
  assert.match(card, /Product Library default rates/);
  assert.match(card, /Used as the default exchange rate when adding a product to a quotation\. Saved quotations are never changed\./);
  assert.match(card, /library\s*\? \{ set: setProductLibraryDefaultRateAction, remove: removeProductLibraryDefaultRateAction \}\s*: \{ set: setCurrencyDefaultRateAction, remove: removeCurrencyDefaultRateAction \}/);
});
