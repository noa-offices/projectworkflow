"use client";

import { type ReactNode, useState } from "react";
import {
  DeskingSizePricingTable,
  type DeskingSizePricingRow,
} from "@/components/products/desking-size-pricing-table";
import {
  AccessoryPricingTable,
  CategoryPricingTable,
  ModularItemPricingTable,
  type AccessoryPricingRow,
  type CategoryPricingRow,
  type VariantPricingRow,
  VariantPricingTable,
} from "@/components/products/variant-pricing-tables";
import { countStandardCategoryPricingRows } from "@/lib/products/category-pricing-groups";
import { flattenBaseModelPricingRows } from "@/lib/products/base-model-pricing-groups";
import { modularItemPricingRows } from "@/lib/products/modular-pricing";
import { flattenWorkstationPricingRows } from "@/lib/products/workstation-pricing-groups";
import {
  TemplateImportActionButton,
  type QuotationRowImportDraft,
} from "@/components/products/template-import-controls";

type TemplatePricingSectionsProps = {
  accessoryPricingRows?: AccessoryPricingRow[] | null;
  brandDefaultCurrency?: string | null;
  categoryPricingRows?: CategoryPricingRow[] | null;
  compactAccordionMode?: boolean;
  deskingSizePricingRows?: unknown;
  importDraft?: QuotationRowImportDraft | null;
  templateId: string;
  templateIsPersisted: boolean;
  templateCurrency?: string | null;
  variantPricingRows?: unknown;
  onSectionDataChange?: (section: string, hasData: boolean) => void;
  workstationReplacement?: { rows: DeskingSizePricingRow[]; version: number } | null;
  baseModelReplacement?: { rows: VariantPricingRow[]; version: number } | null;
  categoryReplacement?: { groups: CategoryPricingRow[]; version: number } | null;
  modularReplacement?: { groups: CategoryPricingRow[]; version: number } | null;
  accessoryReplacement?: { groups: AccessoryPricingRow[]; version: number } | null;
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

function PricingAccordionSection({
  children,
  isOpen,
  onToggle,
  summary,
  title,
}: {
  children: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  summary?: string;
  title: string;
}) {
  return (
    <div className="md:col-span-2 xl:col-span-3">
      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-zinc-50"
        >
          <div>
            <h4 className="text-xs font-bold uppercase text-zinc-500">{title}</h4>
            {summary ? <p className="mt-1 text-xs leading-5 text-zinc-500">{summary}</p> : null}
          </div>
          <span className="text-xs font-semibold text-zinc-500">
            {isOpen ? "Hide" : "Show"}
          </span>
        </button>
        <div hidden={!isOpen} className="border-t border-zinc-100 p-4">
          {children}
        </div>
      </section>
    </div>
  );
}

export function TemplatePricingSections({
  accessoryPricingRows,
  brandDefaultCurrency,
  categoryPricingRows,
  compactAccordionMode = false,
  deskingSizePricingRows,
  importDraft,
  templateId,
  templateIsPersisted,
  templateCurrency,
  variantPricingRows,
  onSectionDataChange,
  workstationReplacement,
  baseModelReplacement,
  categoryReplacement,
  modularReplacement,
  accessoryReplacement,
}: TemplatePricingSectionsProps) {
  const workstationPricingRowCount = flattenWorkstationPricingRows(deskingSizePricingRows ?? []).length;
  const hasWorkstationPricing = workstationPricingRowCount > 0;
  const baseModelPricingRowCount = flattenBaseModelPricingRows(variantPricingRows ?? []).length;
  const hasBasePricing = baseModelPricingRowCount > 0;
  const hasAccessoriesPricing = hasRows(accessoryPricingRows);
  const hasFinishPricing = countStandardCategoryPricingRows(categoryPricingRows) > 0;
  const hasModularPricing = hasRows(modularItemPricingRows(categoryPricingRows));

  const [showWorkstationPricing, setShowWorkstationPricing] = useState(hasWorkstationPricing || Boolean(importDraft));
  const [showBasePricing, setShowBasePricing] = useState(hasBasePricing || Boolean(importDraft));
  const [showAccessoriesPricing, setShowAccessoriesPricing] = useState(hasAccessoriesPricing || Boolean(importDraft));
  const [showFinishPricing, setShowFinishPricing] = useState(hasFinishPricing || Boolean(importDraft));
  const [showModularPricing, setShowModularPricing] = useState(hasModularPricing);
  const [openWorkstationPricing, setOpenWorkstationPricing] = useState(!compactAccordionMode && (hasWorkstationPricing || Boolean(importDraft)));
  const [openBasePricing, setOpenBasePricing] = useState(!compactAccordionMode && (hasBasePricing || Boolean(importDraft)));
  const [openAccessoriesPricing, setOpenAccessoriesPricing] = useState(!compactAccordionMode && (hasAccessoriesPricing || Boolean(importDraft)));
  const [openFinishPricing, setOpenFinishPricing] = useState(!compactAccordionMode && (hasFinishPricing || Boolean(importDraft)));
  const [openModularPricing, setOpenModularPricing] = useState(!compactAccordionMode && hasModularPricing);

  const shouldShowWorkstationPricing = showWorkstationPricing || workstationReplacement?.version !== undefined;
  const shouldShowBasePricing = showBasePricing || baseModelReplacement?.version !== undefined;
  const shouldShowAccessoriesPricing = showAccessoriesPricing || accessoryReplacement?.version !== undefined;
  const shouldShowFinishPricing = showFinishPricing || categoryReplacement?.version !== undefined;
  const shouldShowModularPricing = showModularPricing || modularReplacement?.version !== undefined;

  const hiddenSectionCount = [
    shouldShowWorkstationPricing,
    shouldShowBasePricing,
    shouldShowAccessoriesPricing,
    shouldShowFinishPricing,
    shouldShowModularPricing,
  ].filter((isVisible) => !isVisible).length;

  const accessoryItemCount = (accessoryPricingRows ?? []).reduce((count, row) => {
    if (Array.isArray(row.items) && row.items.length) {
      return count + row.items.length;
    }

    return row.item_name || row.specification || row.price ? count + 1 : count;
  }, 0);

  const renderWorkstationPricing = (
    <>
      {importDraft ? (
        <div className="mb-3">
          <TemplateImportActionButton
            action="workstation"
            draft={importDraft}
            label="Add as workstation size row"
            templateId={templateId}
          />
        </div>
      ) : null}
      <DeskingSizePricingTable
        brandDefaultCurrency={brandDefaultCurrency}
        rows={deskingSizePricingRows}
        templateCurrency={templateCurrency}
        templateId={templateId}
        templateIsPersisted={templateIsPersisted}
        replacementRows={workstationReplacement?.rows}
        replacementVersion={workstationReplacement?.version}
        onHasDataChange={(hasData) => onSectionDataChange?.("workstation", hasData)}
      />
    </>
  );

  const renderBasePricing = (
    <>
      {importDraft ? (
        <div className="mb-3">
          <TemplateImportActionButton
            action="variant"
            draft={importDraft}
            label="Add as base/model row"
            templateId={templateId}
          />
        </div>
      ) : null}
      <VariantPricingTable
        brandDefaultCurrency={brandDefaultCurrency}
        rows={variantPricingRows}
        templateCurrency={templateCurrency}
        templateId={templateId}
        templateIsPersisted={templateIsPersisted}
        replacementVersion={baseModelReplacement?.version}
        replacementRows={baseModelReplacement?.rows}
        onHasDataChange={(hasData) => onSectionDataChange?.("baseModel", hasData)}
      />
    </>
  );

  const renderAccessoriesPricing = (
    <>
      {importDraft ? (
        <div className="mb-3">
          <TemplateImportActionButton
            action="accessory"
            draft={importDraft}
            label="Add as accessory row"
            templateId={templateId}
          />
        </div>
      ) : null}
      <AccessoryPricingTable
        brandDefaultCurrency={brandDefaultCurrency}
        rows={accessoryPricingRows}
        templateCurrency={templateCurrency}
        replacementGroups={accessoryReplacement?.groups}
        replacementVersion={accessoryReplacement?.version}
        onHasDataChange={(hasData) => onSectionDataChange?.("accessory", hasData)}
        templateId={templateId}
        templateIsPersisted={templateIsPersisted}
      />
    </>
  );

  const renderFinishPricing = (
    <>
      {importDraft ? (
        <div className="mb-3">
          <TemplateImportActionButton
            action="finish"
            draft={importDraft}
            label="Add as finish pricing row"
            templateId={templateId}
          />
        </div>
      ) : null}
      <CategoryPricingTable
        brandDefaultCurrency={brandDefaultCurrency}
        rows={categoryPricingRows}
        templateCurrency={templateCurrency}
        replacementGroups={categoryReplacement?.groups}
        replacementVersion={categoryReplacement?.version}
        onHasDataChange={(hasData) => onSectionDataChange?.("category", hasData)}
        templateId={templateId}
        templateIsPersisted={templateIsPersisted}
      />
    </>
  );

  const renderModularPricing = (
    <ModularItemPricingTable
      brandDefaultCurrency={brandDefaultCurrency}
      rows={categoryPricingRows}
      templateCurrency={templateCurrency}
      replacementGroups={modularReplacement?.groups}
      replacementVersion={modularReplacement?.version}
      onHasDataChange={(hasData) => onSectionDataChange?.("modular", hasData)}
      templateId={templateId}
      templateIsPersisted={templateIsPersisted}
    />
  );

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
              {!shouldShowWorkstationPricing ? (
                <PricingSetupButton
                  label="+ Use workstation size pricing"
                  description="Reveal workstation size rows with base and additional pricing."
                  onClick={() => setShowWorkstationPricing(true)}
                />
              ) : null}
              {!shouldShowBasePricing ? (
                <PricingSetupButton
                  label="+ Use base/model pricing"
                  description="Reveal size or model pricing for desks, chairs, sofas, and similar products."
                  onClick={() => setShowBasePricing(true)}
                />
              ) : null}
              {!shouldShowAccessoriesPricing ? (
                <PricingSetupButton
                  label="+ Use accessories pricing"
                  description="Reveal accessory groups and optional item pricing."
                  onClick={() => setShowAccessoriesPricing(true)}
                />
              ) : null}
              {!shouldShowFinishPricing ? (
                <PricingSetupButton
                  label="+ Use fabric/leather pricing"
                  description="Reveal finish-category pricing rows and any additional price category columns."
                  onClick={() => setShowFinishPricing(true)}
                />
              ) : null}
              {!shouldShowModularPricing ? (
                <PricingSetupButton
                  label="+ Use modular item pricing"
                  description="Reveal modular components with fabric/category pricing for configurable sofas, lounge sets, and sectional items."
                  onClick={() => setShowModularPricing(true)}
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

      {shouldShowWorkstationPricing ? (
        compactAccordionMode ? (
          <PricingAccordionSection
            isOpen={openWorkstationPricing}
            onToggle={() => setOpenWorkstationPricing((current) => !current)}
            summary={`${workstationPricingRowCount} size rows`}
            title="Workstation Size / Base Price"
          >
            {renderWorkstationPricing}
          </PricingAccordionSection>
        ) : (
          <PricingSectionCard
            title="Workstation Size / Base Price"
            helperText="Default price is the base CL2 price. Additional price is for each extra CL2."
          >
            {renderWorkstationPricing}
          </PricingSectionCard>
        )
      ) : null}

      {shouldShowBasePricing ? (
        compactAccordionMode ? (
          <PricingAccordionSection
            isOpen={openBasePricing}
            onToggle={() => setOpenBasePricing((current) => !current)}
            summary={`${baseModelPricingRowCount} base/model rows`}
            title="Base Size / Main Price"
          >
            {renderBasePricing}
          </PricingAccordionSection>
        ) : (
          <PricingSectionCard
            title="Base Size / Main Price"
            helperText="Use this for the product's main size or model pricing for desks, tables, chairs, sofas, and other non-workstation products."
          >
            {renderBasePricing}
          </PricingSectionCard>
        )
      ) : null}

      {shouldShowAccessoriesPricing ? (
        compactAccordionMode ? (
          <PricingAccordionSection
            isOpen={openAccessoriesPricing}
            onToggle={() => setOpenAccessoriesPricing((current) => !current)}
            summary={`${accessoryItemCount} accessory items`}
            title="Accessories / Optional Items"
          >
            {renderAccessoriesPricing}
          </PricingAccordionSection>
        ) : (
          <PricingSectionCard
            title="Accessories / Optional Items"
            helperText="Add optional accessories and add-ons such as locks, pedestals, power modules, headrests, cushions, and similar extras."
          >
            {renderAccessoriesPricing}
          </PricingSectionCard>
        )
      ) : null}

      {shouldShowFinishPricing ? (
        compactAccordionMode ? (
          <PricingAccordionSection
            isOpen={openFinishPricing}
            onToggle={() => setOpenFinishPricing((current) => !current)}
            summary={`${countStandardCategoryPricingRows(categoryPricingRows)} finish pricing rows`}
            title="Fabric / Leather / Finish Category Pricing"
          >
            {renderFinishPricing}
          </PricingAccordionSection>
        ) : (
          <PricingSectionCard title="Fabric / Leather / Finish Category Pricing">
            {renderFinishPricing}
          </PricingSectionCard>
        )
      ) : null}

      {shouldShowModularPricing ? (
        compactAccordionMode ? (
          <PricingAccordionSection
            isOpen={openModularPricing}
            onToggle={() => setOpenModularPricing((current) => !current)}
            summary={`${modularItemPricingRows(categoryPricingRows).length} modular item rows`}
            title="Modular Items Pricing"
          >
            {renderModularPricing}
          </PricingAccordionSection>
        ) : (
          <PricingSectionCard
            title="Modular Items Pricing"
            helperText="Configure modular sofa or sectional units with default modular specification, default dimension, and fabric/category pricing per module."
          >
            {renderModularPricing}
          </PricingSectionCard>
        )
      ) : null}
    </>
  );
}
