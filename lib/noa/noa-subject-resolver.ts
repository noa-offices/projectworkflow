// C1: pure deterministic refinement of an extractor-proposed subject/period against the raw
// message text. PURE CODE ONLY - no database client, no permission-gate helper of any kind, no
// provider call. This module never authorizes anything; it only decides WHICH subject/period a
// message is most likely about, so a later phase can apply the real permission gate to whatever
// this resolves to.
//
// Critical precedence (explicit per C1 spec): an explicit self-pronoun in the message must never
// be silently replaced by a stray extracted name, and an explicit named-user actually present in
// the message must never be silently collapsed into self just because a self-pronoun also
// appears elsewhere in the same sentence (e.g. "can I check Yahya's activity" is about Yahya, not
// the asker, even though it also contains "I").

import type { NoaSemanticPeriod, NoaSemanticSubject } from "./noa-semantic-request";

const SELF_PATTERN = /\b(i|me|my|mine)\b/i;
// "who"/"anyone" are included alongside the literal team/everyone/users words because a bare
// "who is online"/"who is active now" question is inherently a plural/other-people question even
// without saying "team" - and misreading it as team-scoped self is safer here anyway (a later
// phase's own permission gate only broadens access for a genuine team/named-user subject, so
// under-detecting "team" just means a narrower, self-only answer - never the reverse).
const TEAM_PATTERN = /\b(team|everyone|users|who|anyone)\b/i;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function messageNamesTheExtractedUser(message: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  return new RegExp(`\\b${escapeForRegExp(trimmed)}\\b`, "i").test(message);
}

// Refines the extractor's proposed subject (if any) against the raw message text. The extractor
// is treated as a hint, not a source of truth: a named_user proposal is only trusted when that
// name is actually a word in the message (guards against a hallucinated name), and an explicit
// self/team signal in the text always wins over an untrusted or absent extractor proposal.
export function resolveNoaSemanticSubject(
  message: string,
  extracted?: NoaSemanticSubject,
): NoaSemanticSubject | undefined {
  const namedUser = extracted?.type === "named_user" && messageNamesTheExtractedUser(message, extracted.name)
    ? extracted
    : null;

  // An explicit, message-verified named user wins even over an incidental self-pronoun elsewhere
  // in the same sentence ("can I check Yahya's activity" -> Yahya, not self).
  if (namedUser) {
    return namedUser;
  }

  if (SELF_PATTERN.test(message)) {
    return { type: "self" };
  }

  if (TEAM_PATTERN.test(message)) {
    return { type: "team" };
  }

  // Neither a verified named user nor a deterministic self/team signal was found in the text -
  // fall back to whatever the extractor proposed (which may itself be undefined).
  return extracted;
}

const PERIOD_PATTERNS: ReadonlyArray<readonly [RegExp, NoaSemanticPeriod]> = [
  [/\byesterday\b/i, "yesterday"],
  [/\bthis week\b/i, "this_week"],
  [/\blast 7 days?\b/i, "last_7_days"],
  [/\bthis month\b/i, "this_month"],
  [/\btoday\b/i, "today"],
];

// Normalizes only the five period values C1 needs - no locale/date-boundary math here (that
// stays owned by the existing capability/date-range helpers in a later phase). A deterministic
// period word in the message always wins over the extractor's proposal, same "text is the source
// of truth, extractor is a hint" principle as the subject resolver above.
export function resolveNoaSemanticPeriod(
  message: string,
  extracted?: NoaSemanticPeriod,
): NoaSemanticPeriod | undefined {
  for (const [pattern, period] of PERIOD_PATTERNS) {
    if (pattern.test(message)) return period;
  }
  return extracted;
}
