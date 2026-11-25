import type { ConfigurationPriceInput, ConfigurationPriceLink, ConfigurationPriceTemplate } from "../configuration-price";

// These are the four reported prices. All rows, IDs, parent prices and other amounts below are rebuilt.
// Each fixture supplies resolved builder inputs, so saved exports can be added via the same input shape.
export const screenPrices = { s1: 62, catB: 138, catC: 140, stirrup883: 35 };

const template = (id: string, extra: Partial<ConfigurationPriceTemplate> = {}): ConfigurationPriceTemplate => ({
  id, brand_id: "LAS", template_name: id, currency: "EUR", default_unit_price: 250.125, ...extra,
});

const screen = template("Universal Screen", {
  variant_pricing: [{ id: "mel-front", group_name: "Melamine Front", pricing_type: "base_model_group", is_active: true, sort_order: 0, items: [
    { id: "s1-l100", variant_name: "S1 L100", price: screenPrices.s1, currency: "EUR" },
    { id: "s1-zero", display_name: "S1 zero", price: 0 },
  ] }],
  category_pricing: [
    { id: "fabric-front", group_name: "Fabric Front", price_categories: ["cat-b", "cat-c"], items: [
      { id: "inactive", is_active: false, prices: { "cat-b": 999 } },
      { id: "s2-l140", variant_name: "S2 L140", prices: { "cat-b": screenPrices.catB, "cat-c": screenPrices.catC }, currency: "EUR" },
    ] },
    { id: "fabric-other", group_name: "Other Fabric", items: [{ id: "other-row", variant_name: "Other", prices: { "cat-d": 99 } }] },
  ],
  accessory_pricing: [
    { id: "stirrups", group_name: "Stirrups", group_is_required: true, items: [
      { id: "883", item_name: "Front Stirrup 883", supplier_price_list_code: "883", price: screenPrices.stirrup883, currency: "EUR" },
    ] },
    { id: "flat-addon", item_name: "Legacy add-on", price: 12.375, currency: "USD" },
    { id: "tiered", group_name: "Tiered", price_categories: [{ id: "cat-b", label: "Cat B" }], items: [
      { id: "tiered-addon", item_name: "Tiered add-on", price: 5, prices: { "cat-b": 111 } },
    ] },
  ],
});

const optionalAccessoryGroup: ConfigurationPriceInput["context"]["accessoryGroups"][number] = {
  id: "options", group_name: "Options", group_is_required: false, is_active: true, sort_order: 0, subgroups: [],
  price_categories: [{ id: "blue", label: "Blue" }, { id: "red", label: "Red" }],
  items: [
    { id: "cushion", item_name: "Cushion", prices: { blue: 0, red: 7.345 }, price: 45, currency: "USD" },
    { id: "arm", item_name: "Arm", price: 11.125, prices: { red: 72 }, unavailable_price_categories: ["red"] },
    { id: "negative", item_name: "Credit", price: -20, currency: "EUR" },
  ],
};

type ModularCase = {
  groups: Array<{ id: string; group_name: string; modular_pricing_mode?: string; items: NonNullable<ConfigurationPriceTemplate["category_pricing"]> }>;
  quantities: Record<string, number>;
};

type Fixture = {
  name: string;
  input: ConfigurationPriceInput;
  modular: ModularCase;
};

function fixture(name: string, input: Partial<ConfigurationPriceInput> = {}, modular: ModularCase = { groups: [], quantities: {} }): Fixture {
  return {
    name, modular,
    input: {
      template: template(name),
      configuration: { selectedFabricCategory: "", modularInUse: false, modularItems: [], selectedAccessoryCategories: {},
        accessoryConfiguration: { activeQuantities: {}, groups: [] }, usesWorkstationFlow: false },
      context: { accessoryGroups: [] },
      ...input,
    },
  };
}

export function configurationPriceFixtures() {
  const cases: Fixture[] = [];
  const defaults = fixture("defaults").input.configuration;
  for (const currency of ["AED", "EUR", "USD", "unknown"]) {
    for (const price of [undefined, 0, 12.345, -3.01]) {
      cases.push(fixture(`Base/Model ${currency} ${price}`, { template: template("base", { currency }),
        configuration: { ...defaults, selectedVariantRow: { id: "base", variant_name: "Base", price } } }));
    }
  }

  for (const [name, prices] of [
    ["direct", { direct: 47.125 }],
    ["category", { "cat-b": 58.015, "cat-c": 0 }],
  ] as const) {
    for (const category of [...Object.keys(prices), "unavailable", "unknown"]) {
      cases.push(fixture(`Matrix ${name} ${category}`, { configuration: {
        ...defaults, selectedFabricCategory: category,
        selectedCategoryRow: { id: name, display_name: name, prices, unavailable_categories: ["unavailable"] },
        needs: { hasUnavailableSelectedPrice: category === "unavailable" },
      } }));
    }
  }

  const modularGroups = [
    { id: "straight", group_name: "Straight", modular_pricing_mode: "direct", items: [
      { id: "starter", variant_name: "Starter", modular_role: "starter", price: 182.275, currency: "EUR" },
      { id: "extension", variant_name: "Extension", modular_role: "additional", price: 88.65, currency: "USD" },
    ] },
    { id: "fabric", group_name: "Fabric", items: [
      { id: "module", variant_name: "Module", prices: { "cat-b": 87.37, "cat-c": null }, unavailable_categories: ["cat-c"] },
    ] },
  ];
  for (const category of ["cat-b", "cat-c"]) {
    for (const starter of [0, 1, 2]) {
      for (const extension of [0, 1.8, 3]) {
        for (const moduleQuantity of [0, 2]) {
          const modularInUse = Math.trunc(starter + extension + moduleQuantity) > 0;
          cases.push(fixture(`Oxi_Q modular ${category} ${starter}/${extension}/${moduleQuantity}`, {
            template: template("Oxi_Q"),
            configuration: { ...defaults, modularInUse, selectedFabricCategory: category,
              selectedVariantRow: starter ? undefined : { id: "legacy", variant_name: "Legacy Base", price: 150 },
              needs: { missingRequiredModularSelection: modularInUse && starter === 2, hasUnavailableSelectedPrice: moduleQuantity > 0 && category === "cat-c" } },
          }, { groups: modularGroups, quantities: { starter, extension, module: moduleQuantity } }));
        }
      }
    }
  }

  for (const additionalClusterQty of [0, 1, 3]) {
    for (const default_price of [undefined, 0, 100.235]) {
      for (const accessoryQty of [0, 2.7]) {
        const workstation = { selectedSize: { id: "size", label: "140 x 80", default_price, currency: "EUR" },
          additionalClusterQty, accessoryQuantities: { clip: accessoryQty } };
        cases.push(fixture(`Workstation ${default_price} + ${additionalClusterQty}, accessories ${accessoryQty}`, {
          configuration: { ...defaults, usesWorkstationFlow: true, workstation, selectedWorkstationVariantRow: { id: "option", price: 27.89, currency: "USD" } },
          context: { accessoryGroups: [], components: [{ id: "clip", component_name: "Clip", option_type: "linked_addon", unit_price: 3.105 }] },
        }));
      }
    }
  }
  cases.push(fixture("Workstation missing size", { configuration: { ...defaults, usesWorkstationFlow: true, needs: { missingRequiredWorkstationSelection: true } } }));

  for (const currency of ["AED", "EUR"]) {
    for (const price of [0, 23.715]) {
      for (const quantity of [undefined, "2.7", "-1", "4"]) {
        cases.push(fixture(`Native system ${currency} ${price} x ${quantity}`, {
          configuration: { ...defaults, selectedVariantRow: { id: "main", price: 50 }, system: { row: { id: "system", price, currency, role: "system_base" }, quantity } },
        }));
      }
    }
  }
  cases.push(fixture("Native system missing", { configuration: { ...defaults, needs: { missingRequiredSystemSelection: true } } }));

  for (const chair of [false, true]) {
    for (const accessoryCategory of [undefined, "blue", "red", "retired"]) {
      for (const quantity of [0, 1, 2.9]) {
        const id = chair ? "Chair" : "Accessory-only";
        cases.push(fixture(`${id} ${accessoryCategory} x ${quantity}`, {
          template: template(id, { currency: "AED", default_unit_price: 0 }),
          configuration: { ...defaults, selectedVariantRow: chair ? { variant_name: "Chair", price: 130.04 } : undefined,
            selectedAccessoryCategories: { [`${id}:options:cushion`]: accessoryCategory },
            accessoryConfiguration: { activeQuantities: { cushion: quantity, arm: quantity, negative: quantity }, groups: [{ groupId: "options", role: "companion" }] },
            needs: { missingRequiredAccessorySelection: chair && !quantity } },
          context: { accessoryGroups: [optionalAccessoryGroup] },
        }));
      }
    }
  }

  for (const parent of ["Oxi_L", "Oxi_R"]) {
    for (const selection of [
      { variantRowId: "s1-l100" }, { variantRowId: "s1-zero" }, {},
      { categoryGroupId: "fabric-front", categoryId: "s2-l140", fabricCategory: "cat-b" },
      { categoryGroupId: "fabric-front", categoryId: "s2-l140", fabricCategory: "cat-c" },
      { categoryGroupId: "missing", categoryId: "inactive", fabricCategory: "missing" },
      { categoryGroupId: "fabric-other", categoryId: "s2-l140", fabricCategory: "cat-c" },
    ]) {
      for (const quantity of [undefined, 0, 2.6]) {
        for (const add_to_parent_price of [true, false]) {
          for (const otherBrand of [false, true]) {
            const link: ConfigurationPriceLink = { id: "screen", linked_template_id: screen.id, label: "Screen", add_to_parent_price, default_qty: 1 };
            cases.push(fixture(`${parent} screen ${JSON.stringify(selection)} x ${quantity}, add ${add_to_parent_price}, other brand ${otherBrand}`, {
              template: template(parent, { currency: "AED" }),
              context: { accessoryGroups: [], linkedMode: "legacy", linked: [{ link, childTemplate: { ...screen, brand_id: otherBrand ? "Other" : "LAS" },
                instances: [
                  { instance: { id: "a", label: " Front " }, selection, quantity, accessoryQuantities: { "883": 1, "tiered-addon": 2, "flat-addon": 1, stale: 3 } },
                  { instance: { id: "b", label: "" }, selection, quantity, accessoryQuantities: { "883": 2 } },
                ] }] },
            }));
          }
        }
      }
    }
  }

  return cases;
}
