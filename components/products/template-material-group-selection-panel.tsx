"use client";

import { useDeferredValue, useState } from "react";

type SelectionMode = "full_group" | "selected_categories" | "selected_items";

type MaterialGroupOption = {
  id: string;
  group_name: string;
};

type MaterialOption = {
  id: string;
  material_group_id: string;
  material_category: string | null;
  material_code: string | null;
  material_name: string;
};

function materialCategoryLabel(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || "Uncategorized";
}

function materialLabel(material: MaterialOption) {
  return [material.material_code, material.material_name].filter(Boolean).join(" - ") || material.material_name;
}

function sortCategoryLabels(left: string, right: string) {
  if (left === "Uncategorized") return 1;
  if (right === "Uncategorized") return -1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function TemplateMaterialGroupSelectionPanel({
  availableGroups,
  initialLinkedItemIds = [],
  initialMaterialGroupId = "",
  initialSelectionMode = "full_group",
  materials,
}: {
  availableGroups: MaterialGroupOption[];
  initialLinkedItemIds?: string[];
  initialMaterialGroupId?: string;
  initialSelectionMode?: SelectionMode;
  materials: MaterialOption[];
}) {
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(initialSelectionMode);
  const [selectedMaterialGroupId, setSelectedMaterialGroupId] = useState(initialMaterialGroupId);
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const linkedItemIds = new Set(initialLinkedItemIds);

  const groupMaterials = materials.filter((material) => material.material_group_id === selectedMaterialGroupId);
  const initialSelectedCategories = Array.from(
    new Set(
      groupMaterials
        .filter((material) => linkedItemIds.has(material.id))
        .map((material) => materialCategoryLabel(material.material_category)),
    ),
  ).sort(sortCategoryLabels);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(initialSelectedCategories);

  const normalizedSearchTerm = deferredSearchTerm.trim().toLowerCase();
  const groupedCategories = Array.from(
    groupMaterials.reduce((map, material) => {
      const category = materialCategoryLabel(material.material_category);
      map.set(category, (map.get(category) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).entries(),
  ).sort(([left], [right]) => sortCategoryLabels(left, right));

  const toggleCategory = (category: string) => {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((value) => value !== category)
        : [...current, category].sort(sortCategoryLabels),
    );
  };

  const selectedGroup = availableGroups.find((group) => group.id === selectedMaterialGroupId) ?? null;

  return (
    <div className="grid gap-3 md:col-span-2 xl:col-span-4">
      {initialMaterialGroupId ? (
        <input type="hidden" name="material_group_id" value={initialMaterialGroupId} />
      ) : (
        <label className="block xl:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-500">Material group</span>
          <select
            name="material_group_id"
            required
            value={selectedMaterialGroupId}
            onChange={(event) => {
              setSelectedMaterialGroupId(event.target.value);
              setSelectedCategories([]);
              setSearchTerm("");
            }}
            className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          >
            <option value="">Select group</option>
            {availableGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.group_name}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="grid gap-2 rounded-md border border-zinc-200 bg-white p-3 md:col-span-2 xl:col-span-4">
        <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">Selection mode</legend>
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <input
            type="radio"
            name="selection_mode"
            value="full_group"
            checked={selectionMode === "full_group"}
            onChange={() => setSelectionMode("full_group")}
            className="h-4 w-4 accent-emerald-900"
          />
          Full group
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <input
            type="radio"
            name="selection_mode"
            value="selected_categories"
            checked={selectionMode === "selected_categories"}
            onChange={() => setSelectionMode("selected_categories")}
            className="h-4 w-4 accent-emerald-900"
          />
          Select by category
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <input
            type="radio"
            name="selection_mode"
            value="selected_items"
            checked={selectionMode === "selected_items"}
            onChange={() => setSelectionMode("selected_items")}
            className="h-4 w-4 accent-emerald-900"
          />
          Select individual finishes
        </label>

        {!selectedMaterialGroupId ? (
          <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-500">
            Choose a material group to configure available finishes.
          </p>
        ) : null}

        {selectedMaterialGroupId && selectionMode === "full_group" ? (
          <div className="rounded-md border border-zinc-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
            <p className="font-semibold">{selectedGroup?.group_name ?? "Material group"}</p>
            <p className="mt-1 text-xs text-emerald-900/80">All finishes in this group will be available.</p>
          </div>
        ) : null}

        {selectedMaterialGroupId && selectionMode === "selected_categories" ? (
          <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-600">
              Select one or more finish categories. All finishes inside the chosen categories will be available.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {groupedCategories.map(([category, count]) => (
                <label key={category} className="flex items-start gap-2 rounded border border-zinc-200 bg-white p-2 text-xs text-zinc-700">
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(category)}
                    onChange={() => toggleCategory(category)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-900"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-zinc-900">{category}</span>
                    <span className="block text-[11px] text-zinc-500">{count} finishes</span>
                  </span>
                </label>
              ))}
            </div>
            {!groupedCategories.length ? (
              <p className="text-xs text-zinc-500">No active finishes found for this material group yet.</p>
            ) : null}
            {!selectedCategories.length && groupedCategories.length ? (
              <p className="text-xs text-amber-700">Select at least one category to save this mode.</p>
            ) : null}
            {selectedCategories.map((category) => (
              <input key={category} type="hidden" name="material_category[]" value={category} />
            ))}
          </div>
        ) : null}

        {selectedMaterialGroupId && selectionMode === "selected_items" ? (
          <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-zinc-500">Search finishes</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search code, finish name, or category"
                className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
            </label>
            <div className="grid max-h-72 gap-2 overflow-auto rounded-md border border-zinc-200 bg-white p-2 sm:grid-cols-2 xl:grid-cols-3">
              {groupMaterials.map((material) => {
                const label = materialLabel(material);
                const category = materialCategoryLabel(material.material_category);
                const matchesSearch =
                  !normalizedSearchTerm ||
                  label.toLowerCase().includes(normalizedSearchTerm) ||
                  category.toLowerCase().includes(normalizedSearchTerm);

                return (
                  <label
                    key={material.id}
                    className={`flex min-w-0 items-start gap-2 rounded border border-zinc-200 bg-white p-2 text-xs text-zinc-700 ${matchesSearch ? "" : "hidden"}`}
                  >
                    <input
                      type="checkbox"
                      name="brand_material_id[]"
                      value={material.id}
                      defaultChecked={linkedItemIds.has(material.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-900"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-zinc-900">{label}</span>
                      <span className="block truncate text-[11px] text-zinc-500">{category}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {!groupMaterials.length ? (
              <p className="text-xs text-zinc-500">No active finishes found for this material group yet.</p>
            ) : null}
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
