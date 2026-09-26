import type { NoaAnswer, NoaAnalyticsTransport } from "./noa-types";

export const NOA_SPOKEN_RESPONSE_LIMIT = 600;

const CURRENCIES: Record<string, string> = { AED: "UAE dirhams", EUR: "euros", USD: "US dollars" };
const MONTHS: Record<string, string> = { Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June", Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December" };

// Presentation only: keep every amount exact, including signs and decimal precision.
// Only explicit identifier/name pairs may substitute a name; never resolve an entity.
export function normalizeNoaSpeech(text: string): string {
  return text
    .replace(/<\/?[A-Za-z][^>\n]*>/g, " ")
    .replace(/\[([^\]]+)\]\([^\s)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\b(?:CO|QN)-\d+(?:-\d+)+\s+\(([^()\n]+)\)/g, "$1")
    .replace(/\b(?:CO|QN)-\d+(?:-\d+)+\s+[—–]\s+(?=\p{L})/gu, "")
    .replace(/\b(AED|EUR|USD)\s+([+-]?\d[\d,]*(?:\.\d+)?)/g, (_, currency: string, amount: string) => `${amount} ${CURRENCIES[currency]}`)
    .replace(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/g, (_, day: string, month: string, year: string) => `${day} ${MONTHS[month]} ${year}`)
    .replace(/×\s*(\d+)/g, " repeated $1 times")
    .replace(/\s+/g, " ").trim();
}

function meaningful(text: string) { return /[\p{L}\p{N}]/u.test(text); }
function sentence(text: string): string {
  const clean = normalizeNoaSpeech(text);
  return meaningful(clean) ? (/[.!?]$/.test(clean) ? clean : `${clean}.`) : "";
}

function proseUnits(text: string): string[] {
  // Clean each line before splitting complete sentences. Never cut a fact
  // at a character offset (which could drop its qualifier, negation, unit or amount).
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return text.split(/\r?\n/).flatMap((line) => Array.from(segmenter.segment(normalizeNoaSpeech(line)), (part) => sentence(part.segment))).filter(Boolean);
}

function bounded(units: string[], maxSentences = 4, required: string[] = [], prefix = ""): string | null {
  const suffix = required.map(sentence).filter(Boolean).join(" ");
  const selected: string[] = [];
  for (const unit of units) {
    const clean = sentence(unit);
    if (!clean) continue;
    if (selected.length >= maxSentences) break;
    if (prefix.length + [...selected, clean, suffix].filter(Boolean).join(" ").length <= NOA_SPOKEN_RESPONSE_LIMIT) selected.push(clean);
  }
  // A scope note is never dropped to make an otherwise misleading metric fit.
  if (!selected.length) return null;
  const result = [...selected, suffix].filter(Boolean).join(" ");
  return prefix ? `${prefix}${result.charAt(0).toLowerCase()}${result.slice(1)}` : result;
}

function countPhrase(value: string, noun: string, plural = `${noun}s`) {
  return `There ${value === "1" ? `is 1 ${noun}` : `are ${value} ${plural}`}`;
}

const METRICS: Partial<Record<NoaAnalyticsTransport["kind"], Array<[string, (value: string) => string]>>> = {
  quotation_analytics: [["count", (v) => countPhrase(v, "quotation")], ["quoted_value", (v) => `The quoted value is ${v}`]],
  project_file_analytics: [["project_files", (v) => countPhrase(v, "Project File")], ["active_value", (v) => `The active value is ${v}`]],
  client_analytics: [["active_clients", (v) => countPhrase(v, "active client")], ["archived_clients", (v) => countPhrase(v, "archived client")]],
  product_analytics: [["active_products", (v) => countPhrase(v, "active product")], ["archived_products", (v) => countPhrase(v, "archived product")]],
  procurement_analytics: [["active_orders", (v) => countPhrase(v, "active procurement order")], ["missing_eta", (v) => `${v} vendor ${v === "1" ? "group is" : "groups are"} missing ETA information`]],
  payment_analytics: [["received", (v) => `You've received ${v}`], ["outstanding", (v) => `${v} remains outstanding`]],
};

function analyticsSpeech(analytics: NoaAnalyticsTransport): string | null {
  if (!Object.hasOwn(METRICS, analytics.kind)) return null;
  const required = analytics.note ? [analytics.note] : [];
  if (analytics.emptyMessage) return bounded(proseUnits(analytics.emptyMessage), 3, required);
  const units: string[] = [];
  // Preserve the server's period verbatim; it may describe a scope rather than a date.
  const scope = analytics.period ? `For ${normalizeNoaSpeech(analytics.period)}, ` : "";
  if (analytics.kind === "client_analytics" && analytics.rankings?.length) {
    for (const group of analytics.rankings) {
      const names = group.rows.slice(0, 3).map((row) => normalizeNoaSpeech(row.label)).filter(meaningful);
      if (!names.length) continue;
      // Title states the ranking measure; headings keep currency groups separate.
      const currency = group.heading ? ` in ${CURRENCIES[group.heading] ?? normalizeNoaSpeech(group.heading)}` : "";
      const title = normalizeNoaSpeech(analytics.title);
      const measure = title.match(/^Top clients by (.+)$/i)?.[1] ?? (title === "Quotations per client" ? "quotation count" : null);
      units.push(measure
        ? `The leading clients by ${measure}${currency} are ${names.join(", ")}, in that order`
        : `${title}${currency}: ${names.join(", ")}, in that order`);
    }
  } else {
    for (const [key, render] of METRICS[analytics.kind] ?? []) {
      const metric = analytics.metrics?.find((item) => item.key === key);
      if (!metric || !meaningful(metric.value)) continue;
      // Newline-separated currency amounts stay distinct, never summed or converted.
      const value = metric.value.split(/\r?\n/).map(normalizeNoaSpeech).filter(meaningful).join(" and ");
      units.push(render(value));
    }
  }
  return bounded(units, required.length ? 3 : 4, required, scope);
}

/** Only reads existing display transports. No capabilities, metadata, references or queries. */
export function buildNoaSpokenResponse(answer: NoaAnswer): string | null {
  if (answer.agentBrief) {
    // Composition already selected authorized facts. Keep one complete fact from each
    // section; never read omissions, refusal details or the structural summary/headings.
    const facts = answer.agentBrief.sections.flatMap((section) => {
      const first = section.facts.find((fact) => meaningful(fact));
      return first ? [first] : [];
    });
    const result = bounded(facts, 3);
    // An empty brief must not fall back to prose containing omission/refusal details.
    return result;
  }
  if (answer.attention?.items.length) {
    const { count, items } = answer.attention;
    // Only known transport enums imply an issue. Unknown kinds never become spoken keys.
    const issues = new Map([
      ["procurement_missing_eta", { domain: "Procurement", label: "missing ETA", predicate: "is missing an ETA" }],
      ["procurement_missing_etd", { domain: "Procurement", label: "missing ETD", predicate: "is missing an ETD" }],
      ["payment_overdue", { domain: "ClientPayment", label: "overdue payment", predicate: "has an overdue payment" }],
      ["price_needs_check", { domain: "Price", label: "price needing a check", predicate: "has a price needing a check" }],
      ["price_due", { domain: "Price", label: "price marked due", predicate: "has a price marked due" }],
    ]);
    const safeLabel = (value: string) => {
      // Display fields should already be safe; reject accidental internal tokens rather
      // than removing them and potentially changing the remaining label's meaning.
      if (/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|\b(?:vendor_key|project_id|quotation_id|internal_key|metadata)\b/i.test(value)) return "";
      const clean = normalizeNoaSpeech(value);
      return meaningful(clean) && clean.length <= 160 ? clean : "";
    };
    const projected = items.map((item) => {
      const candidate = issues.get(item.kind);
      const issue = candidate?.domain === item.sourceDomain ? candidate : undefined;
      const projectId = item.sourceDomain === "Procurement" && /^CO-\d+(?:-\d+)+$/.test(item.entityIdentifier ?? "") ? item.entityIdentifier! : "";
      // Same documented prefix as the visual transport; never parse arbitrary prose.
      const prefix = projectId ? `${projectId} · ` : "";
      const project = prefix && item.detail.startsWith(prefix) ? safeLabel(item.detail.slice(prefix.length)) : "";
      const label = safeLabel(item.entityLabel);
      const subject = project ? (label ? `${label} on ${project}` : `An item on ${project}`)
        : label || (count === 1 ? safeLabel(item.entityIdentifier ?? "") : "");
      return { item, issue, projectId, subject };
    });
    const procurement = projected.filter(({ item }) => item.sourceDomain === "Procurement");
    const projectCount = procurement.length && procurement.every(({ projectId }) => projectId)
      ? new Set(procurement.map(({ projectId }) => projectId)).size : 0;
    const projectScope = projectCount
      ? `${procurement.length === items.length && count === items.length ? " across" : ", with listed procurement issues across"} ${projectCount} ${projectCount === 1 ? "project" : "projects"}` : "";
    const units = [`You have ${count} ${count === 1 ? "item" : "items"} needing attention${projectScope}`];
    if (count > 1) {
      const groups = new Map<string, { label: string; count: number }>();
      for (const { item, issue } of projected) {
        if (!issue) continue;
        const group = groups.get(item.kind) ?? { label: issue.label, count: 0 };
        group.count++;
        groups.set(item.kind, group);
      }
      // Stable frequency ordering is presentation, not priority; counts describe listed rows.
      const top = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 2);
      if (top.length) units.push(`Listed issues include ${top.map((group) => `${group.count} ${group.count === 1 ? "item" : "items"} with ${group.label}`).join(" and ")}`);
    }
    const representative = projected.find(({ issue, subject }) => issue && subject && (count === 1 || !/\b(?:CO|QN)-\d/.test(subject)));
    if (representative) units.push(`${representative.subject} ${representative.issue!.predicate}`);
    else if (count === 1) {
      const first = projected[0];
      const title = safeLabel(first.item.title);
      if (title) units.push(first.subject ? `${first.subject}: ${title}` : title);
    }
    if (units.length === 1) units.push("You can review the individual items on screen");
    return bounded(units, 3);
  }
  if (answer.catchUp?.items.length) {
    const { rawEventCount, items } = answer.catchUp;
    // rawEventCount is authoritative: grouped rows/occurrenceCount are not re-counted.
    // Say "listed" rather than infer a date window or chronological ordering.
    const units = [`There ${rawEventCount === 1 ? "is 1 recorded change" : `are ${rawEventCount} recorded changes`} in this result`];
    const titles = items.slice(0, 2).map((item) => normalizeNoaSpeech(item.title));
    units.push(`The ${items.length === 1 ? "change is" : "first listed change is"} ${titles[0]}`);
    if (titles[1]) units.push(`Another listed change is ${titles[1]}`);
    return bounded(units) ?? bounded(proseUnits(answer.text), 3);
  }
  if (answer.analytics) {
    const result = analyticsSpeech(answer.analytics);
    if (result) return result;
    // Fallback prose must retain the same qualification as a structured projection.
    return bounded(proseUnits(answer.text), 3, answer.analytics.note ? [answer.analytics.note] : []);
  }
  return bounded(proseUnits(answer.text), 3);
}

export function withNoaSpokenResponse(answer: NoaAnswer): NoaAnswer {
  const voiceText = buildNoaSpokenResponse(answer);
  // An explicit empty projection suppresses unsafe/unusable speech. An absent field
  // belongs to legacy/local answers and still permits the V1 text fallback.
  return { ...answer, voiceText: voiceText ?? "" };
}
