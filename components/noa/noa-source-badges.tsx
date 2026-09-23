"use client";

import type { NoaDomain, NoaSource } from "@/lib/noa/noa-types";

// Kept deliberately subtle: small text, muted pill, secondary to the answer text above it. Only
// ever rendered for assistant messages - callers must not pass this a user message's fields.
export function NoaSourceBadges({
  domain,
  sources,
}: {
  domain?: NoaDomain;
  sources?: NoaSource[];
}) {
  if (!sources?.length) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {domain ? (
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          {domain}
        </span>
      ) : null}
      {sources.map((source, index) => (
        // source.label is already the user-facing description ("Checked Product Library", etc.) -
        // never a raw table name, SQL fragment, or record id.
        <span
          key={`${source.type}-${source.recordId ?? index}`}
          className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600"
        >
          {source.label}
        </span>
      ))}
    </div>
  );
}
