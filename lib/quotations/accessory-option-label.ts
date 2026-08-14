export type AccessoryOptionLabelItem = { item_name?: string | null; supplier_price_list_code?: string | null };

export function accessoryOptionLabel(item: AccessoryOptionLabelItem, formattedPrice: string) {
  const name = item.item_name?.trim() || "Accessory";
  const code = item.supplier_price_list_code?.trim() || "";
  return code && code !== name ? `${code} — ${name} — ${formattedPrice}` : `${name} — ${formattedPrice}`;
}
