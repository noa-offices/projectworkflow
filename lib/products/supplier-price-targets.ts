import { parseSupportedCurrency } from "../currencies";
import { normalizeManufacturerCode } from "./manufacturer-code";
import { pricingColumns } from "./pricing-category-columns";
import { hasMeaningfulBaseModelPricing, type BaseModelPricingLike } from "./base-model-pricing-state";
import { hasMeaningfulWorkstationPricing, type WorkstationPricingLike } from "./workstation-pricing-state";
import { hasMeaningfulCategoryPricing, type CategoryPricingLike } from "./category-pricing-state";
import { hasMeaningfulModularPricing, type ModularPricingLike } from "./modular-pricing-state";
import type { PriceTarget, ProductPriceInput } from "./supplier-price-contracts";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function storedId(value: unknown, context: string) { const id = text(value); if (!id) throw Error(`Persisted target identity missing: ${context}. No array-index fallback is allowed.`); return id; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

/** Read only. Every locator is a stored identity or the fixed legacy flat container, never an array offset. */
export function brandPriceTargets(templates: ProductPriceInput[], components: RecordValue[] = []): PriceTarget[] {
  const targets: PriceTarget[] = []; const keys = new Set<string>();
  for (const template of templates) {
    const add = (architecture: string, group: RecordValue, row: RecordValue, physicalField: string, priceField = "unit_price", column?: { id: string; dimension_code: string }) => {
      const rawCode = text(row.supplier_price_list_code ?? row.item_code);
      if (!rawCode.trim() || row.is_active === false || group.is_active === false) return;
      const currency = parseSupportedCurrency(row.currency ?? template.currency);
      if (!currency) throw Error(`Unsupported target currency for ${template.template_name}.`);
      const groupId = storedId(group.id, `${architecture} group`);
      const rowId = storedId(row.id, `${architecture} row`);
      const columnId = column?.id ?? "";
      const key = JSON.stringify([template.id, architecture, groupId, rowId, physicalField, columnId]);
      if (keys.has(key)) throw Error(`Duplicate persisted target identity: ${key}`);
      keys.add(key);
      const prices = record(row.prices);
      targets.push({ key, template_id: template.id, template_name: template.template_name, brand_id: template.brand_id, architecture, group_id: groupId, row_id: rowId, column_id: columnId, dimension: column?.dimension_code ?? "", price_field: priceField, physical_field: physicalField, code: normalizeManufacturerCode(rawCode), raw_code: rawCode, price: number(column ? prices[column.id] : row[physicalField]), currency, pricing_version: String(template.pricing_version), label: text(row.variant_name ?? row.item_name ?? row.label ?? row.component_name ?? template.template_name) });
    };
    const flattened = (field: string) => (Array.isArray(template[field]) ? template[field] as unknown[] : []).flatMap((root) => Array.isArray(record(root).items) ? record(root).items as unknown[] : [root]).map(record).filter((row) => row.is_active !== false);
    const categories = (Array.isArray(template.category_pricing) ? template.category_pricing : []) as CategoryPricingLike[];
    const structuredMain = hasMeaningfulBaseModelPricing(flattened("variant_pricing") as BaseModelPricingLike[]) || hasMeaningfulWorkstationPricing(flattened("desking_size_pricing") as WorkstationPricingLike[]) || hasMeaningfulCategoryPricing(categories) || hasMeaningfulModularPricing(categories as ModularPricingLike[]);
    if (!structuredMain) add("simple", { id: "default" }, { ...template, supplier_price_list_code: template.item_code }, "default_unit_price");
    for (const architecture of ["variant_pricing", "category_pricing", "desking_size_pricing", "accessory_pricing"] as const) {
      const roots = Array.isArray(template[architecture]) ? template[architecture] as unknown[] : [];
      for (const rawRoot of roots) {
        const root = record(rawRoot);
        if (root.pricing_type === "modular_meta") continue;
        const grouped = Array.isArray(root.items);
        const group = grouped ? root : { id: `legacy-flat:${architecture}`, is_active: true };
        const rows = grouped ? root.items as unknown[] : [root];
        const matrix = architecture === "category_pricing" && root.modular_pricing_mode !== "direct" && (grouped || root.prices !== undefined);
        if (matrix && (!Array.isArray(root.price_columns) || !root.price_columns.length) && rows.some((row) => Object.keys(record(record(row).prices)).length)) throw Error("Phase 1a stable matrix columns are missing. Display-label inference is not allowed.");
        const accessoryColumns = architecture === "accessory_pricing" && Array.isArray(root.price_categories) ? root.price_categories.map((raw) => { const c = record(raw); const id = storedId(c.id, "accessory column"); return { id, dimension_code: text(c.dimension_code) || id }; }) : [];
        const columns = matrix ? pricingColumns(root) : accessoryColumns;
        for (const rawRow of rows) {
          const row = record(rawRow);
          if (architecture === "desking_size_pricing") {
            add(architecture, group, { ...row, supplier_price_list_code: row.base_supplier_price_list_code ?? row.supplier_price_list_code }, "default_price");
            if (text(row.additional_supplier_price_list_code)) add(architecture, group, { ...row, supplier_price_list_code: row.additional_supplier_price_list_code }, "additional_price");
          } else if (columns.length) {
            for (const column of columns) if (Object.hasOwn(record(row.prices), column.id)) add(architecture, group, row, "prices", "unit_price", column);
          } else add(architecture, group, row, "price");
        }
      }
    }
    for (const component of components.filter((c) => c.template_id === template.id)) add("product_components", { id: "components" }, { ...component, supplier_price_list_code: component.component_code }, "unit_price");
  }
  return targets;
}
