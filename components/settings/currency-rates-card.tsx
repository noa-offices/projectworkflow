"use client";

import { useState, useTransition } from "react";
import {
  removeCurrencyDefaultRateAction,
  setCurrencyDefaultRateAction,
  type getCurrencyRateSettings,
} from "@/lib/products/gallery/currency-default-rates-actions";
import {
  removeProductLibraryDefaultRateAction,
  setProductLibraryDefaultRateAction,
} from "@/lib/products/product-library-default-rates-actions";

type Rows = NonNullable<Awaited<ReturnType<typeof getCurrencyRateSettings>>>;
const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Asia/Dubai" });
const input = "w-32 rounded-md border border-zinc-300 px-2 py-1.5 text-sm";
const button = "rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm font-medium disabled:opacity-50";

export function CurrencyRatesCard({ rates, library = false }: { rates: Rows; library?: boolean }) {
  const actions = library
    ? { set: setProductLibraryDefaultRateAction, remove: removeProductLibraryDefaultRateAction }
    : { set: setCurrencyDefaultRateAction, remove: removeCurrencyDefaultRateAction };
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const byCurrency = new Map(rates.map((row) => [row.currency, row]));
  const currencies = [...new Set(["EUR", "USD", ...byCurrency.keys()])];

  function update(currency: string, rate?: number) {
    startTransition(async () => {
      try {
        const result = rate === undefined
          ? await actions.remove(currency)
          : await actions.set(currency, rate);
        setMessage(result.ok ? (rate === undefined ? "Rate removed." : "Rate saved.") : result.message);
      } catch {
        setMessage("Could not update the currency rate.");
      }
    });
  }

  return (
    <section className="mt-5 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-950">{library ? "Product Library default rates" : "Product Gallery currency rates"}</h2>
      <p className="mt-2 text-sm text-zinc-600">
        {library
          ? "Used as the default exchange rate when adding a product to a quotation. Saved quotations are never changed."
          : "Company default rates to AED for Product Gallery prices."}
      </p>
      <div className="mt-4 divide-y divide-zinc-200">
        {currencies.map((currency) => {
          const row = byCurrency.get(currency);
          return (
            <form key={`${currency}:${row?.updatedAt ?? ""}`} className="flex flex-wrap items-center gap-2 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                update(currency, Number(new FormData(event.currentTarget).get("rate")));
              }}>
              <label className="flex items-center gap-2 text-sm font-medium">
                {currency}
                <input name="rate" aria-label={`${currency} rate to AED`} type="number" min="0.0001" max="100000" step="0.000001" required defaultValue={row?.rate} className={input} />
              </label>
              <button type="submit" className={button} disabled={pending}>Save</button>
              {row ? <button type="button" className={button} disabled={pending} onClick={() => update(currency)}>Remove</button> : null}
              {row ? (
                <p className="basis-full text-xs text-zinc-600">
                  Last updated {dateFormat.format(new Date(row.updatedAt))} by {row.updatedBy ?? "Unknown user"}
                </p>
              ) : null}
            </form>
          );
        })}
      </div>
      <form key={currencies.join(",")} className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const currency = String(data.get("currency")).trim().toUpperCase();
          if (byCurrency.has(currency) || currency === "EUR" || currency === "USD") {
            setMessage("Edit this currency in its existing row.");
            return;
          }
          update(currency, Number(data.get("rate")));
        }}>
        <input name="currency" aria-label="New currency code" placeholder="Currency code" required maxLength={3} pattern="[A-Za-z]{3}" className={input} />
        <input name="rate" aria-label="New currency rate to AED" placeholder="Rate to AED" type="number" min="0.0001" max="100000" step="0.000001" required className={input} />
        <button type="submit" className={button} disabled={pending}>Add currency</button>
      </form>
      <p role="status" className="mt-3 text-sm text-zinc-700">{pending ? "Updating currency rates..." : message}</p>
    </section>
  );
}
