"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { listSupplierPriceDecisions, saveSupplierPriceDecisions } from "@/app/products/supplier-review-decision-actions";
import { buildReviewRows } from "@/lib/products/smart-setup-supplier-review";
import { conflictingDecisionKeys, decisionKey, draftForRow, inputForRow, mapDecisions, sameDraft, supplierPriceChanged, type DecisionDraft, type DecisionMap, type SavedReviewDecision } from "@/lib/products/supplier-review-decisions";
import type { SupplierCheckedResult } from "./smart-setup-supplier-verification";

export function useSupplierReviewDecisions(fresh: SupplierCheckedResult | null, canManage: boolean, onSaved?: (decisions: SavedReviewDecision[]) => void) {
  const sourceId = fresh?.output.source.versionId;
  const rows = useMemo(() => fresh ? buildReviewRows(fresh.output.results, fresh.cells) : [], [fresh]);
  const conflicts = useMemo(() => conflictingDecisionKeys(rows), [rows]);
  const [saved, setSaved] = useState<DecisionMap>({});
  const [edits, setEdits] = useState<Record<string, DecisionDraft>>({});
  const [loadedSource, setLoadedSource] = useState<string>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loading = canManage && !!sourceId && loadedSource !== sourceId && !loadError;
  const enabled = canManage && !!fresh && loadedSource === sourceId && !loadError && !saving;

  useEffect(() => {
    if (!canManage || !sourceId) return;
    let current = true;
    listSupplierPriceDecisions(sourceId).then((records) => {
      if (!current) return;
      setSaved(mapDecisions(records)); setEdits({}); setLoadedSource(sourceId); setLoadError(null); onSaved?.(records);
    }).catch(() => { if (current) setLoadError("Saved decisions could not be loaded. Try again before making changes."); });
    return () => { current = false; };
  }, [canManage, sourceId, retry, onSaved]);

  const updateDraft = (key: string, draft: DecisionDraft) => {
    if (!enabled || conflicts.has(key)) return;
    const row = rows.find((r) => decisionKey(r) === key); if (!row) return;
    if (!draft.decision && !saved[key]) draft = { decision: "", customPrice: "", note: "" };
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
    return savedCount;
  };
  return { rows, saved, edits, conflicts, loading, loadError, enabled, saving, message, saveError, updateDraft, save,
    unsavedCount: Object.keys(edits).length, retry: () => { setLoadError(null); setRetry((n) => n + 1); } };
}
