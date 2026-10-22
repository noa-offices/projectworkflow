"use client";

import React, { useRef, useState, useTransition } from "react";
import type { ArchivedLinkInput, ArchivedLinkResult } from "@/lib/products/archived-template-link-deletion";
import { requestArchiveLinkRemoval, type ArchiveLinkDisplay } from "@/lib/products/archive-family-links";

export function ArchiveFamilyLinksPanel({ templateId, templateName, links, canRemove, loadError, removeAction, deactivateAction, refresh }: {
  templateId: string;
  templateName: string;
  links: ArchiveLinkDisplay[];
  canRemove: boolean;
  loadError: boolean;
  removeAction: (input: ArchivedLinkInput) => Promise<ArchivedLinkResult>;
  deactivateAction: (input: ArchivedLinkInput) => Promise<ArchivedLinkResult>;
  refresh: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [result, setResult] = useState<ArchivedLinkResult | null>(null);
  return (
    <section aria-label={`Family links for ${templateName}`} className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
      <h4 className="font-semibold">{templateName} — {loadError ? "Links unavailable" : `${links.length} relationship${links.length === 1 ? "" : "s"}`}</h4>
      {result ? <p role={result.ok ? "status" : "alert"}>{result.message}</p> : null}
      {loadError ? <p role="alert">Could not load all relationships. Refresh before managing links.</p> : null}
      {!loadError && !links.length ? <p>No linked-family relationships. Template deletion remains a separate action.</p> : null}
      {!canRemove ? <p>Your role cannot deactivate or permanently remove these relationships.</p> : null}
      {links.map((link) => (
        <div key={link.id} className="space-y-1 border-t border-zinc-200 pt-2">
          <p><strong>{link.parentName}</strong> ({link.parentBrand}) → <strong>{link.linkedName}</strong> ({link.linkedBrand})</p>
          <p>Selected template is the {link.parent_template_id === templateId ? "parent" : "linked product"}.</p>
          {link.is_active ? <>
            <p>Active</p>
            {canRemove && !loadError ? <button type="button" disabled={pending} className="rounded-md border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-800 disabled:opacity-50"
              onClick={() => {
                if (busy.current || !window.confirm(`Deactivate the relationship from ${link.parentName} to ${link.linkedName}? Future product configurations, required products, quantities and pricing may change. Saved quotation snapshots will remain intact. This does not permanently remove the link.`)) return;
                busy.current = true;
                setResult(null);
                startTransition(async () => {
                  try {
                    const outcome = await requestArchiveLinkRemoval({ templateId, relationshipId: link.id }, deactivateAction, () => startTransition(refresh));
                    setResult(outcome.code === "unconfirmed" ? { ...outcome, message: "Deactivation was not confirmed. Refresh links before trying again." } : outcome);
                  } finally { busy.current = false; }
                });
              }}>{pending ? "Updating links..." : "Deactivate link"}</button> : null}
          </> : <>
            <p>Inactive</p>
            {canRemove && !loadError ? <button type="button" disabled={pending} className="rounded-md border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
              onClick={() => {
                if (busy.current || !window.confirm(`Permanently remove the inactive relationship from ${link.parentName} to ${link.linkedName}? This cannot be undone. Neither template will be deleted.`)) return;
                busy.current = true;
                setResult(null);
                startTransition(async () => {
                  try {
                    setResult(await requestArchiveLinkRemoval({ templateId, relationshipId: link.id }, removeAction, () => startTransition(refresh)));
                  } finally { busy.current = false; }
                });
              }}>{pending ? "Updating links..." : "Remove permanently"}</button> : null}
          </>}
        </div>
      ))}
      <button type="button" disabled={pending} className="text-xs underline" onClick={() => startTransition(refresh)}>Refresh links</button>
    </section>
  );
}
