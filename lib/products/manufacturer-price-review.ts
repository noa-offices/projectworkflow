import type { ManufacturerPriceDifference, ManufacturerUpdateDiff } from "./manufacturer-update-diff";
import { manufacturerPricePatchKey } from "./manufacturer-price-patches";

export function manufacturerChangedPriceFields(diff: ManufacturerUpdateDiff) {
  return Object.values(diff.sections).flatMap((section) => section.matchedItems).flatMap((item) => item.priceFields).filter((field) => field.priceChanged);
}

export function manufacturerSelectablePriceFields(diff: ManufacturerUpdateDiff) {
  return manufacturerChangedPriceFields(diff).filter((field) => !field.currencyChanged);
}

export function defaultManufacturerPriceSelection(diff: ManufacturerUpdateDiff) {
  return new Set(manufacturerSelectablePriceFields(diff).map(manufacturerPricePatchKey));
}

export function selectedManufacturerPricePatches(diff: ManufacturerUpdateDiff, selected: ReadonlySet<string>): ManufacturerPriceDifference[] {
  return manufacturerSelectablePriceFields(diff).filter((field) => selected.has(manufacturerPricePatchKey(field)));
}

export function formatManufacturerPrice(value: number | null, currency: string | null) {
  return value === null ? "—" : `${currency ? `${currency} ` : ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}`;
}

export function manufacturerReviewTitle(code: string | null | undefined, name: string | null | undefined) {
  const visibleCode = code?.trim() ?? "";
  const visibleName = name?.trim() ?? "";
  if (!visibleCode) return visibleName || "Unnamed item";
  return visibleName && visibleName !== visibleCode ? `${visibleCode} — ${visibleName}` : visibleCode;
}

export function manufacturerReviewContext(groupName: string, subgroupName: string | null | undefined, fieldLabel: string) {
  return [groupName, subgroupName?.trim() || null, fieldLabel].filter((value): value is string => Boolean(value)).join(" · ");
}
