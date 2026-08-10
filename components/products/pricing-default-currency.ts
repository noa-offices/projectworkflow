"use client";

import { defaultCurrency, normalizeCurrency } from "@/lib/currencies";
import { resolveInheritedPricingCurrency } from "@/lib/products/nullable-pricing";

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

export function resolveDefaultPricingCurrency({
  brandDefaultCurrency,
  existingRows: _existingRows,
  savedTemplateCurrency,
  trigger,
}: {
  brandDefaultCurrency?: string | null;
  existingRows?: CurrencyLikeRow[];
  savedTemplateCurrency?: string | null;
  trigger?: HTMLElement | null;
}) {
  void _existingRows;
  return resolveInheritedPricingCurrency({
    brandCurrency: brandDefaultCurrency,
    fallbackCurrency: defaultCurrency,
    normalizeCurrency,
    templateCurrency: savedTemplateCurrency?.trim() ? savedTemplateCurrency : formCurrencyFromTrigger(trigger),
  });
}

export function resolvePricingRowCurrency({
  rowCurrency,
  ...defaults
}: Parameters<typeof resolveDefaultPricingCurrency>[0] & { rowCurrency?: string | null }) {
  return resolveInheritedPricingCurrency({
    brandCurrency: defaults.brandDefaultCurrency,
    fallbackCurrency: defaultCurrency,
    normalizeCurrency,
    rowCurrency,
    templateCurrency: defaults.savedTemplateCurrency?.trim()
      ? defaults.savedTemplateCurrency
      : formCurrencyFromTrigger(defaults.trigger),
  });
}
