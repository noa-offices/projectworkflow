"use client";

import { type ReactNode, useCallback, useState } from "react";
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
import { countStandardCategoryPricingRows, groupedStandardCategoryPricingRows } from "@/lib/products/category-pricing-groups";
import {
  baseModelPricingGroups,
  flattenBaseModelPricingRows,
  type BaseModelPricingGroup,
  type BaseModelPricingSubgroup,
} from "@/lib/products/base-model-pricing-groups";
import { modularItemPricingGroups, modularItemPricingRows } from "@/lib/products/modular-pricing";
import { flattenWorkstationPricingRows, workstationPricingGroups, type WorkstationPricingGroup } from "@/lib/products/workstation-pricing-groups";
import {
  TemplateImportActionButton,
  type QuotationRowImportDraft,
} from "@/components/products/template-import-controls";
import type { SmartSetupPricingSection } from "@/lib/products/smart-product-apply-state";

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
  onSectionDataChange?: (section: SmartSetupPricingSection, hasData: boolean) => void;
  workstationReplacement?: { pricing?: unknown; rows: DeskingSizePricingRow[]; subgroups?: BaseModelPricingSubgroup[]; version: number } | null;
  baseModelReplacement?: { groups: BaseModelPricingGroup<VariantPricingRow>[]; rows: VariantPricingRow[]; flatSubgroups?: BaseModelPricingSubgroup[]; version: number } | null;
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
  void compactAccordionMode;
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
  const [openWorkstationPricing, setOpenWorkstationPricing] = useState(false);
  const [openBasePricing, setOpenBasePricing] = useState(false);
  const [openAccessoriesPricing, setOpenAccessoriesPricing] = useState(false);
  const [openFinishPricing, setOpenFinishPricing] = useState(false);
  const [openModularPricing, setOpenModularPricing] = useState(false);
  const [currentBaseModelGroups, setCurrentBaseModelGroups] = useState<BaseModelPricingGroup<VariantPricingRow>[]>(() =>
    baseModelPricingGroups<VariantPricingRow>(Array.isArray(variantPricingRows) ? variantPricingRows : []),
  );
  const [currentCategoryPricingGroups, setCurrentCategoryPricingGroups] = useState<CategoryPricingRow[]>(() =>
    groupedStandardCategoryPricingRows<CategoryPricingRow>(categoryPricingRows),
  );
  const [currentModularPricingGroups, setCurrentModularPricingGroups] = useState<CategoryPricingRow[]>(() =>
    modularItemPricingGroups<CategoryPricingRow>(categoryPricingRows),
  );
  const [currentWorkstationPricingGroups, setCurrentWorkstationPricingGroups] = useState<WorkstationPricingGroup<DeskingSizePricingRow>[]>(() =>
    workstationPricingGroups<DeskingSizePricingRow>(deskingSizePricingRows ?? []),
  );
  const handleBaseModelGroupsChange = useCallback((groups: BaseModelPricingGroup<VariantPricingRow>[]) => {
    setCurrentBaseModelGroups(groups);
  }, []);
  const handleCategoryPricingGroupsChange = useCallback((groups: CategoryPricingRow[]) => {
    setCurrentCategoryPricingGroups(groups);
  }, []);
  const reportWorkstationData = useCallback((hasData: boolean) => onSectionDataChange?.("workstation", hasData), [onSectionDataChange]);
  const reportBaseModelData = useCallback((hasData: boolean) => onSectionDataChange?.("baseModel", hasData), [onSectionDataChange]);
  const reportAccessoryData = useCallback((hasData: boolean) => onSectionDataChange?.("accessory", hasData), [onSectionDataChange]);
  const reportCategoryData = useCallback((hasData: boolean) => onSectionDataChange?.("category", hasData), [onSectionDataChange]);
  const reportModularData = useCallback((hasData: boolean) => onSectionDataChange?.("modular", hasData), [onSectionDataChange]);

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
  const replacementBaseModelCount = (baseModelReplacement?.groups ?? []).reduce((count, group) => count + (group.items?.length ?? 0), baseModelReplacement?.rows.length ?? 0);
  const replacementAccessoryItemCount = (accessoryReplacement?.groups ?? []).reduce((count, group) => count + (group.items?.length ?? 0), 0);
  const replacementCategoryCount = categoryReplacement?.groups.reduce((count, group) => count + (group.items?.length ?? 0), 0) ?? 0;
  const replacementModularCount = modularReplacement?.groups.reduce((count, group) => count + (group.items?.length ?? 0), 0) ?? 0;
  const activeBaseModelCount = baseModelReplacement?.version !== undefined ? replacementBaseModelCount : baseModelPricingRowCount;
  const activeAccessoryItemCount = accessoryReplacement?.version !== undefined ? replacementAccessoryItemCount : accessoryItemCount;
  const activeCategoryCount = categoryReplacement?.version !== undefined ? replacementCategoryCount : countStandardCategoryPricingRows(categoryPricingRows);
  const activeModularCount = modularReplacement?.version !== undefined ? replacementModularCount : modularItemPricingRows(categoryPricingRows).length;

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
        replacementPricing={workstationReplacement?.pricing}
        replacementRows={workstationReplacement?.rows}
        replacementSubgroups={workstationReplacement?.subgroups}
        replacementVersion={workstationReplacement?.version}
        onHasDataChange={reportWorkstationData}
        onGroupsChange={setCurrentWorkstationPricingGroups}
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
        replacementGroups={baseModelReplacement?.groups}
        replacementFlatSubgroups={baseModelReplacement?.flatSubgroups}
        onGroupsChange={handleBaseModelGroupsChange}
        onHasDataChange={reportBaseModelData}
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
        baseModelGroups={currentBaseModelGroups}
        categoryPricingGroups={currentCategoryPricingGroups}
        modularPricingGroups={currentModularPricingGroups}
        workstationPricingGroups={currentWorkstationPricingGroups}
        brandDefaultCurrency={brandDefaultCurrency}
        rows={accessoryPricingRows}
        templateCurrency={templateCurrency}
        replacementGroups={accessoryReplacement?.groups}
        replacementVersion={accessoryReplacement?.version}
        onHasDataChange={reportAccessoryData}
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
        onGroupsChange={handleCategoryPricingGroupsChange}
        rows={categoryPricingRows}
        templateCurrency={templateCurrency}
        replacementGroups={categoryReplacement?.groups}
        replacementVersion={categoryReplacement?.version}
        onHasDataChange={reportCategoryData}
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
      onHasDataChange={reportModularData}
      onGroupsChange={setCurrentModularPricingGroups}
      templateId={templateId}
      templateIsPersisted={templateIsPersisted}
    />
  );

  return (
    <>
      <div className="md:col-span-2 xl:col-span-3">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <h4 className="text-sm font-semibold text-zinc-950">Pricing &amp; Configuration</h4>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Manage only the detailed pricing and configuration this template uses.
          </p>
          {hiddenSectionCount ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {!shouldShowWorkstationPricing ? (
                <PricingSetupButton
                  label="Workstation Pricing · Not used · Add"
                  description="Size, layout, base and additional pricing."
                  onClick={() => setShowWorkstationPricing(true)}
                />
              ) : null}
              {!shouldShowBasePricing ? (
                <PricingSetupButton
                  label="Base / Model Pricing · Not used · Add"
                  description="Models, variants, dimensions and direct pricing."
                  onClick={() => setShowBasePricing(true)}
                />
              ) : null}
              {!shouldShowAccessoriesPricing ? (
                <PricingSetupButton
                  label="Accessories / Configuration · Not used · Add"
                  description="Accessories, options, companions and configuration."
                  onClick={() => setShowAccessoriesPricing(true)}
                />
              ) : null}
              {!shouldShowFinishPricing ? (
                <PricingSetupButton
                  label="Category / Matrix Pricing · Not used · Add"
                  description="Source-defined finish, fabric or price-category matrices."
                  onClick={() => setShowFinishPricing(true)}
                />
              ) : null}
              {!shouldShowModularPricing ? (
                <PricingSetupButton
                  label="Modular Pricing · Not used · Add"
                  description="Modular families, modules and shared price categories."
                  onClick={() => setShowModularPricing(true)}
                />
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              All five pricing areas are in use. Choose Manage to edit one.
            </p>
          )}
        </div>
      </div>

      {shouldShowWorkstationPricing ? (
        true ? (
          <PricingAccordionSection
            isOpen={openWorkstationPricing}
            onToggle={() => setOpenWorkstationPricing((current) => !current)}
            summary={workstationPricingRowCount ? `${workstationPricingRowCount} rows` : "Not used"}
            title="Workstation Pricing"
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
        true ? (
          <PricingAccordionSection
            isOpen={openBasePricing}
            onToggle={() => setOpenBasePricing((current) => !current)}
            summary={activeBaseModelCount ? `${baseModelReplacement?.groups.length ?? currentBaseModelGroups.length} groups · ${activeBaseModelCount} models` : "Not used"}
            title="Base / Model Pricing"
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
        true ? (
          <PricingAccordionSection
            isOpen={openAccessoriesPricing}
            onToggle={() => setOpenAccessoriesPricing((current) => !current)}
            summary={activeAccessoryItemCount ? `${accessoryReplacement?.groups.length ?? (accessoryPricingRows?.length ?? 0)} groups · ${activeAccessoryItemCount} items` : "Not used"}
            title="Accessories / Configuration"
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
        true ? (
          <PricingAccordionSection
            isOpen={openFinishPricing}
            onToggle={() => setOpenFinishPricing((current) => !current)}
            summary={activeCategoryCount ? `${activeCategoryCount} matrix rows` : "Not used"}
            title="Category / Matrix Pricing"
          >
            {renderFinishPricing}
          </PricingAccordionSection>
        ) : (
          <PricingSectionCard title="Category / Matrix Pricing">
            {renderFinishPricing}
          </PricingSectionCard>
        )
      ) : null}

      {shouldShowModularPricing ? (
        true ? (
          <PricingAccordionSection
            isOpen={openModularPricing}
            onToggle={() => setOpenModularPricing((current) => !current)}
            summary={activeModularCount ? `${activeModularCount} module rows` : "Not used"}
            title="Modular Pricing"
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
