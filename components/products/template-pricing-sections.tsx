"use client";

import { type ReactNode, useState } from "react";
import {
  DeskingSizePricingTable,
  type DeskingSizePricingRow,
} from "@/components/products/desking-size-pricing-table";
import {
  AccessoryPricingTable,
  CategoryPricingTable,
  type AccessoryPricingRow,
  type CategoryPricingRow,
  type VariantPricingRow,
  VariantPricingTable,
} from "@/components/products/variant-pricing-tables";

type TemplatePricingSectionsProps = {
  accessoryPricingRows?: AccessoryPricingRow[] | null;
  brandDefaultCurrency?: string | null;
  categoryPricingRows?: CategoryPricingRow[] | null;
  deskingSizePricingRows?: DeskingSizePricingRow[] | null;
  templateCurrency?: string | null;
  variantPricingRows?: VariantPricingRow[] | null;
};

function hasRows<T>(rows?: T[] | null) {
  return Array.isArray(rows) && rows.length > 0;
}

function PricingSetupButton({
  description,
  label,
  onClick,
}: {
  description: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50"
    >
      <p className="text-sm font-semibold text-emerald-900">{label}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
    </button>
  );
}

function PricingSectionCard({
  children,
  helperText,
  title,
}: {
  children: ReactNode;
  helperText?: string;
  title: string;
}) {
  return (
    <div className="md:col-span-2 xl:col-span-3">
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
        <h4 className="text-xs font-bold uppercase text-zinc-500">{title}</h4>
        {helperText ? (
          <p className="mt-2 text-xs leading-5 text-zinc-500">{helperText}</p>
        ) : null}
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

export function TemplatePricingSections({
  accessoryPricingRows,
  brandDefaultCurrency,
  categoryPricingRows,
  deskingSizePricingRows,
  templateCurrency,
  variantPricingRows,
}: TemplatePricingSectionsProps) {
  const hasWorkstationPricing = hasRows(deskingSizePricingRows);
  const hasBasePricing = hasRows(variantPricingRows);
  const hasAccessoriesPricing = hasRows(accessoryPricingRows);
  const hasFinishPricing = hasRows(categoryPricingRows);

  const [showWorkstationPricing, setShowWorkstationPricing] = useState(hasWorkstationPricing);
  const [showBasePricing, setShowBasePricing] = useState(hasBasePricing);
  const [showAccessoriesPricing, setShowAccessoriesPricing] = useState(hasAccessoriesPricing);
  const [showFinishPricing, setShowFinishPricing] = useState(hasFinishPricing);

  const hiddenSectionCount = [
    showWorkstationPricing,
    showBasePricing,
    showAccessoriesPricing,
    showFinishPricing,
  ].filter((isVisible) => !isVisible).length;

  return (
    <>
      <div className="md:col-span-2 xl:col-span-3">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <h4 className="text-sm font-semibold text-zinc-950">Pricing setup</h4>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Choose the pricing areas used by this template.
          </p>
          {hiddenSectionCount ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {!showWorkstationPricing ? (
                <PricingSetupButton
                  label="+ Use workstation size pricing"
                  description="Reveal workstation size rows with base and additional pricing."
                  onClick={() => setShowWorkstationPricing(true)}
                />
              ) : null}
              {!showBasePricing ? (
                <PricingSetupButton
                  label="+ Use base/model pricing"
                  description="Reveal size or model pricing for desks, chairs, sofas, and similar products."
                  onClick={() => setShowBasePricing(true)}
                />
              ) : null}
              {!showAccessoriesPricing ? (
                <PricingSetupButton
                  label="+ Use accessories pricing"
                  description="Reveal accessory groups and optional item pricing."
                  onClick={() => setShowAccessoriesPricing(true)}
                />
              ) : null}
              {!showFinishPricing ? (
                <PricingSetupButton
                  label="+ Use fabric/leather pricing"
                  description="Reveal finish-category pricing rows and any additional price category columns."
                  onClick={() => setShowFinishPricing(true)}
                />
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              All pricing areas currently used by this template are visible below.
            </p>
          )}
        </div>
      </div>

      {showWorkstationPricing ? (
        <PricingSectionCard
          title="Workstation Size / Base Price"
          helperText="Default price is the base CL2 price. Additional price is for each extra CL2."
        >
          <DeskingSizePricingTable rows={deskingSizePricingRows} templateCurrency={templateCurrency} brandDefaultCurrency={brandDefaultCurrency} />
        </PricingSectionCard>
      ) : null}

      {showBasePricing ? (
        <PricingSectionCard
          title="Base Size / Main Price"
          helperText="Use this for the product's main size or model pricing for desks, tables, chairs, sofas, and other non-workstation products."
        >
          <VariantPricingTable rows={variantPricingRows} templateCurrency={templateCurrency} brandDefaultCurrency={brandDefaultCurrency} />
        </PricingSectionCard>
      ) : null}

      {showAccessoriesPricing ? (
        <PricingSectionCard
          title="Accessories / Optional Items"
          helperText="Add optional accessories and add-ons such as locks, pedestals, power modules, headrests, cushions, and similar extras."
        >
          <AccessoryPricingTable rows={accessoryPricingRows} templateCurrency={templateCurrency} brandDefaultCurrency={brandDefaultCurrency} />
        </PricingSectionCard>
      ) : null}

      {showFinishPricing ? (
        <PricingSectionCard title="Fabric / Leather / Finish Category Pricing">
          <CategoryPricingTable rows={categoryPricingRows} templateCurrency={templateCurrency} brandDefaultCurrency={brandDefaultCurrency} />
        </PricingSectionCard>
      ) : null}
    </>
  );
}
