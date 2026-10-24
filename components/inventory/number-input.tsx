"use client";

import { useState, type InputHTMLAttributes } from "react";
import { cleanNumberText, type NumberTextOptions } from "@/lib/inventory/number-input";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "inputMode"> & NumberTextOptions & {
  value?: string; defaultValue?: string | number | null; onValueChange?: (text: string) => void;
};
/**
 * Whole-number (or price) field for Inventory. Text input with a numeric keyboard, 16px text, leading zeros
 * removed as you type, and the whole value selected on focus so typing replaces the 0.
 */
export function NumberInput({ value, defaultValue, onValueChange, decimals = false, maxDecimals, onFocus, ...rest }: Props) {
  const options = { decimals, maxDecimals };
  const [own, setOwn] = useState(() => cleanNumberText(String(defaultValue ?? ""), options));
  const shown = value ?? own;
  return <input {...rest} type="text" inputMode={decimals ? "decimal" : "numeric"} autoComplete="off" value={shown}
    onFocus={event => { event.currentTarget.select(); onFocus?.(event); }}
    onChange={event => { const next = cleanNumberText(event.target.value, options); if (value === undefined) setOwn(next); onValueChange?.(next); }} />;
}
