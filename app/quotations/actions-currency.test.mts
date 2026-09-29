// Quotation output currency hardening: quotations.currency must always be AED, regardless
// of submitted form data. Source/product pricing currencies (AED/EUR/USD) are untouched.
// app/quotations/actions.ts is huge and heavily aliased/coupled - source-text structural
// assertions are the established convention for this file (see actions-workstation.test.mts),
// not real execution.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const actionsSource = normalize(readFileSync("app/quotations/actions.ts", "utf8"));
const folderFormSource = normalize(readFileSync("components/quotations/quotation-folder-form.tsx", "utf8"));
const documentSetupSource = normalize(readFileSync("components/quotations/document-setup-dialog.tsx", "utf8"));
const migrationSource = normalize(readFileSync("supabase/migrations/20260929120000_quotations_currency_aed_only.sql", "utf8"));
const currenciesSource = normalize(readFileSync("lib/currencies.ts", "utf8"));

// 1/4/5/6. quotationPayload() (createQuotation, updateQuotation, updateQuotationEnquiryDetails)
// always writes the literal AED default - never reads submitted currency, so no forged
// currency=EUR or currency=USD form value can reach this field.
test("1/4/5/6. quotationPayload() forces currency to defaultCurrency, never reading submitted form data", () => {
  assert.ok(actionsSource.includes(
    "layout_mode: textValue(formData, \"layout_mode\") || \"standard_proposal\",\n" +
    "    // Quotation OUTPUT currency is fixed at AED (business rule) - submitted currency is\n" +
    "    // never trusted here. Source/product pricing currencies are untouched elsewhere.\n" +
    "    currency: defaultCurrency,",
  ));
  // Guard against a regression that re-adds a formData-derived currency read inside quotationPayload.
  const payloadFnStart = actionsSource.indexOf("function quotationPayload(formData: FormData, userId?: string) {");
  const payloadFnEnd = actionsSource.indexOf("\n}", payloadFnStart);
  const payloadFnBody = actionsSource.slice(payloadFnStart, payloadFnEnd);
  assert.ok(!payloadFnBody.includes("textValue(formData, \"currency\")"));
});

// Same guarantee for updateQuotationDocumentSetup's local payload, which also writes the
// top-level quotations.currency column (via the update({...quotationPayload, ...}) spread).
test("document setup's quotations-table write also forces currency to defaultCurrency", () => {
  const setupFnStart = actionsSource.indexOf("export async function updateQuotationDocumentSetup(formData: FormData) {");
  const setupFnEnd = actionsSource.indexOf("\nexport async function updateQuotationExtraDiscount", setupFnStart);
  const setupFnBody = actionsSource.slice(setupFnStart, setupFnEnd);
  assert.ok(setupFnBody.includes("currency: defaultCurrency,"));
  assert.ok(!setupFnBody.includes("documentSetupText(formData, \"currency\")"));
  // The write to the quotations table still spreads this payload, so the DB column is covered too.
  assert.ok(setupFnBody.includes(".update({\n      ...quotationPayload,"));
});

// 2. quotation folder UI no longer offers EUR/USD
test("2. quotation folder form shows AED as a read-only field, no currency selector", () => {
  assert.ok(!folderFormSource.includes("supportedCurrencies"));
  assert.ok(!folderFormSource.includes('name="currency"'));
  assert.ok(folderFormSource.includes('<span className="text-xs font-semibold uppercase text-zinc-500">Currency</span>'));
  assert.ok(folderFormSource.includes('value="AED"'));
  assert.ok(folderFormSource.includes("readOnly"));
});

// 3. document setup shows AED read-only, no longer an editable currency field
test("3. document setup dialog shows AED via the existing ReadOnly helper, no editable currency Field", () => {
  assert.ok(!documentSetupSource.includes('<Field name="currency"'));
  assert.ok(documentSetupSource.includes('<ReadOnly label="Currency" value="AED" />'));
});

// 7/9/10. migration adds a strict-equality AED-only CHECK constraint (rejects any other
// value, including EUR/USD, structurally - not just the two known currencies).
test("7/9/10. migration adds a strict currency = 'AED' CHECK constraint", () => {
  assert.ok(migrationSource.includes("check (currency = 'AED')"));
  assert.ok(migrationSource.includes("add constraint quotations_currency_aed_only_check"));
  assert.ok(migrationSource.includes("drop constraint if exists quotations_currency_aed_only_check"));
});

// 8. migration is purely additive - no UPDATE/data conversion of existing rows, so it either
// validates cleanly against current AED-only data or fails loudly (never silently rewrites).
test("8. migration performs no data conversion - additive ALTER TABLE only", () => {
  assert.ok(!/\bupdate\s+public\.quotations\b/i.test(migrationSource));
  assert.ok(!/\bexchange_rate\b|\bconvert\(/i.test(migrationSource));
  assert.ok(migrationSource.includes("alter table public.quotations"));
});

// 11/12/14. source-pricing currencies remain fully supported - unchanged from before this task.
test("11/12/14. lib/currencies.ts still supports AED/EUR/USD for source pricing", () => {
  assert.ok(currenciesSource.includes('{ code: "AED", label: "AED - UAE Dirham" }'));
  assert.ok(currenciesSource.includes('{ code: "EUR", label: "EUR - Euro" }'));
  assert.ok(currenciesSource.includes('{ code: "USD", label: "USD - US Dollar" }'));
  assert.ok(currenciesSource.includes("export const defaultCurrency = \"AED\";"));
});

// 13. manual currency conversion pipeline (source -> AED via manual exchange rate) untouched.
test("13. applyManualCurrencyConversion and the source-to-AED conversion pipeline are untouched", () => {
  assert.ok(actionsSource.includes("export async function applyManualCurrencyConversion(formData: FormData) {"));
  assert.ok(actionsSource.includes('Enter ${currency} to AED exchange rate before adding this product.'));
  assert.ok(actionsSource.includes('rowOutputCurrency = nonAedCurrencies.length ? "AED" : rowCurrency;'));
  assert.ok(actionsSource.includes("target_currency: \"AED\","));
});

// 15. quotation pricing/rounding math untouched - this task only touches the currency field.
test("15. quotation pricing/rounding math is untouched", () => {
  const pricingSource = readFileSync("lib/quotation-pricing.ts", "utf8");
  assert.ok(pricingSource.includes("export const QUOTE_ROUNDING_STEP = 5;"));
  assert.ok(actionsSource.includes("async function recalculateQuotationTotals"));
});
