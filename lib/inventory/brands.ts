import type { InventoryBrand } from "./types";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isBrandSelection(value: string): boolean { return value === "none" || UUID.test(value) || (value.startsWith("local:") && UUID.test(value.slice(6))); }
export function brandValue(row: {brand_id: string | null; local_brand_id?: string | null}): string { return row.local_brand_id ? `local:${row.local_brand_id}` : row.brand_id || "none"; }
export function brandFields(data: FormData): {brand_id: string | null; local_brand_id: string | null} {
 const selected = data.get("brand_selection");
 if (typeof selected === "string") return selected.startsWith("local:") ? {brand_id:null,local_brand_id:selected.slice(6)} : {brand_id:selected === "none" ? null : selected,local_brand_id:null};
 return {brand_id: String(data.get("brand_id") || "") || null,local_brand_id:String(data.get("local_brand_id") || "") || null};
}
export function brandOptions(brands: InventoryBrand[]): [string,string][] { return [...brands.map(row => [row.kind === "local" ? `local:${row.id}` : row.id,row.kind === "local" ? `${row.name} (Inventory only)` : row.name] as [string,string]),["none","No brand"]]; }
export function brandFilterLabel(value: string, brands: InventoryBrand[]): string { return brandOptions(brands).find(([id])=>id===value)?.[1] ?? "Selected brand"; }
