"use client";

import { defaultCurrency, normalizeCurrency } from "@/lib/currencies";

type CurrencyLikeRow = {
  currency?: string | null;
};

function formCurrencyFromTrigger(trigger?: HTMLElement | null) {
  if (!trigger) {
    return null;
  }

  const form = trigger.closest("form");
  if (!form) {
    return null;
  }

  const currencyField = form.querySelector<HTMLSelectElement | HTMLInputElement>(
    'select[name="currency"], input[name="currency"]',
  );
  if (currencyField) {
    const value = currencyField.value.trim();
    return value ? normalizeCurrency(value) : null;
  }

  return null;
}

function existingRowsCurrency(rows: CurrencyLikeRow[]) {
  const counts = new Map<string, number>();

  rows.forEach((row) => {
    const currency = row.currency?.trim();
    if (!currency) {
      return;
    }

    const normalized = normalizeCurrency(currency);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  });

  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

export function resolveDefaultPricingCurrency({
  brandDefaultCurrency,
  existingRows = [],
  savedTemplateCurrency,
  trigger,
}: {
  brandDefaultCurrency?: string | null;
  existingRows?: CurrencyLikeRow[];
  savedTemplateCurrency?: string | null;
  trigger?: HTMLElement | null;
}) {
  return (
    (brandDefaultCurrency?.trim() ? normalizeCurrency(brandDefaultCurrency) : null) ||
    (savedTemplateCurrency?.trim() ? normalizeCurrency(savedTemplateCurrency) : null) ||
    formCurrencyFromTrigger(trigger) ||
    existingRowsCurrency(existingRows) ||
    defaultCurrency
  );
}
