"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { listSupplierCarryOverDecisions, listSupplierPriceDecisions, saveSupplierPriceDecisions } from "@/app/products/supplier-review-decision-actions";
import { buildReviewRows } from "@/lib/products/smart-setup-supplier-review";
import { conflictingDecisionKeys, decisionForRow, decisionKey, draftForRow, inputForRow, mapDecisions, sameDraft, supplierPriceChanged, usableSupplierPrice, type DecisionDraft, type DecisionMap, type SavedReviewDecision } from "@/lib/products/supplier-review-decisions";
import { carryOverKey, classifyCarryOverRows, type CarryOverDecision, type CarryOverRowState } from "@/lib/products/supplier-carry-over";
import type { SupplierCheckedResult } from "./smart-setup-supplier-verification";

export function useSupplierReviewDecisions(fresh: SupplierCheckedResult | null, canManage: boolean, onSaved?: (decisions: SavedReviewDecision[]) => void) {
  const sourceId = fresh?.output.source.versionId;
  const rows = useMemo(() => fresh ? buildReviewRows(fresh.output.results, fresh.cells) : [], [fresh]);
  const conflicts = useMemo(() => conflictingDecisionKeys(rows), [rows]);
  const [saved, setSaved] = useState<DecisionMap>({});
  const [earlier, setEarlier] = useState<CarryOverDecision[]>([]);
  const [edits, setEdits] = useState<Record<string, DecisionDraft>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [loadedSource, setLoadedSource] = useState<string>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [carryError, setCarryError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loading = canManage && !!sourceId && loadedSource !== sourceId && !loadError;
  const enabled = canManage && !!fresh && loadedSource === sourceId && !loadError && !saving;
  const rowStates = useMemo(() => classifyCarryOverRows(rows.map((row) => ({ model_code: row.result.code, price_field: row.result.priceField, supplier_price: usableSupplierPrice(row), currency: row.result.importedCurrency, usable_supplier_price: usableSupplierPrice(row) !== null })), Object.values(saved), earlier), [rows, saved, earlier]);
  const carryStates: Record<string, CarryOverRowState> = Object.fromEntries(rows.map((row, index) => [decisionKey(row), rowStates[index]]));
  const carryCounts = { carriedOver: rowStates.filter((state) => state.kind === "carried_over").length, priceChanged: rowStates.filter((state) => state.kind === "price_changed").length, newlyFound: rowStates.filter((state) => state.kind === "new").length, saved: rowStates.filter((state) => state.kind === "saved" && state.saved.status === "open").length };
  const savedDecidedCount = rows.filter((row) => !conflicts.has(decisionKey(row)) && decisionForRow(row, saved[decisionKey(row)])).length;

  useEffect(() => {
    if (!canManage || !sourceId) return;
    let current = true;
    Promise.allSettled([listSupplierPriceDecisions(sourceId), listSupplierCarryOverDecisions(sourceId)]).then(([ownResult, earlierResult]) => {
      if (!current) return;
      if (ownResult.status === "rejected") { setLoadError("Saved decisions could not be loaded. Try again before making changes."); return; }
      const records = ownResult.value;
      const prior = earlierResult.status === "fulfilled" ? earlierResult.value : [];
      const states = classifyCarryOverRows(rows.map((row) => ({ model_code: row.result.code, price_field: row.result.priceField, supplier_price: usableSupplierPrice(row), currency: row.result.importedCurrency, usable_supplier_price: usableSupplierPrice(row) !== null })), records, prior);
      setSaved(mapDecisions(records)); setEarlier(prior); setDismissed(new Set());
      setEdits(Object.fromEntries(rows.flatMap((row, index) => {
        const state = states[index], key = carryOverKey({ model_code: row.result.code, price_field: row.result.priceField });
        if (state.kind !== "carried_over" || conflicts.has(key)) return [];
        return [[key, { decision: state.earlier.decision, customPrice: state.earlier.decision === "set_custom" ? String(state.earlier.custom_price ?? "") : "", note: state.earlier.note ?? "" } as DecisionDraft]];
      })));
      setLoadedSource(sourceId); setLoadError(null); setCarryError(earlierResult.status === "rejected" ? "Earlier decisions could not be loaded. You can still review this price list." : null);
      onSaved?.(records);
    });
    return () => { current = false; };
  }, [canManage, sourceId, retry, onSaved, rows, conflicts]);

  const updateDraft = (key: string, draft: DecisionDraft) => {
    if (!enabled || conflicts.has(key)) return;
    const row = rows.find((r) => decisionKey(r) === key); if (!row) return;
    if (!draft.decision && !saved[key]) { draft = { decision: "", customPrice: "", note: "" }; setDismissed((current) => new Set(current).add(key)); }
    else setDismissed((current) => { const next = new Set(current); next.delete(key); return next; });
    setMessage(null); setSaveError(null);
    setEdits((current) => {
      const next = { ...current };
      if (sameDraft(draft, draftForRow(row, saved[key])) && !supplierPriceChanged(row, saved[key])) delete next[key];
      else next[key] = draft;
      return next;
    });
  };
  const save = async () => {
    if (!enabled || savingRef.current || !Object.keys(edits).length) return;
    savingRef.current = true; setSaving(true); setMessage(null); setSaveError(null);
    let savedCount = 0;
    try {
      const changes = Object.entries(edits).map(([key, draft]) => {
        const row = rows.find((r) => decisionKey(r) === key);
        if (!row || conflicts.has(key)) throw Error("Some rows cannot be saved. Review the highlighted rows.");
        const input = inputForRow(row, draft, saved[key]);
        if (!input) throw Error(`${row.result.code}: choose an action before saving a note.`);
        return { key, input };
      });
      let merged = { ...saved };
      for (let from = 0; from < changes.length; from += 200) {
        const batch = changes.slice(from, from + 200);
        const records = await saveSupplierPriceDecisions(batch.map((c) => c.input));
        merged = { ...merged, ...mapDecisions(records) };
        setSaved(merged); setEdits((current) => { const next = { ...current }; batch.forEach(({ key }) => delete next[key]); return next; });
        savedCount += batch.length; onSaved?.(Object.values(merged));
      }
      setMessage(`${savedCount} decision${savedCount === 1 ? "" : "s"} saved. Product prices have not changed.`);
    } catch (error) {
      setSaveError(`${savedCount ? `${savedCount} decisions saved. ` : ""}${error instanceof Error ? error.message : "Decisions could not be saved. Your changes are still here; try again."}`);
    } finally { savingRef.current = false; setSaving(false); }
  };
  return { rows, saved, earlier, carryStates, carryCounts, dismissed, edits, conflicts, loading, loadError, carryError, enabled, saving, message, saveError, updateDraft, save, savedDecidedCount,
    unsavedCount: Object.keys(edits).length, retry: () => { setLoadError(null); setRetry((n) => n + 1); } };
}
