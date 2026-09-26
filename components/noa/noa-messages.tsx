"use client";

import { useEffect, useRef } from "react";
import type React from "react";
import { Square, Volume2 } from "lucide-react";
import { hasSpeechText, type NoaVoice } from "@/components/noa/use-noa-voice";
import { NoaSourceBadges } from "@/components/noa/noa-source-badges";
import type {
  NoaAnalyticsComparison,
  NoaAnalyticsMetric,
  NoaAnalyticsRankingGroup,
  NoaAnalyticsStatusRow,
  NoaAnalyticsTransport,
  NoaAnalyticsTrendRow,
  NoaAttentionTransport,
  NoaAttentionTransportItem,
  NoaCatchUpChange,
  NoaCatchUpTransport,
  NoaCatchUpTransportItem,
  NoaMessage,
} from "@/lib/noa/noa-types";

// Attention structured UI: renders the server's already-authorized `attention.items` as cards
// instead of the long deterministic prose. Every value read here (title/detail/entityLabel/
// entityIdentifier/kind/sourceDomain) comes straight from the transport payload the orchestrator
// already built from the SAME authorized items array the text was generated from - this file
// never parses `message.text`, never invents an identifier, never queries anything.

// PART 3: a fixed, discrete-enum-to-label map (never free-text parsing) - `kind` is one of the
// two stable values the Attention capability itself defines.
const PROCUREMENT_STATUS_LABEL: Record<string, string> = {
  procurement_missing_eta: "ETA missing",
  procurement_missing_etd: "ETD missing",
};

// PART 4: `detail` is always exactly `${entityIdentifier} · ${reference}` for a Procurement item
// (noa-attention-capability.server.ts's own construction) - stripping that known, fixed prefix is
// a plain string operation on already-structured transport data, never a regex reconstruction of
// facts from prose. Falls back to the full `detail` string unchanged if the prefix doesn't match
// (e.g. a future item shape), so nothing is ever silently dropped.
function procurementProjectTitle(item: NoaAttentionTransportItem): string {
  const prefix = item.entityIdentifier ? `${item.entityIdentifier} · ` : null;
  return prefix && item.detail.startsWith(prefix) ? item.detail.slice(prefix.length) : item.detail;
}

type NoaProcurementVendorGroup = { vendorLabel: string; statuses: string[] };
type NoaProcurementProjectGroup = { entityIdentifier: string; projectTitle: string; vendors: NoaProcurementVendorGroup[] };

// PART 3: UI-only grouping - never mutates `items`, never merges across a different orderNo or
// vendor. Groups are built in the SAME order the items already arrive in (server-authoritative,
// Product Price -> Procurement -> Client Payment, and within Procurement already Project-File-
// then-vendor ordered), so this is a pure re-bucketing, never a re-sort/re-rank.
function groupProcurementItems(items: NoaAttentionTransportItem[]): NoaProcurementProjectGroup[] {
  const groups: NoaProcurementProjectGroup[] = [];
  const groupByOrder = new Map<string, NoaProcurementProjectGroup>();

  for (const item of items) {
    const orderKey = item.entityIdentifier ?? item.detail;
    let group = groupByOrder.get(orderKey);
    if (!group) {
      group = { entityIdentifier: item.entityIdentifier ?? "", projectTitle: procurementProjectTitle(item), vendors: [] };
      groupByOrder.set(orderKey, group);
      groups.push(group);
    }

    let vendor = group.vendors.find((candidate) => candidate.vendorLabel === item.entityLabel);
    if (!vendor) {
      vendor = { vendorLabel: item.entityLabel, statuses: [] };
      group.vendors.push(vendor);
    }

    const statusLabel = PROCUREMENT_STATUS_LABEL[item.kind] ?? item.title;
    if (!vendor.statuses.includes(statusLabel)) vendor.statuses.push(statusLabel);
  }

  return groups;
}

// PART 6: a restrained, non-interactive status pill - plain <span>, never a <button>/clickable
// <div> (PART 16/17: these are informational statuses, not actions, and there is no "Fix"/"Set
// ETA" behavior in this phase).
function NoaAttentionStatusChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
      {label}
    </span>
  );
}

// PART 4/7/13/14/16: one compact card per Project File (identifier once, title once, never
// repeated per vendor), vendor rows beneath with wrapping status chips. Reading order in the DOM
// is Project -> vendor -> statuses, matching the required screen-reader order with no extra ARIA
// needed beyond the section landmark below.
function NoaProcurementCard({ group }: { group: NoaProcurementProjectGroup }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3">
      {group.entityIdentifier ? (
        <div className="text-xs font-semibold text-zinc-500">{group.entityIdentifier}</div>
      ) : null}
      <div className="mb-2 text-sm font-medium text-zinc-900">{group.projectTitle}</div>
      <div className="flex flex-col gap-2">
        {group.vendors.map((vendor) => (
          <div key={vendor.vendorLabel}>
            <div className="text-sm font-medium text-zinc-800">{vendor.vendorLabel}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {vendor.statuses.map((status) => (
                <NoaAttentionStatusChip key={status} label={status} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// PART 8/9: Product Price / Client Payment findings don't need Project-File grouping - a simple
// compact list under a section header, reusing the item's own already-authorized title/detail
// exactly as the deterministic text already would have shown them.
function NoaAttentionFlatSection({ items, label }: { items: NoaAttentionTransportItem[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={label} className="rounded-2xl border border-zinc-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={`${item.kind}-${item.entityLabel}-${item.title}`}>
            <div className="text-sm font-medium text-zinc-900">{item.entityLabel}</div>
            <div className="text-xs text-zinc-600">{item.detail || item.title}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// PART 7/10/12: the summary header replaces the long deterministic prose entirely (never both) -
// counts are read straight from the already-received structured payload, never recomputed from
// text or invented (no "critical"/"urgent"/risk score). Section order (Price -> Procurement ->
// Payment) mirrors the server's own authoritative order, never re-sorted.
function NoaAttentionCards({ attention }: { attention: NoaAttentionTransport }) {
  const priceItems = attention.items.filter((item) => item.sourceDomain === "Price");
  const procurementItems = attention.items.filter((item) => item.sourceDomain === "Procurement");
  const paymentItems = attention.items.filter((item) => item.sourceDomain === "ClientPayment");
  const procurementGroups = groupProcurementItems(procurementItems);
  const vendorGroupCount = procurementGroups.reduce((sum, group) => sum + group.vendors.length, 0);

  return (
    <div className="flex w-full max-w-[92%] flex-col gap-2.5 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 shadow-sm">
      <div className="text-sm font-semibold text-zinc-900">
        {attention.count} item{attention.count === 1 ? "" : "s"} need attention
        {procurementGroups.length > 0 ? (
          <span className="ml-1.5 text-xs font-normal text-zinc-500">
            · {procurementGroups.length} project{procurementGroups.length === 1 ? "" : "s"} · {vendorGroupCount} vendor group{vendorGroupCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      <NoaAttentionFlatSection items={priceItems} label="Product prices" />

      {procurementGroups.length > 0 ? (
        <section aria-label="Procurement" className="flex flex-col gap-2">
          {procurementGroups.map((group) => (
            <NoaProcurementCard group={group} key={group.entityIdentifier || group.projectTitle} />
          ))}
        </section>
      ) : null}

      <NoaAttentionFlatSection items={paymentItems} label="Client payments" />
    </div>
  );
}

// N2B3.4: renders the server's already-validated Catch-Up `changes[]`/items as a mobile-first
// timeline instead of the long deterministic prose bubble. Every value read here comes straight
// from the transport payload the orchestrator built from the SAME items array the prose was
// generated from - this file never parses `message.text`, never regroups/reorders events, never
// invents a heading/count.

// PART 7/8/12/13: small, explicit, PRESENTATION-ONLY mirrors of the exact same field-specific
// formatting rules already validated server-side (lib/noa/noa-user-activity-capability.server.ts,
// B3.2/B3.3) - duplicated rather than imported because that module has a "server-only" import
// guard and cannot be pulled into a client component. These operate ONLY on already-structured
// scalars from the server's own `changes[]` transport, never on prose.
const CATCH_UP_STEP_LABELS: readonly string[] = [
  "RFQ", "PO Issued", "Deposit Paid", "In Production", "Quality Check", "Ready for Shipment", "In Transit", "Delivered & Installed",
];
const CATCH_UP_CANONICAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CATCH_UP_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function catchUpFormatCanonicalDate(value: string): string {
  const match = value.match(CATCH_UP_CANONICAL_DATE_PATTERN);
  if (!match) return value;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return value;
  return `${Number(match[3])} ${CATCH_UP_MONTH_LABELS[monthIndex]} ${match[1]}`;
}

function catchUpHumanizeEnumValue(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function catchUpFormatScalar(field: string, value: string | number | boolean | null, currency?: string): string | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "active_step" && typeof value === "number") return CATCH_UP_STEP_LABELS[value] ?? String(value);
  if (typeof value === "number") {
    const formatted = new Intl.NumberFormat("en-US").format(value);
    return currency ? `${currency} ${formatted}` : formatted;
  }
  if ((field === "eta" || field === "etd") && typeof value === "string") return catchUpFormatCanonicalDate(value);
  return field === "status" ? catchUpHumanizeEnumValue(value) : value;
}

// PART 6: the browser's own default-locale formatting (no manual offset/timezone math) - the same
// deterministic-formatter category as the server's own formatTimestamp(), just rendered in the
// viewer's own locale/timezone rather than the server process's.
function catchUpFormatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const datePart = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
  const timePart = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${datePart} · ${timePart}`;
}

// PART 8/24: a plain, non-interactive pill - never a button/clickable element.
function NoaCatchUpChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-600">
      {children}
    </span>
  );
}

// N2C1.1 PART 18: live UAT showed squished spacing ("RFQ→PO Issued", "AddedRFQ") when the old/
// new value and the arrow/chip were split across separate flex children relying only on CSS
// `gap`. Fixed by composing each value line as ONE text string with explicit space/middle-dot
// characters baked in - immune to any flex/gap quirk, and copy-pastes correctly too. Server data/
// structured-change semantics are completely unchanged - this only changes how the already-
// formatted strings are joined for display.
function NoaCatchUpChangeRow({ change }: { change: NoaCatchUpChange }) {
  const label = change.label ?? change.field;
  const formattedOld = catchUpFormatScalar(change.field, change.oldValue, change.currency);
  const formattedNew = catchUpFormatScalar(change.field, change.newValue, change.currency);
  return (
    <div>
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        {change.oldValue === null && formattedNew !== null ? (
          <>
            <NoaCatchUpChip>Added</NoaCatchUpChip>
            <span className="text-sm text-zinc-800">{`· ${formattedNew}`}</span>
          </>
        ) : change.newValue === null && formattedOld !== null ? (
          <>
            <NoaCatchUpChip>Cleared</NoaCatchUpChip>
            <span className="text-sm text-zinc-500">{`· was ${formattedOld}`}</span>
          </>
        ) : (
          <span className="text-sm text-zinc-800">{`${formattedOld} → ${formattedNew}`}</span>
        )}
      </div>
    </div>
  );
}

// PART 5/6/9/10/11/12/13: one timeline row per event GROUP (never the raw pre-consolidation rows -
// PART 11/17: no client-side regrouping, `occurrenceCount` is shown exactly as the server sent
// it). Structured `changes[]` renders when present; otherwise the existing legacy `detail` text
// renders unchanged (PART 10/13 - legacy titles/emoji are shown as-is, never reparsed). Actor only
// renders when the orchestrator actually included one (it omits the unresolved-actor sentinel -
// PART 12).
function NoaCatchUpEventRow({ item }: { item: NoaCatchUpTransportItem }) {
  return (
    <li className="relative pl-3">
      <span aria-hidden="true" className="absolute -left-[13px] top-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
      <div className="text-xs font-medium text-zinc-400">{catchUpFormatTimestamp(item.occurredAt)}</div>
      <div className="text-sm font-semibold text-zinc-900">
        {item.title}
        {item.occurrenceCount && item.occurrenceCount > 1 ? (
          <span className="ml-1.5 text-xs font-normal text-zinc-500">×{item.occurrenceCount}</span>
        ) : null}
      </div>
      {item.actorLabel ? <div className="text-xs text-zinc-500">by {item.actorLabel}</div> : null}
      {item.changes?.length ? (
        <div className="mt-1.5 flex flex-col gap-2">
          {item.changes.map((change, index) => (
            <NoaCatchUpChangeRow change={change} key={`${item.occurredAt}-${change.field}-${index}`} />
          ))}
        </div>
      ) : item.detail ? (
        <div className="mt-1 text-xs text-zinc-600">{item.detail}</div>
      ) : null}
    </li>
  );
}

// PART 3/4/14/15/18: the timeline card replaces the long text bubble entirely (never both). Header
// shows the entity identifier once (CO/QN) when transported, or a neutral fallback for global
// Catch-Up (never an inferred time-window label - PART 4/16). Counts are read straight from the
// already-received structured payload, never recomputed ("15 changes" is deliberately never said,
// since one event may carry several field changes - PART 14).
function NoaCatchUpTimeline({ catchUp }: { catchUp: NoaCatchUpTransport }) {
  const groupNoun = catchUp.groupCount === 1 ? "activity group" : "activity groups";
  const eventNoun = catchUp.rawEventCount === 1 ? "recorded event" : "recorded events";
  return (
    <div className="flex w-full max-w-[92%] flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 shadow-sm">
      <div>
        <div className="text-sm font-semibold text-zinc-900">{catchUp.heading ?? "Recent changes"}</div>
        <div className="text-xs text-zinc-500">
          {catchUp.groupCount} {groupNoun} · {catchUp.rawEventCount} {eventNoun}
        </div>
      </div>
      <ol className="flex flex-col gap-3 border-l border-zinc-200 pl-3">
        {catchUp.items.map((item, index) => (
          <NoaCatchUpEventRow item={item} key={`${item.occurredAt}-${item.action}-${index}`} />
        ))}
      </ol>
    </div>
  );
}

// N2C1.1: renders the server's already-computed quotation Analytics data (metrics/status
// breakdown/comparison/trend) as compact cards instead of the long deterministic prose. Every
// value read here comes straight from the transport payload the orchestrator built from the SAME
// capabilityResult.data the prose was generated from - this file never parses `message.text`,
// never recomputes a total/average/difference, never invents a period.

// C1.2 PART 2/3/5: a compact stat tile - value visually stronger (bold, slightly larger) and
// label small/muted/uppercase for a scannable stat-tile feel, tightened padding vs C1.1. The
// empty-confirmed dash ("—") is visually LIGHTER than a real value (muted, not bold) so it
// reads as "nothing recorded" rather than competing with real figures - a pure style branch on
// the already-server-decided string, never a data reinterpretation (a real "0" is never dashed).
// `whitespace-pre-line` still renders a multi-currency value's `\n`-joined lines (PART 6 of C1.1)
// as separate visual lines within the same tile, never merged into one figure.
function NoaAnalyticsMetricCard({ metric }: { metric: NoaAnalyticsMetric }) {
  const isEmptyValue = metric.value === "—";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-2">
      <div className={`whitespace-pre-line leading-tight ${isEmptyValue ? "text-sm font-normal text-zinc-400" : "text-base font-bold text-zinc-900"}`}>
        {metric.value}
      </div>
      <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{metric.label}</div>
    </div>
  );
}

// PART 4: a plain, non-interactive pill - never a button/clickable element, never colored by
// success/failure (this is a factual count, not a status judgement). Slightly tinted neutral fill
// (vs C1.1's plain white) so chips read as a distinct compact group rather than trailing prose.
function NoaAnalyticsStatusChip({ row }: { row: NoaAnalyticsStatusRow }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
      {row.label} {row.count}
    </span>
  );
}

// PART 7: two compact blocks (stacked on narrow width, two columns from `sm:` up via CSS grid -
// never forced side-by-side) plus a small factual delta section with its own muted header, matching
// the Status section's visual language. No evaluative language ("better"/"worse") - only
// "Difference"/currency amounts, exactly as the server computed them.
function NoaAnalyticsComparisonBlock({ comparison }: { comparison: NoaAnalyticsComparison }) {
  const countDiffText = `${comparison.countDifference >= 0 ? "+" : ""}${comparison.countDifference}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[
          { count: comparison.currentCount, label: comparison.currentLabel, pick: "currentValue" as const },
          { count: comparison.previousCount, label: comparison.previousLabel, pick: "previousValue" as const },
        ].map((period) => (
          <div className="rounded-xl border border-zinc-200 bg-white p-2" key={period.label}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{period.label}</div>
            <div className="mt-0.5 text-sm font-bold text-zinc-900">
              {period.count} quotation{period.count === 1 ? "" : "s"}
            </div>
            {comparison.currencyRows.map((row) => (
              <div className="text-xs text-zinc-600" key={row.currency}>
                {row.currency} {row[period.pick].toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Difference</div>
        <div className="text-xs text-zinc-600">
          <div>{`${countDiffText} quotation${Math.abs(comparison.countDifference) === 1 ? "" : "s"}`}</div>
          {comparison.currencyRows.map((row) => (
            <div key={row.currency}>
              {`${row.currency} ${row.difference >= 0 ? "+" : ""}${row.difference.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// PART 8: a compact month row - no chart library, no SVG. A proportional bar was deliberately
// skipped (task's own "if it introduces complexity, skip it").
function NoaAnalyticsTrendRowView({ row }: { row: NoaAnalyticsTrendRow }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{row.label}</div>
      <div className="mt-0.5 text-sm font-bold text-zinc-900">
        {row.count} quotation{row.count === 1 ? "" : "s"}
      </div>
      {row.currency && row.total !== undefined ? (
        <div className="text-xs text-zinc-600">{row.currency} {row.total.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
      ) : null}
    </div>
  );
}

// N2C2.1: a compact numbered ranking list (client/brand/category rankings). Each group is
// rendered independently under its own optional heading (a currency code for value rankings), so
// currencies are never merged into one list. Label wraps (min-w-0 + break-words) and the value
// stays on its own right-aligned slot - no table, no horizontal scroll, mobile-safe. Plain
// non-interactive divs only; rank/label/value are the server's own already-formatted strings.
function NoaAnalyticsRankingList({ group }: { group: NoaAnalyticsRankingGroup }) {
  return (
    <div>
      {group.heading ? (
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{group.heading}</div>
      ) : null}
      <div className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
        {group.rows.map((row) => (
          <div className="flex items-baseline gap-2 px-2 py-1.5 text-sm" key={`${row.rank}-${row.label}`}>
            <span className="w-5 shrink-0 text-xs font-medium text-zinc-400">{row.rank}.</span>
            <span className="min-w-0 flex-1 break-words text-zinc-800">{row.label}</span>
            <span className="shrink-0 text-right font-bold text-zinc-900">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// C1.2 PART 1/5/6: the analytics card replaces the long text bubble entirely (never both).
// Title/period hierarchy strengthened (bolder title, small muted period on its own line) and
// overall vertical rhythm tightened (gap-3->gap-2.5, p-3->p-2.5) versus C1.1, while keeping the
// same max-width/mobile-safe container. An `emptyMessage` still renders as a clean compact state -
// never empty metric boxes full of zeros the server never asserted.
function NoaAnalyticsCards({ analytics }: { analytics: NoaAnalyticsTransport }) {
  return (
    <div className="flex w-full max-w-[92%] flex-col gap-2.5 rounded-2xl border border-zinc-200 bg-zinc-50 p-2.5 shadow-sm">
      <div>
        <div className="text-sm font-bold text-zinc-900">{analytics.title}</div>
        {analytics.period ? <div className="text-xs text-zinc-500">{analytics.period}</div> : null}
      </div>
      {analytics.emptyMessage ? (
        <div className="text-sm text-zinc-600">{analytics.emptyMessage}</div>
      ) : (
        <>
          {analytics.metrics?.length ? (
            // N2C2.1: an odd trailing tile spans both columns instead of leaving an empty cell.
            <div className="grid grid-cols-2 gap-1.5 [&>*:last-child:nth-child(odd)]:col-span-2">
              {analytics.metrics.map((metric) => (
                <NoaAnalyticsMetricCard key={metric.key} metric={metric} />
              ))}
            </div>
          ) : null}
          {analytics.statusBreakdown?.length ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{analytics.statusLabel ?? "Status"}</div>
              <div className="flex flex-wrap gap-1.5">
                {analytics.statusBreakdown.map((row) => (
                  <NoaAnalyticsStatusChip key={row.label} row={row} />
                ))}
              </div>
            </div>
          ) : null}
          {analytics.comparison ? <NoaAnalyticsComparisonBlock comparison={analytics.comparison} /> : null}
          {analytics.trend?.length ? (
            <div className="flex flex-col gap-1.5">
              {analytics.trend.map((row) => (
                <NoaAnalyticsTrendRowView key={row.label} row={row} />
              ))}
            </div>
          ) : null}
          {analytics.rankings?.length ? (
            <div className="flex flex-col gap-2">
              {analytics.rankings.map((group, index) => (
                <NoaAnalyticsRankingList group={group} key={group.heading ?? `ranking-${index}`} />
              ))}
            </div>
          ) : null}
        </>
      )}
      {analytics.note ? <div className="text-[11px] text-zinc-500">{analytics.note}</div> : null}
    </div>
  );
}

// Home UX: a starter is either a PROVEN working request sent verbatim (`prompt`), or a small
// UI-only helper (`draft`) for a request that needs information the starter itself can't supply
// (GPC's "configure <product name>" needs an actual product name). A `draft` starter is never sent
// to the server as-is - NoaAssistant's handleSend recognizes the encoded signal below, shows a
// local guidance message, and prefixes the draft onto the user's NEXT typed message instead.
export type NoaQuickPrompt = { label: string; prompt?: string; draft?: string };

// Exported so NoaAssistant (the only other file that touches this) can recognize it without a
// second, drifting copy of the encoding - never a real chat message on its own.
export const NOA_DRAFT_STARTER_SIGNAL_PREFIX = "__noa-draft-starter__:";

// Max 4 primary starters (PART 8) - each a proven-working request or the one guided helper, never
// the old vague literal strings that routed to Help/fallback. N2A3: "Needs attention" replaces
// the capability-summary starter to make room (still exactly 4, never a growing menu) - it sends
// the exact proven Attention phrase through the SAME onQuickPrompt -> handleSend path as every
// other starter, never a client-side Attention shortcut.
const QUICK_PROMPTS: NoaQuickPrompt[] = [
  { label: "Needs attention", prompt: "what needs my attention" },
  { draft: "configure ", label: "Configure product" },
  { label: "Pending quotations", prompt: "Show pending quotations" },
  { label: "Active projects", prompt: "Show active projects" },
];

export function NoaMessages({
  isBusy = false,
  messages,
  onQuickPrompt,
  voice,
}: {
  isBusy?: boolean;
  messages: NoaMessage[];
  onQuickPrompt: (prompt: string) => void;
  voice?: NoaVoice;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const hasUserMessage = messages.some((message) => message.role === "user");
  // GPC-3.1 PART 5: only the LATEST message's own choices are ever clickable - once the
  // conversation has moved on (a newer message exists, from either side), an older assistant
  // message's choices render as plain, disabled buttons rather than being removed (the user can
  // still see what was offered, they just can't act on a stale question anymore).
  const latestMessageId = messages.at(-1)?.id;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    // PART 2: a touch more vertical rhythm between turns and a touch more bubble padding - purely
    // spacing/sizing, the same message paragraph/choices rendering as before.
    <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
      {messages.map((message) => {
        const speechText = message.voiceText ?? message.text;
        const choicesEnabled = !isBusy && message.id === latestMessageId;
        // PART 1/11/12: structured cards render ONLY when the server actually sent non-empty
        // Attention items - never parsed from `message.text`. An empty/absent `attention` (e.g.
        // the "nothing to report" answer, or every non-Attention domain) falls through to the
        // exact same plain-text bubble as always - the normal path stays the accessibility/
        // fallback path, never a special case to maintain separately.
        const hasAttentionCards = message.role === "assistant" && Boolean(message.attention?.items.length);
        // PART 19/20: same fallback discipline as Attention - an empty/absent/invalid `catchUp`
        // (e.g. the "nothing to report" answer, or every non-Catch-Up answer) falls through to
        // the exact same plain-text bubble as always. Checked only when Attention cards aren't
        // already rendering (PART 20's priority order).
        const hasCatchUpTimeline = !hasAttentionCards && message.role === "assistant" && Boolean(message.catchUp?.items.length);
        // PART 3/12/17: analytics cards render whenever the orchestrator sent a transport at all
        // (unlike Attention/Catch-Up, an empty analytics result is still meaningful structured
        // content - PART 12's own clean empty-state card - never a fallback to prose in that
        // case). An absent `analytics` (every non-quotation-analytics Insights answer, and every
        // other domain) falls through to the exact same plain-text bubble as always.
        const hasAnalyticsCards = !hasAttentionCards && !hasCatchUpTimeline && message.role === "assistant" && Boolean(message.analytics);
        return (
          <div
            key={message.id}
            className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}
          >
            {message.role === "assistant" && message.agentBrief ? (
              <section aria-label={message.agentBrief.title} className="w-full min-w-0 max-w-full space-y-3 rounded-2xl border border-zinc-200 bg-white p-3 text-sm [overflow-wrap:anywhere]">
                <h3 className="font-semibold">{message.agentBrief.title}</h3>
                {message.agentBrief.partial ? <p className="text-xs text-zinc-500">Partial briefing</p> : null}
                <p className="text-xs text-zinc-500">{message.agentBrief.summary}</p>
                {message.agentBrief.sections.map((section, index) => (
                  <section key={index} className="min-w-0 space-y-1">
                    <h4 className="font-medium">{section.heading}</h4>
                    {section.facts.map((fact, factIndex) => <p key={factIndex} className="whitespace-pre-wrap">{fact}</p>)}
                  </section>
                ))}
                {message.agentBrief.omissions.map((note, index) => <p key={index} className="text-xs text-zinc-500">{note}</p>)}
              </section>
            ) : hasAttentionCards && message.attention ? (
              <NoaAttentionCards attention={message.attention} />
            ) : hasCatchUpTimeline && message.catchUp ? (
              <NoaCatchUpTimeline catchUp={message.catchUp} />
            ) : hasAnalyticsCards && message.analytics ? (
              <NoaAnalyticsCards analytics={message.analytics} />
            ) : (
              <p
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-6 shadow-sm ${
                  message.role === "user"
                    ? "bg-emerald-900 text-white"
                    : "bg-zinc-100 text-zinc-900"
                }`}
              >
                {message.text}
              </p>
            )}
            {voice?.speechSupported && message.role === "assistant" && hasSpeechText(speechText) ? (
              <button
                aria-label={voice.speakingId === message.id ? "Stop reading response" : "Read response aloud"}
                aria-pressed={voice.speakingId === message.id}
                className="mt-1 inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100"
                onClick={() => voice.speak(message.id, speechText)}
                type="button"
              >
                {voice.speakingId === message.id ? <Square aria-hidden="true" className="h-4 w-4" /> : <Volume2 aria-hidden="true" className="h-4 w-4" />}
              </button>
            ) : null}
            {/* Source badges only ever render for assistant messages - user messages never carry
                domain/sources metadata in the first place (see NoaMessage in lib/noa/noa-types.ts). */}
            {message.role === "assistant" ? (
              <NoaSourceBadges domain={message.domain} sources={message.sources} />
            ) : null}
            {/* GPC-3.1: real <button type="button"> elements only - keyboard reachable, visible
                text label, never an icon-only or clickable-div choice. Clicking one sends the
                SAME visible value through the existing onQuickPrompt/handleSend path as typed
                text; the server revalidates it exactly like free text (see
                noa-orchestrator.ts's matchProductConfigurationAnswer). */}
            {message.role === "assistant" && message.choices?.length ? (
              <div className="mt-1.5 flex max-w-[85%] flex-col gap-1.5" role="group">
                {message.choices.map((choice, index) => (
                  <button
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-left text-sm font-medium text-zinc-800 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-200 disabled:hover:bg-white"
                    disabled={!choicesEnabled}
                    key={`${message.id}-choice-${index}`}
                    onClick={() => onQuickPrompt(choice.value)}
                    type="button"
                  >
                    <span className="block">{choice.label}</span>
                    {choice.secondary ? (
                      <span className="mt-0.5 block text-xs font-normal text-zinc-500">{choice.secondary}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {!hasUserMessage ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {QUICK_PROMPTS.map((quickPrompt) => (
            <button
              key={quickPrompt.label}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-emerald-300 hover:bg-emerald-50"
              onClick={() => onQuickPrompt(quickPrompt.prompt ?? `${NOA_DRAFT_STARTER_SIGNAL_PREFIX}${quickPrompt.draft ?? ""}`)}
              type="button"
            >
              {quickPrompt.label}
            </button>
          ))}
        </div>
      ) : null}

      <div ref={bottomRef} />
    </div>
  );
}
