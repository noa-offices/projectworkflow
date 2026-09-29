// Phase 4C: deterministic, conservative normalization for business identifiers (QN quotations,
// CO Project Files) that the existing exact-ID fast path already recognizes in hyphenated form
// (see noa-quotation-capability.server.ts / noa-project-capability.server.ts). This module is
// purely additive: it never changes how an already-hyphenated identifier (any digit grouping,
// e.g. "QN-0001", "QN-100", "QN-0003-001") is matched today - that stays the existing parsers'
// job entirely. It only recognizes NEW separator styles (none/compact, spaces, slashes) for the
// one canonical shape the reported UAT gaps are about ("QN-0003-001": 4 digits, 3 digits), and
// reconstructs those to canonical form. No edit-distance/fuzzy matching, no arbitrary regrouping.

export type NoaBusinessIdentifierPrefix = "QN" | "CO";

// The one canonical digit grouping this module reconstructs. Deliberately not inferred from the
// database (out of scope here) - taken directly from the reported canonical example. Any digit
// count other than this total is rejected rather than guessed (never silently regrouped).
const CANONICAL_DIGIT_GROUP_SIZES = [4, 3] as const;
const CANONICAL_DIGIT_TOTAL = CANONICAL_DIGIT_GROUP_SIZES.reduce((sum, size) => sum + size, 0);

function canonicalNoaBusinessIdentifier(prefix: NoaBusinessIdentifierPrefix, digits: string): string {
  const groups: string[] = [];
  let index = 0;
  for (const size of CANONICAL_DIGIT_GROUP_SIZES) {
    groups.push(digits.slice(index, index + size));
    index += size;
  }
  return `${prefix}-${groups.join("-")}`;
}

// Structural normalization only. Accepts a candidate ALREADY isolated (e.g. one token from a
// message) - compact ("QN0003001"), space-separated ("QN 0003 001"), or slash-separated
// ("QN/0003/001"), case-insensitive prefix. A literal hyphen right after the prefix is
// deliberately rejected here (returns null) - that shape is already the existing hyphenated
// parser's job and this module never re-decides it, so no already-working input can regress and
// no ambiguous grouping (e.g. a wrong/short digit count with its own hyphens) is ever silently
// "corrected" into a different, guessed canonical id.
export function normalizeNoaBusinessIdentifier(prefix: NoaBusinessIdentifierPrefix, raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.slice(0, prefix.length).toUpperCase() !== prefix) return null;
  let rest = trimmed.slice(prefix.length);
  if (rest.startsWith("-")) return null; // existing hyphenated-form parser's job, not ours
  rest = rest.replace(/^[\s/]/, ""); // at most one leading space/slash separator after the prefix
  if (!rest) return null; // bare "QN"/"CO" - invalid
  // Digits only, optionally separated by single spaces/slashes - a letter or any other character
  // anywhere means "not this shape", not "try harder to guess".
  if (!/^\d(?:[\s/]?\d)*$/.test(rest)) return null;
  const digits = rest.replace(/[\s/]/g, "");
  if (digits.length !== CANONICAL_DIGIT_TOTAL) return null;
  return canonicalNoaBusinessIdentifier(prefix, digits);
}

// Finds every NEW-shape candidate (compact/space/slash - never hyphenated, see above) for
// `prefix` in free text and normalizes each one, skipping anything that doesn't reconstruct
// unambiguously. Never fuzzy/edit-distance search; a plain "QN"/"CO"/ordinary number never
// matches (the pattern requires at least one digit immediately - optionally separated by one
// space/slash - right after the prefix).
export function findNoaBusinessIdentifierVariants(prefix: NoaBusinessIdentifierPrefix, message: string): string[] {
  const candidatePattern = new RegExp(`\\b${prefix}[ /]?\\d(?:[ /]?\\d)*\\b`, "gi");
  const canonical: string[] = [];
  for (const match of message.matchAll(candidatePattern)) {
    const normalized = normalizeNoaBusinessIdentifier(prefix, match[0]);
    if (normalized) canonical.push(normalized);
  }
  return canonical;
}
