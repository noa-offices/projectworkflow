"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandCombobox } from "@/components/products/brand-combobox";
import { useEscapeLayer } from "@/components/products/escape-layer";
import { compressToWebp } from "@/lib/images/compress-custom-item-image";
import { formatSavedDate } from "@/lib/products/saved-setups/collection-view";
import type { BrandCount } from "@/lib/products/saved-setups/custom-brands";
import {
  CUSTOM_ITEM_CODE_MAX,
  CUSTOM_ITEM_CURRENCIES,
  CUSTOM_ITEM_NAME_MAX,
  CUSTOM_ITEM_SPEC_MAX,
  CUSTOM_ITEM_UNIT_MAX,
  formatCustomItemPrice,
  type CustomItemFieldErrors,
} from "@/lib/products/saved-setups/custom-item";
import { formatImageSize } from "@/lib/products/saved-setups/custom-item-image";
import { SAVED_SETUP_NAME_MAX } from "@/lib/products/saved-setups/recipe";
import {
  acceptCustomItemShareAction,
  acceptSetupShareAction,
  dismissShareAction,
  listIncomingSharesAction,
  listSentSharesAction,
  unsendShareAction,
} from "@/lib/products/saved-setups/shares-actions";
import {
  SHARE_SETUP_NOTE_MAX,
  canUnsend,
  recipientDisplayName,
  sentStatusLabel,
  type CollectionTab,
  type CustomShareItem,
  type IncomingShareView,
  type SetupShareItem,
  type SentShare,
  type ShareStatus,
} from "@/lib/products/saved-setups/shares";

const secondaryButton =
  "h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-60";
const dangerButton =
  "h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-60";
const primaryButton =
  "h-8 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-300";
const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 px-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const cardClass = "rounded-lg border border-zinc-200 bg-white p-3 shadow-sm";
const HISTORY_LIMIT = 10;

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-zinc-600">{label}</span>
      {children}
      {error ? <span role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}
    </label>
  );
}

function PictureBox({ url, name }: { url: string | null; name: string }) {
  return (
    <div style={{ width: 96, height: 96 }} className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 text-[10px] text-zinc-400">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed private link
        <img src={url} alt={name} loading="lazy" decoding="async" className="h-full w-full object-contain" />
      ) : <span aria-hidden="true">No image</span>}
    </div>
  );
}

type CustomShare = IncomingShareView & { item: CustomShareItem };
type SetupShare = IncomingShareView & { item: SetupShareItem };
const isCustomShare = (share: IncomingShareView): share is CustomShare => share.item.kind === "custom_item";

// ── Review & edit panel (custom item): the recipient edits their OWN copy before it is added ─────────────────────
type PictureMode = "keep" | "remove" | "replace";

function ReviewCustomItem({ share, brands, onCancel, onAccepted }: { share: CustomShare; brands: BrandCount[]; onCancel: () => void; onAccepted: () => void }) {
  const { item } = share;
  const [brand, setBrand] = useState(item.brandName);
  const [name, setName] = useState(item.itemName);
  const [code, setCode] = useState(item.itemCode ?? "");
  const [spec, setSpec] = useState(item.specification ?? "");
  const [unit, setUnit] = useState(item.unitLabel);
  const [price, setPrice] = useState(String(item.sellingPrice));
  const [currency, setCurrency] = useState(item.currency);
  const [mode, setMode] = useState<PictureMode>(share.hasPicture ? "keep" : "remove");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<CustomItemFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pictureError, setPictureError] = useState("");
  const [note, setNote] = useState("");
  const savingRef = useRef(false);
  useEscapeLayer(true, onCancel);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function pick(chosen: File) {
    setPictureError("");
    setNote("");
    setBusy("Compressing...");
    const compressed = await compressToWebp(chosen); // in the browser first: the original is never posted
    setBusy(null);
    if (!compressed.ok) {
      setPictureError(compressed.error);
      return;
    }
    setFile(compressed.file);
    setPreviewUrl(URL.createObjectURL(compressed.file));
    setNote(`Will be saved as ${formatImageSize(compressed.finalBytes)}`);
    setMode("replace");
  }

  async function submit() {
    if (savingRef.current || busy) return;
    if (mode === "replace" && !file) {
      setPictureError("Choose a picture to upload, or pick another option.");
      return;
    }
    savingRef.current = true;
    setBusy("Adding...");
    setErrors({});
    setFormError("");
    try {
      const form = new FormData();
      form.set("shareId", share.id);
      form.set("brand", brand);
      form.set("name", name);
      form.set("code", code);
      form.set("spec", spec);
      form.set("unit", unit);
      form.set("price", price);
      form.set("currency", currency);
      form.set("pictureMode", mode);
      if (mode === "replace" && file) form.set("file", file);
      const result = await acceptCustomItemShareAction(form);
      if (result.ok) {
        onAccepted();
        return;
      }
      setErrors(("fieldErrors" in result && result.fieldErrors) || {});
      setFormError(("fieldErrors" in result && result.fieldErrors) ? "" : result.message);
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      savingRef.current = false;
      setBusy(null);
    }
  }

  return (
    <form
      aria-label="Review shared item"
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
      className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4"
    >
      <p className="text-xs text-zinc-600">Check and change anything you like. This becomes your own copy.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <BrandCombobox brands={brands} value={brand} error={errors.brandName} onChange={setBrand} />
        <Field label="Item name" error={errors.itemName}><input value={name} maxLength={CUSTOM_ITEM_NAME_MAX} onChange={(event) => setName(event.target.value)} aria-label="Item name" className={inputClass} /></Field>
        <Field label="Code (optional)" error={errors.itemCode}><input value={code} maxLength={CUSTOM_ITEM_CODE_MAX} onChange={(event) => setCode(event.target.value)} aria-label="Code" className={inputClass} /></Field>
        <Field label="Unit" error={errors.unitLabel}><input value={unit} maxLength={CUSTOM_ITEM_UNIT_MAX} onChange={(event) => setUnit(event.target.value)} aria-label="Unit" className={inputClass} /></Field>
        <Field label="Selling price" error={errors.sellingPrice}><input value={price} inputMode="decimal" onChange={(event) => setPrice(event.target.value)} aria-label="Selling price" className={inputClass} /></Field>
        <Field label="Currency" error={errors.currency}>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} aria-label="Currency" className={inputClass}>
            {CUSTOM_ITEM_CURRENCIES.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Specification (optional)" error={errors.specification}>
        <textarea value={spec} maxLength={CUSTOM_ITEM_SPEC_MAX} rows={3} onChange={(event) => setSpec(event.target.value)} aria-label="Specification" className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10" />
      </Field>

      <fieldset className="rounded-md border border-zinc-200 bg-white p-3">
        <legend className="px-1 text-xs font-semibold text-zinc-600">Picture</legend>
        <div className="flex flex-wrap items-start gap-3">
          <PictureBox url={mode === "keep" ? share.pictureUrl : mode === "replace" ? previewUrl || null : null} name={item.itemName} />
          <div className="min-w-0 space-y-2 text-sm text-zinc-800">
            {share.hasPicture ? (
              <label className="flex items-center gap-2"><input type="radio" name={`picture-${share.id}`} checked={mode === "keep"} onChange={() => setMode("keep")} />Keep the sender&apos;s picture</label>
            ) : null}
            <label className="flex items-center gap-2"><input type="radio" name={`picture-${share.id}`} checked={mode === "remove"} onChange={() => setMode("remove")} />No picture</label>
            <label className="flex items-center gap-2"><input type="radio" name={`picture-${share.id}`} checked={mode === "replace"} onChange={() => setMode("replace")} />Use my own picture</label>
            {mode === "replace" ? (
              <div className="space-y-1">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Your picture file"
                  disabled={Boolean(busy)}
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    event.target.value = "";
                    if (chosen) void pick(chosen);
                  }}
                  className="block text-xs"
                />
                <p className="text-[11px] text-zinc-500">PNG, JPG or WebP, up to 10 MB. We compress it to a small WebP automatically.</p>
                {note && !pictureError ? <p role="status" className="text-[11px] font-semibold text-emerald-800">{note}</p> : null}
              </div>
            ) : null}
            {share.pictureNote ? <p className="text-[11px] text-amber-800">{share.pictureNote}</p> : null}
          </div>
        </div>
        {pictureError ? <p role="alert" className="mt-2 text-xs text-red-700">{pictureError}</p> : null}
      </fieldset>

      {formError ? <p role="alert" className="text-xs text-red-700">{formError}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={Boolean(busy)} className={primaryButton}>{busy ?? "Add to My Collection"}</button>
        <button type="button" disabled={Boolean(busy)} onClick={onCancel} className={secondaryButton}>Cancel</button>
      </div>
    </form>
  );
}

// ── Review & edit panel (setup): only the name and note can change; brand and product come from the product ──────
function ReviewSetup({ share, onCancel, onAccepted }: { share: SetupShare; onCancel: () => void; onAccepted: () => void }) {
  const { item } = share;
  const [name, setName] = useState(item.setupName);
  const [note, setNote] = useState(item.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  useEscapeLayer(true, onCancel);

  async function submit() {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await acceptSetupShareAction({ shareId: share.id, setupName: name, note });
      if (result.ok) onAccepted();
      else setError(result.message);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Review shared setup"
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
      className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4"
    >
      <p className="text-xs text-zinc-600">You can rename it. Brand and product come from the product itself.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Brand"><p className="flex h-9 items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 text-sm text-zinc-700">{item.brandName}</p></Field>
        <Field label="Product"><p className="flex h-9 items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 text-sm text-zinc-700">{item.productName}</p></Field>
      </div>
      <Field label="Setup name"><input value={name} maxLength={SAVED_SETUP_NAME_MAX} onChange={(event) => setName(event.target.value)} aria-label="Setup name" className={inputClass} /></Field>
      <Field label="Note (optional)"><textarea value={note} maxLength={SHARE_SETUP_NOTE_MAX} rows={3} onChange={(event) => setNote(event.target.value)} aria-label="Note" className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10" /></Field>
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>{busy ? "Adding..." : "Add to My Collection"}</button>
        <button type="button" disabled={busy} onClick={onCancel} className={secondaryButton}>Cancel</button>
      </div>
    </form>
  );
}

// ── One waiting share ────────────────────────────────────────────────────────────────────────────────────────────
function IncomingCard({ share, busy, onAddNow, onReview, onDismiss }: { share: IncomingShareView; busy: boolean; onAddNow: () => void; onReview: () => void; onDismiss: () => void }) {
  const [confirming, setConfirming] = useState(false);
  useEscapeLayer(confirming, () => setConfirming(false));
  const { item } = share;
  return (
    <li className={cardClass}>
      <p className="text-xs text-zinc-500">From <span className="font-semibold text-zinc-800">{share.senderName || "A colleague"}</span> · {formatSavedDate(share.createdAt)}</p>
      <div className="mt-2 flex min-w-0 gap-3">
        {item.kind === "custom_item" ? <PictureBox url={share.pictureUrl} name={item.itemName} /> : null}
        <div className="min-w-0 flex-1">
          {item.kind === "custom_item" ? (
            <>
              <p className="break-words text-base font-bold leading-snug text-zinc-900">{item.itemName}</p>
              <p className="mt-1 text-xs text-zinc-600">{item.brandName}{item.itemCode ? ` · ${item.itemCode}` : ""}</p>
              <p className="mt-1 text-xs font-semibold text-zinc-800">{formatCustomItemPrice(item.currency, item.sellingPrice)} · Unit: {item.unitLabel}</p>
              {item.specification ? <p className="mt-1 line-clamp-3 text-xs text-zinc-500">{item.specification}</p> : null}
              {!share.hasPicture && share.pictureNote ? <p className="mt-1 text-[11px] text-amber-800">{share.pictureNote}</p> : null}
            </>
          ) : (
            <>
              <p className="break-words text-base font-bold leading-snug text-zinc-900">{item.setupName}</p>
              <p className="mt-1 text-xs text-zinc-600">{item.brandName} · {item.productName}</p>
              {item.note ? <p className="mt-1 line-clamp-3 text-xs text-zinc-500">{item.note}</p> : null}
            </>
          )}
          {share.note ? <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-700">{share.note}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
        {confirming ? (
          <>
            <button type="button" disabled={busy} onClick={() => { setConfirming(false); onDismiss(); }} className="h-8 rounded-md bg-red-700 px-3 text-xs font-semibold text-white transition hover:bg-red-800 disabled:bg-zinc-300">Confirm dismiss</button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={secondaryButton}>Keep</button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={onAddNow} className={primaryButton}>{busy ? "Adding..." : "Add now"}</button>
            <button type="button" disabled={busy} onClick={onReview} className={secondaryButton}>Review &amp; edit</button>
            <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={dangerButton}>Dismiss</button>
          </>
        )}
      </div>
    </li>
  );
}

function statusChip(status: ShareStatus) {
  const tone = status === "pending" ? "border-amber-200 bg-amber-50 text-amber-800" : status === "accepted" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-zinc-100 text-zinc-600";
  return `inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`;
}

// ── "Shared with you" tab ────────────────────────────────────────────────────────────────────────────────────────
export function SharedWithYouTab({ brands, onPendingChange, onOpenTab }: { brands: BrandCount[]; onPendingChange: (count: number) => void; onOpenTab: (tab: CollectionTab) => void }) {
  const router = useRouter();
  const [shares, setShares] = useState<IncomingShareView[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [added, setAdded] = useState<{ tab: "configured" | "custom"; text: string } | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function load() {
    const result = await listIncomingSharesAction();
    if (result.ok) {
      setShares(result.shares);
      setLoadError("");
    } else {
      setLoadError(result.message);
      setShares((current) => current ?? []);
    }
  }
  useEffect(() => {
    let cancelled = false;
    listIncomingSharesAction().then((result) => {
      if (cancelled) return;
      if (result.ok) setShares(result.shares);
      else {
        setLoadError(result.message);
        setShares([]);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const pending = useMemo(() => (shares ?? []).filter((share) => share.status === "pending"), [shares]);
  const history = useMemo(() => (shares ?? []).filter((share) => share.status !== "pending").slice(0, HISTORY_LIMIT), [shares]);
  useEffect(() => {
    if (shares) onPendingChange(pending.length);
  }, [shares, pending.length, onPendingChange]);

  function setStatus(id: string, status: ShareStatus) {
    setShares((current) => current?.map((share) => (share.id === id ? { ...share, status } : share)) ?? current);
  }

  function finishAccept(share: IncomingShareView) {
    setStatus(share.id, "accepted");
    setReviewing(null);
    setMessage("");
    setAdded({ tab: share.kind === "custom_item" ? "custom" : "configured", text: `Added "${share.itemName}" to your collection.` });
    router.refresh(); // the Configured / Custom lists show the new item without a page reload
  }

  async function run(share: IncomingShareView, action: () => Promise<{ ok: true } | { ok: false; message: string }>, onOk: () => void) {
    if (busyRef.current) return; // one action at a time: no double click
    busyRef.current = true;
    setBusyId(share.id);
    setMessage("");
    try {
      const result = await action();
      if (result.ok) onOk();
      else setMessage(result.message);
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }

  function addNow(share: IncomingShareView) {
    const item = share.item;
    void run(
      share,
      () => item.kind === "custom_item"
        ? acceptCustomItemShareAction({ shareId: share.id, brand: item.brandName, name: item.itemName, code: item.itemCode ?? "", spec: item.specification ?? "", unit: item.unitLabel, price: String(item.sellingPrice), currency: item.currency, pictureMode: "keep" })
        : acceptSetupShareAction({ shareId: share.id, setupName: item.setupName, note: item.note }),
      () => finishAccept(share),
    );
  }

  function dismiss(share: IncomingShareView) {
    void run(share, () => dismissShareAction(share.id), () => {
      setStatus(share.id, "dismissed");
      setReviewing(null);
    });
  }

  if (shares === null) return <p className="text-sm text-zinc-500">Loading shared items...</p>;

  return (
    <div className="space-y-6">
      {loadError ? (
        <p role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {loadError}
          <button type="button" onClick={() => { void load(); }} className={secondaryButton}>Try again</button>
        </p>
      ) : null}
      {message ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p> : null}
      {added ? (
        <p role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {added.text}
          <button type="button" onClick={() => onOpenTab(added.tab)} className={secondaryButton}>{added.tab === "custom" ? "View in Custom items" : "View in Configured products"}</button>
        </p>
      ) : null}

      {pending.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-500">
          Nothing is waiting for you. When a colleague shares an item, it shows up here.
        </p>
      ) : (
        <ul className="space-y-3">
          {pending.map((share) => (
            <Fragment key={share.id}>
              <IncomingCard share={share} busy={busyId === share.id} onAddNow={() => addNow(share)} onReview={() => { setReviewing(share.id); setMessage(""); }} onDismiss={() => dismiss(share)} />
              {reviewing === share.id ? (
                <li className="list-none">
                  {isCustomShare(share)
                    ? <ReviewCustomItem share={share} brands={brands} onCancel={() => setReviewing(null)} onAccepted={() => finishAccept(share)} />
                    : <ReviewSetup share={share as SetupShare} onCancel={() => setReviewing(null)} onAccepted={() => finishAccept(share)} />}
                </li>
              ) : null}
            </Fragment>
          ))}
        </ul>
      )}

      {history.length > 0 ? (
        <section aria-label="Earlier shares">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Earlier</h2>
          <ul className="space-y-2">
            {history.map((share) => (
              <li key={share.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                <span className="min-w-0 truncate">{share.itemName} · from {share.senderName || "A colleague"} · {formatSavedDate(share.createdAt)}</span>
                <span className={statusChip(share.status)}>{sentStatusLabel(share.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ── "Sent" tab ───────────────────────────────────────────────────────────────────────────────────────────────────
function SentRow({ share, onChanged, onMessage }: { share: SentShare; onChanged: (id: string) => void; onMessage: (message: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEscapeLayer(confirming, () => setConfirming(false));

  async function unsend() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await unsendShareAction(share.id);
      if (result.ok) onChanged(share.id);
      else onMessage(result.message);
    } catch {
      onMessage("Something went wrong. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className={`${cardClass} flex flex-wrap items-center justify-between gap-3`}>
      <div className="min-w-0">
        <p className="break-words text-sm font-bold text-zinc-900">{share.itemName}</p>
        <p className="mt-1 text-xs text-zinc-500">To {recipientDisplayName(share.recipientName)} · {formatSavedDate(share.createdAt)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={statusChip(share.status)}>{sentStatusLabel(share.status)}</span>
        {canUnsend(share.status) ? (
          confirming ? (
            <>
              <button type="button" disabled={busy} onClick={() => { void unsend(); }} className="h-8 rounded-md bg-red-700 px-3 text-xs font-semibold text-white transition hover:bg-red-800 disabled:bg-zinc-300">Confirm unsend</button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={secondaryButton}>Keep</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={dangerButton}>Unsend</button>
          )
        ) : null}
      </div>
    </li>
  );
}

export function SentTab() {
  const [shares, setShares] = useState<SentShare[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const result = await listSentSharesAction();
    if (result.ok) {
      setShares(result.shares);
      setError("");
    } else {
      setError(result.message);
      setShares((current) => current ?? []);
    }
  }
  useEffect(() => {
    let cancelled = false;
    listSentSharesAction().then((result) => {
      if (cancelled) return;
      if (result.ok) setShares(result.shares);
      else {
        setError(result.message);
        setShares([]);
      }
    });
    return () => { cancelled = true; };
  }, []);

  if (shares === null) return <p className="text-sm text-zinc-500">Loading sent items...</p>;
  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
          <button type="button" onClick={() => { void load(); }} className={secondaryButton}>Try again</button>
        </p>
      ) : null}
      {message ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p> : null}
      {shares.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-500">
          You have not shared anything yet. Use Share on any of your items.
        </p>
      ) : (
        <ul className="space-y-3">
          {shares.map((share) => (
            <SentRow key={share.id} share={share} onMessage={setMessage} onChanged={(id) => setShares((current) => current?.map((entry) => (entry.id === id ? { ...entry, status: "unsent" } : entry)) ?? current)} />
          ))}
        </ul>
      )}
    </div>
  );
}
