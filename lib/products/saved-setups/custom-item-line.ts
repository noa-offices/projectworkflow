/**
 * Custom items <-> manual quote rows (PR 2b-2). PURE: no React, no database.
 *
 * customItemFromRow: which fields of a manual row are offered when saving it as a custom item.
 *   Copied: item name, code, brand, specification, unit, price, currency.
 *   NEVER copied: quantity, discount, totals, section, notes, internal cost, image, ids.
 * rowOverlayFromCustomItem: the ONLY fields laid over an ordinary manual row (createEmptyItem / the blank-row
 *   payload) when a custom item is added to a quote. Quantity and every other field stay at their defaults.
 *   Currency rule: same currency as the quote -> the price goes straight in. Different currency -> unit price 0
 *   plus the EXISTING manual-source keys (manual_source_price / manual_source_currency, read by
 *   applyManualCurrencyConversion), so an unconverted foreign price never reaches the totals. No new conversion logic.
 */
import { normalizeCurrency, parseSupportedCurrency } from "@/lib/currencies";
import type { CustomItemListItem } from "./custom-item";

export type ManualRowLike = {
  item_type?: string | null;
  line_style?: string | null;
  source_template_id?: string | null;
  item_name_snapshot?: string | null;
  item_code_snapshot?: string | null;
  brand_name_snapshot?: string | null;
  specification_snapshot?: string | null;
  unit_label?: string | null;
  unit_price?: number | string | null;
  currency?: string | null;
};

export type CustomItemDefaults = {
  brandName: string;
  itemName: string;
  itemCode: string;
  specification: string;
  unitLabel: string;
  sellingPrice: string;
  currency: string;
};

export type CustomItemFromRow =
  | { ok: true; defaults: CustomItemDefaults }
  | { ok: false; reason: "not_a_manual_row"; message: string };

const NOT_MANUAL = "Only manual item rows can be saved as custom items.";
const NON_ITEM_STYLES = new Set(["heading", "note", "blank"]);

/** A manual row: item_type "custom", no library template, and an ordinary item style (not heading, note or blank). */
export function isManualItemRow(row: ManualRowLike): boolean {
  return row.item_type === "custom" && !row.source_template_id && !NON_ITEM_STYLES.has(String(row.line_style ?? "normal"));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function customItemFromRow(row: ManualRowLike): CustomItemFromRow {
  if (!isManualItemRow(row)) return { ok: false, reason: "not_a_manual_row", message: NOT_MANUAL };
  const price = Number(row.unit_price);
  return {
    ok: true,
    defaults: {
      brandName: text(row.brand_name_snapshot),
      itemName: text(row.item_name_snapshot),
      itemCode: text(row.item_code_snapshot),
      specification: text(row.specification_snapshot),
      unitLabel: text(row.unit_label) || "Pc",
      sellingPrice: Number.isFinite(price) && price > 0 ? String(price) : "",
      currency: parseSupportedCurrency(row.currency) ?? "AED",
    },
  };
}

export type CustomItemRowOverlay = {
  item_name_snapshot: string;
  item_code_snapshot: string | null;
  brand_name_snapshot: string;
  specification_snapshot: string | null;
  unit_label: string;
  unit_price: number;
  currency: string;
  /** Present ONLY when the item's currency differs from the quote's currency. */
  source_component_data?: { manual_source_price: number; manual_source_currency: string };
  /** Short plain-English note to show the user when the price still has to be converted. */
  conversionNote: string | null;
};

export function rowOverlayFromCustomItem(
  item: Pick<CustomItemListItem, "brandName" | "itemName" | "itemCode" | "specification" | "unitLabel" | "sellingPrice" | "currency">,
  quoteCurrency: string | null | undefined,
): CustomItemRowOverlay {
  const quote = normalizeCurrency(quoteCurrency);
  const itemCurrency = normalizeCurrency(item.currency);
  const base = {
    item_name_snapshot: item.itemName,
    item_code_snapshot: item.itemCode ?? null,
    brand_name_snapshot: item.brandName,
    specification_snapshot: item.specification ?? null,
    unit_label: item.unitLabel || "Pc",
    currency: quote,
  };
  if (itemCurrency === quote) return { ...base, unit_price: item.sellingPrice, conversionNote: null };
  return {
    ...base,
    unit_price: 0,
    source_component_data: { manual_source_price: item.sellingPrice, manual_source_currency: itemCurrency },
    conversionNote: `Price is in ${itemCurrency}. Convert it to ${quote} before sending.`,
  };
}

/** The overlay without the UI-only note: exactly what is written onto the row. */
export function overlayFields(overlay: CustomItemRowOverlay): Omit<CustomItemRowOverlay, "conversionNote"> {
  const { conversionNote: _note, ...fields } = overlay;
  void _note;
  return fields;
}
