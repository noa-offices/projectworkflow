"use client";

import { useMemo, useState } from "react";
import { createCommissionRuleVersion } from "@/app/commissions/actions";
import {
  calculateCommission,
  type CommissionBasisType,
  type CommissionFormulaType,
  type CommissionTier,
} from "@/lib/commissions/calculation";
import type { SalesManagerOption } from "@/lib/commissions/types";
import { supportedCurrencies } from "@/lib/currencies";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-600";

export function CommissionRuleEditor({
  salesManagers,
}: {
  salesManagers: SalesManagerOption[];
}) {
  const [formulaType, setFormulaType] = useState<CommissionFormulaType>("percentage");
  const [basisType, setBasisType] = useState<CommissionBasisType>("approved_total_excluding_vat");
  const [percentageRate, setPercentageRate] = useState("2.5");
  const [fixedAmount, setFixedAmount] = useState("500");
  const [currency, setCurrency] = useState("AED");
  const [exampleAmount, setExampleAmount] = useState("100000");
  const [tiers, setTiers] = useState<CommissionTier[]>([
    { minimum: "0", maximum: "100000", rate: "1" },
    { minimum: "100000", maximum: "250000", rate: "1.5" },
    { minimum: "250000", maximum: null, rate: "2" },
  ]);

  const preview = useMemo(
    () => calculateCommission({
      basisAmount: formulaType === "fixed_amount" ? null : exampleAmount,
      currency,
      fixedAmount:
        formulaType === "fixed_amount" || formulaType === "percentage_plus_fixed"
          ? fixedAmount
          : null,
      fixedAmountCurrency: currency,
      formulaType,
      percentageRate:
        formulaType === "percentage" || formulaType === "percentage_plus_fixed"
          ? percentageRate
          : null,
      tierMethod: formulaType === "tiered_percentage" ? "slab" : null,
      tiers: formulaType === "tiered_percentage" ? tiers : null,
    }),
    [currency, exampleAmount, fixedAmount, formulaType, percentageRate, tiers],
  );

  function updateTier(index: number, field: keyof CommissionTier, value: string) {
    setTiers((current) => current.map((tier, tierIndex) => (
      tierIndex === index
        ? { ...tier, [field]: field === "maximum" && !value ? null : value }
        : tier
    )));
  }

  return (
    <form action={createCommissionRuleVersion} className="grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-zinc-950">Schedule rule version</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Saving ends the applicable previous version at the new effective time.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          Sales Manager
          <select name="salesperson_id" required className={inputClass}>
            <option value="">Select Sales Manager</option>
            {salesManagers.filter((manager) => manager.account_status === "active").map((manager) => (
              <option key={manager.id} value={manager.id}>{manager.display_name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          Formula
          <select
            name="formula_type"
            value={formulaType}
            onChange={(event) => setFormulaType(event.target.value as CommissionFormulaType)}
            className={inputClass}
          >
            <option value="percentage">Percentage</option>
            <option value="fixed_amount">Fixed amount</option>
            <option value="tiered_percentage">Tiered percentage</option>
            <option value="percentage_plus_fixed">Percentage + fixed</option>
            <option value="none">None</option>
          </select>
        </label>

        {formulaType !== "fixed_amount" && formulaType !== "none" ? (
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            Commission basis
            <select
              name="basis_type"
              value={basisType}
              onChange={(event) => setBasisType(event.target.value as CommissionBasisType)}
              className={inputClass}
            >
              <option value="approved_total_excluding_vat">Approved total excluding VAT</option>
              <option value="approved_total_including_vat">Approved total including VAT</option>
            </select>
          </label>
        ) : <input type="hidden" name="basis_type" value="" />}

        {formulaType === "percentage" || formulaType === "percentage_plus_fixed" ? (
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            Percentage rate
            <input
              name="percentage_rate"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              required
              value={percentageRate}
              onChange={(event) => setPercentageRate(event.target.value)}
              className={inputClass}
            />
          </label>
        ) : null}

        {formulaType === "fixed_amount" || formulaType === "percentage_plus_fixed" ? (
          <>
            <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
              Fixed amount
              <input
                name="fixed_amount"
                type="number"
                min="0"
                step="0.01"
                required
                value={fixedAmount}
                onChange={(event) => setFixedAmount(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
              Fixed amount currency
              <select
                name="fixed_amount_currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                className={inputClass}
              >
                {supportedCurrencies.map((item) => (
                  <option key={item.code} value={item.code}>{item.code}</option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          Effective from
          <input name="effective_from" type="datetime-local" required className={inputClass} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          Effective to (exclusive)
          <input name="effective_to" type="datetime-local" className={inputClass} />
        </label>
      </div>

      {formulaType === "tiered_percentage" ? (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Slab tiers</h3>
              <p className="text-xs text-zinc-500">The matching tier rate applies to the full basis.</p>
            </div>
            <button
              type="button"
              onClick={() => setTiers((current) => [
                ...current,
                { minimum: current.at(-1)?.maximum ?? "", maximum: null, rate: "" },
              ])}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Add tier
            </button>
          </div>
          {tiers.map((tier, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
              <input
                name="tier_minimum"
                aria-label={`Tier ${index + 1} minimum`}
                value={tier.minimum}
                onChange={(event) => updateTier(index, "minimum", event.target.value)}
                type="number"
                min="0"
                step="0.01"
                placeholder="Minimum"
                required
                className={inputClass}
              />
              <input
                name="tier_maximum"
                aria-label={`Tier ${index + 1} maximum`}
                value={tier.maximum ?? ""}
                onChange={(event) => updateTier(index, "maximum", event.target.value)}
                type="number"
                min="0"
                step="0.01"
                placeholder="No maximum"
                className={inputClass}
              />
              <input
                name="tier_rate"
                aria-label={`Tier ${index + 1} rate`}
                value={tier.rate}
                onChange={(event) => updateTier(index, "rate", event.target.value)}
                type="number"
                min="0"
                max="100"
                step="0.0001"
                placeholder="Rate %"
                required
                className={inputClass}
              />
              <button
                type="button"
                disabled={tiers.length === 1}
                onClick={() => setTiers((current) => current.filter((_, tierIndex) => tierIndex !== index))}
                className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-600 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        Notes
        <textarea name="notes" rows={2} className={inputClass} />
      </label>

      <div className="grid gap-3 rounded-md bg-zinc-50 p-4 md:grid-cols-[1fr_auto] md:items-end">
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          Preview example amount
          <input
            type="number"
            min="0"
            step="0.01"
            value={exampleAmount}
            onChange={(event) => setExampleAmount(event.target.value)}
            className={inputClass}
          />
        </label>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Calculation preview</p>
          <p className="mt-1 text-lg font-semibold text-zinc-950">
            {currency} {preview.originalCalculatedAmount}
          </p>
          {preview.matchedTier ? (
            <p className="text-xs text-zinc-500">Matched slab: {preview.matchedTier.rate}%</p>
          ) : null}
        </div>
        {preview.validationErrors.length ? (
          <p className="text-sm text-red-700 md:col-span-2">{preview.validationErrors[0]}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={!salesManagers.some((manager) => manager.account_status === "active") || preview.validationErrors.length > 0}
        className="justify-self-start rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        Save new rule version
      </button>
    </form>
  );
}
