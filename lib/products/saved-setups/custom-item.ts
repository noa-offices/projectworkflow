/**
 * My Collection custom items: PURE validator, normaliser and display helpers (no React, no database).
 * A custom item is an item that is NOT in the Product Library, saved with a SELLING price and currency.
 * No cost and no margin. Limits match supabase/migrations/20261117100000_saved_custom_items.sql.
 */
import { parseSupportedCurrency, supportedCurrencies, type SupportedCurrency } from "@/lib/currencies";
import { formatSavedDate, type CollectionDisplayItem } from "./collection-view";

export const CUSTOM_ITEM_BRAND_MAX = 80;
export const CUSTOM_ITEM_NAME_MAX = 120;
export const CUSTOM_ITEM_CODE_MAX = 60;
export const CUSTOM_ITEM_SPEC_MAX = 4000;
export const CUSTOM_ITEM_UNIT_MAX = 20;
export const CUSTOM_ITEM_DEFAULT_UNIT = "Pc";
export const CUSTOM_ITEM_PRICE_LIMIT = 1_000_000_000;
export const CUSTOM_ITEM_CURRENCIES = supportedCurrencies;

export type CustomItemField = "brandName" | "itemName" | "itemCode" | "specification" | "unitLabel" | "sellingPrice" | "currency";
export type CustomItemFieldErrors = Partial<Record<CustomItemField, string>>;

/** Raw form input. Anything the client sends is untrusted; owner, source and sharing columns are never read. */
export type CustomItemInput = {
  brandName?: unknown;
  itemName?: unknown;
  itemCode?: unknown;
  specification?: unknown;
  unitLabel?: unknown;
  sellingPrice?: unknown;
  currency?: unknown;
};

export type CleanCustomItem = {
  brand_name: string;
  item_name: string;
  item_code: string | null;
  specification: string | null;
  unit_label: string;
  selling_price: number;
  currency: SupportedCurrency;
};

export type CustomItemValidation = { ok: true; value: CleanCustomItem } | { ok: false; errors: CustomItemFieldErrors };

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePrice(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const text = typeof raw === "number" ? (Number.isFinite(raw) ? String(raw) : "") : typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, error: "Enter a selling price." };
  if (text.startsWith("-")) return { ok: false, error: "The price cannot be negative." };
  // Plain decimal text only (no exponent, no thousands separator).
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Enter the price as a number, for example 1200 or 1200.50." };
  const decimals = text.split(".")[1] ?? "";
  if (decimals.length > 2) return { ok: false, error: "Use at most 2 decimal places." };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: "Enter the price as a number, for example 1200 or 1200.50." };
  if (value >= CUSTOM_ITEM_PRICE_LIMIT) return { ok: false, error: "The price must be less than 1,000,000,000." };
  return { ok: true, value };
}

export function validateCustomItem(input: CustomItemInput | null | undefined): CustomItemValidation {
  const errors: CustomItemFieldErrors = {};
  const brand = trimmed(input?.brandName);
  if (!brand) errors.brandName = "Enter a brand.";
  else if (brand.length > CUSTOM_ITEM_BRAND_MAX) errors.brandName = `The brand can have at most ${CUSTOM_ITEM_BRAND_MAX} characters.`;

  const name = trimmed(input?.itemName);
  if (!name) errors.itemName = "Enter an item name.";
  else if (name.length > CUSTOM_ITEM_NAME_MAX) errors.itemName = `The item name can have at most ${CUSTOM_ITEM_NAME_MAX} characters.`;

  const code = trimmed(input?.itemCode);
  if (code.length > CUSTOM_ITEM_CODE_MAX) errors.itemCode = `The code can have at most ${CUSTOM_ITEM_CODE_MAX} characters.`;

  const specification = trimmed(input?.specification);
  if (specification.length > CUSTOM_ITEM_SPEC_MAX) errors.specification = `The specification can have at most ${CUSTOM_ITEM_SPEC_MAX} characters.`;

  const unit = trimmed(input?.unitLabel) || CUSTOM_ITEM_DEFAULT_UNIT;
  if (unit.length > CUSTOM_ITEM_UNIT_MAX) errors.unitLabel = `The unit can have at most ${CUSTOM_ITEM_UNIT_MAX} characters.`;

  const price = parsePrice(input?.sellingPrice);
  if (!price.ok) errors.sellingPrice = price.error;

  const currency = parseSupportedCurrency(input?.currency);
  if (!currency) errors.currency = `Choose a currency (${CUSTOM_ITEM_CURRENCIES.map((entry) => entry.code).join(", ")}).`;

  if (Object.keys(errors).length > 0 || !price.ok || !currency) return { ok: false, errors };
  return {
    ok: true,
    value: {
      brand_name: brand,
      item_name: name,
      item_code: code || null,
      specification: specification || null,
      unit_label: unit,
      selling_price: price.value,
      currency,
    },
  };
}

/** First error message, for places that show one line. */
export function firstCustomItemError(errors: CustomItemFieldErrors): string {
  return Object.values(errors)[0] ?? "The item is not valid.";
}

export type CustomItemListItem = {
  id: string;
  brandName: string;
  itemName: string;
  itemCode: string | null;
  specification: string | null;
  unitLabel: string;
  sellingPrice: number;
  currency: string;
  priceSavedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
};

/** Brand -> brandName; item name -> productName AND setupName (so collection-view search, sort and grouping work). */
export type CustomCollectionItem = CollectionDisplayItem & { item: CustomItemListItem };

export function toCollectionItem(item: CustomItemListItem): CustomCollectionItem {
  return {
    id: item.id,
    brandName: item.brandName,
    productName: item.itemName,
    setupName: item.itemName,
    code: item.itemCode,
    createdAt: item.createdAt,
    lastUsedAt: item.lastUsedAt,
    useCount: item.useCount,
    item,
  };
}

/** "AED 1,200" or "USD 1,200.50". */
export function formatCustomItemPrice(currency: string, price: number): string {
  return `${currency} ${price.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(price) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "AED 1,200 · Saved price 17 Nov 2026". */
export function customItemPriceLine(item: Pick<CustomItemListItem, "currency" | "sellingPrice" | "priceSavedAt">): string {
  const date = formatSavedDate(item.priceSavedAt);
  return [formatCustomItemPrice(item.currency, item.sellingPrice), date ? `Saved price ${date}` : ""].filter(Boolean).join(" · ");
}
