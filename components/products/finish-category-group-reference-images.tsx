"use client";

/* Signed Supabase preview URLs cannot use the configured Next image loader. */
/* eslint-disable @next/next/no-img-element */

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  listProductTemplateGroupReferences,
  removeProductTemplateGroupReference,
  replaceProductTemplateGroupReference,
  uploadProductTemplateGroupReference,
  type ProductTemplateGroupReference,
} from "@/app/products/templates/group-reference-actions";
import { pricingGroupReferenceScope } from "@/lib/products/finish-category-reference-ui";
import {
  type ProductTemplateGroupReferenceType,
  validateProductTemplateGroupReferenceFile,
} from "@/lib/products/product-template-group-references";

function actionMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message && !/digest|unexpected server error/i.test(error.message)) {
    return error.message;
  }
  return fallback;
}

export function PricingGroupReferenceImages({
  groupId,
  groupLabel,
  onClose,
  pricingType,
  templateId,
}: {
  groupId: string;
  groupLabel: string;
  onClose: () => void;
  pricingType: ProductTemplateGroupReferenceType;
  templateId: string;
}) {
  const scope = pricingGroupReferenceScope(templateId, pricingType, groupId);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [references, setReferences] = useState<ProductTemplateGroupReference[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [replaceReferenceId, setReplaceReferenceId] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [fullPreview, setFullPreview] = useState<ProductTemplateGroupReference | null>(null);

  const loadReferences = useCallback(async () => {
    try {
      const nextReferences = await listProductTemplateGroupReferences(
        pricingGroupReferenceScope(templateId, pricingType, groupId),
      );
      setReferences(nextReferences);
      setCaptionDrafts(Object.fromEntries(nextReferences.map((reference) => [reference.id, reference.caption ?? ""])));
    } catch (error) {
      setMessage(actionMessage(error, "Reference images could not be loaded."));
    }
  }, [groupId, pricingType, templateId]);

  useEffect(() => {
    let cancelled = false;
    void listProductTemplateGroupReferences(pricingGroupReferenceScope(templateId, pricingType, groupId))
      .then((nextReferences) => {
        if (cancelled) return;
        setReferences(nextReferences);
        setCaptionDrafts(Object.fromEntries(nextReferences.map((reference) => [reference.id, reference.caption ?? ""])));
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(actionMessage(error, "Reference images could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, pricingType, templateId]);

  function selectUploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    try {
      validateProductTemplateGroupReferenceFile(file);
      setSelectedFile(file);
      setMessage(null);
    } catch (error) {
      setSelectedFile(null);
      setMessage(actionMessage(error, "Reference image must be PNG, JPEG, or WebP."));
    }
  }

  async function uploadReference() {
    if (!selectedFile || uploading) return;
    setUploading(true);
    setMessage(null);
    setWarning(null);
    try {
      await uploadProductTemplateGroupReference({ ...scope, file: selectedFile, caption });
      setSelectedFile(null);
      setCaption("");
      await loadReferences();
    } catch (error) {
      setMessage(actionMessage(error, "Reference image upload failed."));
    } finally {
      setUploading(false);
    }
  }

  function chooseReplacement(referenceId: string) {
    setReplaceReferenceId(referenceId);
    replaceInputRef.current?.click();
  }

  async function replaceReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    const referenceId = replaceReferenceId;
    setReplaceReferenceId(null);
    if (!file || !referenceId || replacing) return;
    try {
      validateProductTemplateGroupReferenceFile(file);
    } catch (error) {
      setMessage(actionMessage(error, "Reference image must be PNG, JPEG, or WebP."));
      return;
    }

    setReplacing(true);
    setReplacingId(referenceId);
    setMessage(null);
    setWarning(null);
    try {
      const result = await replaceProductTemplateGroupReference({
        referenceId,
        file,
        caption: captionDrafts[referenceId] ?? null,
      });
      if (result.cleanupWarning) setWarning(result.cleanupWarning);
      await loadReferences();
    } catch (error) {
      setMessage(actionMessage(error, "Reference image could not be replaced."));
    } finally {
      setReplacing(false);
      setReplacingId(null);
    }
  }

  async function removeReference(reference: ProductTemplateGroupReference) {
    if (removingId || !window.confirm("Remove this reference image?")) return;
    setRemovingId(reference.id);
    setMessage(null);
    setWarning(null);
    try {
      const result = await removeProductTemplateGroupReference(reference.id);
      if (result.cleanupWarning) setWarning(result.cleanupWarning);
      await loadReferences();
    } catch (error) {
      setMessage(actionMessage(error, "Reference image could not be removed."));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4" role="dialog" aria-modal="true" aria-label="Pricing group reference images">
      <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-zinc-950">Reference images</h3>
            <p className="mt-1 text-sm text-zinc-500">{groupLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100">Close</button>
        </div>

        <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-xs font-semibold text-zinc-700">
              Optional caption
              <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Manufacturer price page" className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-800" />
            </label>
            <div className="flex flex-wrap gap-2">
              <input ref={uploadInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={selectUploadFile} className="sr-only" />
              <button type="button" onClick={() => uploadInputRef.current?.click()} disabled={uploading} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:border-emerald-600 disabled:opacity-60">Choose image</button>
              <button type="button" onClick={() => void uploadReference()} disabled={!selectedFile || uploading} className="rounded-md bg-emerald-800 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-60">{uploading ? "Uploading…" : "Upload reference"}</button>
            </div>
          </div>
          {selectedFile ? <p className="mt-2 text-xs text-zinc-600">Selected: {selectedFile.name}</p> : null}
          <p className="mt-2 text-xs text-zinc-500">PNG, JPEG, or WebP; up to 5MB.</p>
        </div>

        {message ? <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
        {warning ? <p role="status" className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{warning}</p> : null}

        <input ref={replaceInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void replaceReference(event)} className="sr-only" />

        <div className="mt-5">
          {loading ? <p className="text-sm text-zinc-500">Loading reference images…</p> : null}
          {!loading && !references.length ? <p className="rounded-lg border border-dashed border-zinc-200 p-5 text-sm text-zinc-500">No reference images have been added to this pricing group.</p> : null}
          {!loading && references.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {references.map((reference) => (
                <article key={reference.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  <button type="button" onClick={() => setFullPreview(reference)} disabled={!reference.previewUrl} className="block aspect-[4/3] w-full bg-zinc-100 disabled:cursor-default">
                    {reference.previewUrl ? <img src={reference.previewUrl} alt={reference.caption ?? "Reference image"} className="h-full w-full object-contain" /> : <span className="text-sm text-zinc-500">Preview unavailable</span>}
                  </button>
                  <div className="p-3">
                    <label className="block text-xs font-semibold text-zinc-600">
                      Caption
                      <input value={captionDrafts[reference.id] ?? ""} onChange={(event) => setCaptionDrafts((current) => ({ ...current, [reference.id]: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-zinc-200 px-2 text-sm outline-none focus:border-emerald-800" />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setFullPreview(reference)} disabled={!reference.previewUrl} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 disabled:opacity-50">View</button>
                      <button type="button" onClick={() => chooseReplacement(reference.id)} disabled={replacing} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 disabled:opacity-50">{replacingId === reference.id ? "Replacing…" : "Replace"}</button>
                      <button type="button" onClick={() => void removeReference(reference)} disabled={removingId === reference.id} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">{removingId === reference.id ? "Removing…" : "Remove"}</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {fullPreview?.previewUrl ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/80 p-6" role="dialog" aria-modal="true" aria-label="Full reference image preview" onClick={() => setFullPreview(null)}>
          <div className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setFullPreview(null)} className="mb-3 rounded-md bg-white px-3 py-2 text-xs font-semibold text-zinc-700">Close preview</button>
            <img src={fullPreview.previewUrl} alt={fullPreview.caption ?? "Reference image"} className="max-h-[80vh] max-w-[90vw] object-contain" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FinishCategoryGroupReferenceImages(props: {
  groupId: string;
  groupName: string;
  onClose: () => void;
  templateId: string;
}) {
  return <PricingGroupReferenceImages {...props} groupLabel={props.groupName} pricingType="finish_category" />;
}
