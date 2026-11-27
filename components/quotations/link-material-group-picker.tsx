"use client";

import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { TemplateMaterialGroupSelectionPanel } from "@/components/products/template-material-group-selection-panel";
import type { TemplateMaterialGroupLinkResult } from "@/lib/products/template-material-group-link";
import type { FinishMaterial, FinishMaterialGroup, ProductTemplateMaterialGroupItemLink, ProductTemplateMaterialGroupLink } from "./finish-selections-editor";

export type SavedMaterialGroupLink = Extract<TemplateMaterialGroupLinkResult, { ok: true }>;

/** Given only to users who may write the link tables; without it the editor shows no link button. */
export type LinkMaterialGroupControls = {
  productTemplateId: string;
  brandId: string;
  save: (formData: FormData) => Promise<TemplateMaterialGroupLinkResult>;
  onLinked: (saved: SavedMaterialGroupLink) => void;
};

// Adds links saved in this session to the ones the page loaded; a link the page already has is not repeated.
export function mergeMaterialGroupLinks(
  links: ProductTemplateMaterialGroupLink[],
  items: ProductTemplateMaterialGroupItemLink[],
  added: SavedMaterialGroupLink[],
) {
  const loaded = new Set(links.map((link) => link.id));
  const fresh = added.filter((saved) => !loaded.has(saved.link.id));
  return fresh.length
    ? { links: [...links, ...fresh.map((saved) => saved.link)], items: [...items, ...fresh.flatMap((saved) => saved.items)] }
    : { links, items };
}

/** Returns "" on success. On any failure nothing is added locally and the message is returned. */
export async function submitMaterialGroupLink(
  save: LinkMaterialGroupControls["save"],
  formData: FormData,
  onLinked: LinkMaterialGroupControls["onLinked"],
) {
  try {
    const result = await save(formData);
    if (!result.ok) return result.message;
    onLinked(result);
    return "";
  } catch {
    return "Material group could not be linked. Check your connection, then reload to confirm before trying again.";
  }
}

export function LinkMaterialGroupList({ brandId, groups, linkedGroupIds, materials, onChoose, search }: {
  brandId: string;
  groups: FinishMaterialGroup[];
  linkedGroupIds: ReadonlySet<string>;
  materials: FinishMaterial[];
  onChoose: (group: FinishMaterialGroup) => void;
  search: string;
}) {
  const text = search.trim().toLowerCase();
  // The page loads active groups and active materials only.
  const visible = groups
    .filter((group) => group.brand_id === brandId && group.group_name.toLowerCase().includes(text))
    .sort((left, right) => left.sort_order - right.sort_order || left.group_name.localeCompare(right.group_name));

  if (!visible.length) return <p className="border border-dashed border-zinc-300 px-3 py-4 text-center text-xs text-zinc-500">No material groups found for this brand.</p>;

  return (
    <div className="grid gap-1">
      {visible.map((group) => {
        const count = materials.filter((material) => material.material_group_id === group.id && material.is_active !== false).length;
        const linked = linkedGroupIds.has(group.id);
        return (
          <button key={group.id} type="button" disabled={linked} onClick={() => onChoose(group)} className="flex items-center justify-between gap-3 border border-zinc-200 bg-white px-3 py-2 text-left hover:border-emerald-900 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:hover:border-zinc-200">
            <span className="min-w-0 truncate text-xs font-bold text-zinc-900">{group.group_name}</span>
            <span className="flex shrink-0 items-center gap-2 text-[11px] font-semibold text-zinc-500">
              <span>{count} {count === 1 ? "material" : "materials"}</span>
              {linked ? <span className="border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-800">Linked</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Option({ defaultChecked = false, label, name }: { defaultChecked?: boolean; label: string; name: string }) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 accent-emerald-900" />
      {label}
    </label>
  );
}

export function LinkMaterialGroupDialog({ controls, groups, linkedGroupIds, materials, onClose }: {
  controls: LinkMaterialGroupControls;
  groups: FinishMaterialGroup[];
  linkedGroupIds: ReadonlySet<string>;
  materials: FinishMaterial[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<FinishMaterialGroup | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The editor sits inside the add-to-quotation form. The portal keeps these fields out of that form's data,
  // and stopPropagation keeps this submit from reaching it through React.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirming) {
      setError("");
      setConfirming(true);
      return;
    }
    if (saving) return;
    const formData = new FormData(event.currentTarget);
    formData.set("product_template_id", controls.productTemplateId);
    setSaving(true);
    const message = await submitMaterialGroupLink(controls.save, formData, controls.onLinked);
    setSaving(false);
    setConfirming(false);
    if (message) setError(message);
    else onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onChange={(event) => event.stopPropagation()}>
      <div role="dialog" aria-modal="true" aria-label="Link material group" className="grid max-h-[90vh] w-full max-w-2xl gap-3 overflow-y-auto border border-zinc-300 bg-white p-4 text-left shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-zinc-900">Link material group</h3>
          <button type="button" disabled={saving} onClick={onClose} className="text-xs font-semibold text-zinc-500 hover:text-zinc-900">Close</button>
        </div>
        {!group ? (
          <>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search material groups" className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800" />
            <LinkMaterialGroupList brandId={controls.brandId} groups={groups} linkedGroupIds={linkedGroupIds} materials={materials} search={search} onChoose={setGroup} />
          </>
        ) : (
          // Any edit after the confirmation asks for it again.
          <form onSubmit={submit} onChange={() => setConfirming(false)} className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-zinc-900">{group.group_name}</p>
              <button type="button" disabled={saving} onClick={() => { setGroup(null); setConfirming(false); setError(""); }} className="text-xs font-semibold text-emerald-900">Choose another group</button>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-zinc-500">Label override (optional)</span>
              <input name="label_override" className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800" />
            </label>
            <TemplateMaterialGroupSelectionPanel key={group.id} availableGroups={[group]} initialMaterialGroupId={group.id} materials={materials.filter((material) => material.material_group_id === group.id)} />
            {/* Same options and defaults as the product setup form; multiple selection is always on there. */}
            <div className="flex flex-wrap gap-4">
              <Option name="is_required" label="Required" />
              <Option name="show_in_specification" label="Show in Specification" defaultChecked />
              <Option name="show_in_quotation" label="Show in Quotation" />
            </div>
            {error ? <p role="alert" className="border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-medium text-red-800">{error}</p> : null}
            {confirming ? <p className="border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-900">This links the group to the product for all future quotations.</p> : null}
            <button type="submit" disabled={saving} className="justify-self-start border border-emerald-900 bg-emerald-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              {saving ? "Linking..." : confirming ? "Confirm link" : "Link group"}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
