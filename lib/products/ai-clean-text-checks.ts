import type { ProductTemplateDraftOptionGroup } from "./product-template-draft";

// Pure checks for the "Clean with AI" helper. Code, not the AI, decides whether a suggestion is safe to show.

const NUMBER = "\\d+(?:\\.\\d+)?";
const WIDTH = new RegExp(`^W:${NUMBER}(?:/${NUMBER})?$`);
const DEPTH = new RegExp(`^D:${NUMBER}$`);
const HEIGHT = new RegExp(`^H:${NUMBER}(?:-${NUMBER})?$`);
const DIAMETER = new RegExp(`^Ø${NUMBER}$`);
const MAX_NAMES = 60;
const MAX_NAME_LENGTH = 80;

/** Every number in the text (decimals with a dot allowed), as strings, in order. */
export function numbersInText(text: string): string[] {
  return text.match(new RegExp(NUMBER, "g")) ?? [];
}

/**
 * Overall size only: "W:<n>[/<n>] D:<n> H:<n>[-<n>] mm" (order W, D, H) or the round form "Ø<n> [H:<n>[-<n>]] mm".
 * Parts may be left out (any non-empty subset in order), the unit "mm" is required, every number must appear in the
 * original, and the candidate may not be longer than the original.
 */
export function isValidShortDimension(original: string, candidate: string): boolean {
  const text = candidate.trim();
  if (!text || text.length > original.trim().length) return false;
  const tokens = text.split(" ");
  if (tokens.some((token) => !token) || tokens[tokens.length - 1] !== "mm") return false;
  const parts = tokens.slice(0, -1);
  const rectangular = parts.length > 0 && (() => {
    const order = [WIDTH, DEPTH, HEIGHT];
    let position = 0;
    return parts.every((part) => {
      const next = order.findIndex((pattern, index) => index >= position && pattern.test(part));
      if (next < 0) return false;
      position = next + 1;
      return true;
    });
  })();
  const round = parts.length >= 1 && parts.length <= 2 && DIAMETER.test(parts[0]) && (parts.length === 1 || HEIGHT.test(parts[1]));
  if (!rectangular && !round) return false;
  const known = new Set(numbersInText(original));
  return numbersInText(text).every((value) => known.has(value));
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Every whole word of the candidate is in the original; the candidate is not empty, not longer, and not the same words in the same order. */
export function isWordSubset(original: string, candidate: string): boolean {
  const candidateWords = words(candidate);
  if (!candidateWords.length || candidate.trim().length > original.trim().length) return false;
  const originalWords = words(original);
  const known = new Set(originalWords);
  if (!candidateWords.every((word) => known.has(word))) return false;
  return candidateWords.length !== originalWords.length || candidateWords.some((word, index) => word !== originalWords[index]);
}

function nameCollector() {
  const seen = new Set<string>();
  const names: string[] = [];
  return {
    add(value: unknown) {
      if (typeof value !== "string" || names.length >= MAX_NAMES) return;
      const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH).trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return;
      seen.add(key);
      names.push(name);
    },
    names: () => names,
  };
}
const codes = (value: unknown) => typeof value === "string" ? value.split(/[,;\n]/) : [];

/** Short names the template already offers as accessories or options: group label, item label / display name, supplier codes. No prices or specifications. */
export function buildAccessoryNameList(optionGroups: readonly ProductTemplateDraftOptionGroup[]): string[] {
  const collector = nameCollector();
  for (const group of optionGroups) {
    if (group.isActive === false) continue;
    collector.add(group.label);
    for (const item of group.items) {
      if (item.isActive === false) continue;
      collector.add(item.label); collector.add(item.displayName);
      item.supplierCodes.forEach((code) => collector.add(code));
    }
  }
  return collector.names();
}

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The same list from the saved accessory_pricing groups (group_name, item_name, display_name, supplier_price_list_code). */
export function accessoryNamesFromSavedAccessoryPricing(accessoryPricing: unknown): string[] {
  const collector = nameCollector();
  if (!Array.isArray(accessoryPricing)) return [];
  for (const group of accessoryPricing) {
    if (!record(group) || group.is_active === false) continue;
    collector.add(group.group_name);
    if (!Array.isArray(group.items)) continue;
    for (const item of group.items) {
      if (!record(item) || item.is_active === false) continue;
      collector.add(item.item_name); collector.add(item.display_name);
      codes(item.supplier_price_list_code).forEach((code) => collector.add(code));
    }
  }
  return collector.names();
}

const SEATING_WORDS = new Set(["chair", "chairs", "armchair", "armchairs", "stool", "stools", "seating", "swivel", "visitor"]);
// Chair parts and other furniture are not seating rows, even inside a chair group.
const NOT_SEATING_WORDS = new Set(["mat", "mats", "castor", "castors", "caster", "casters", "armrest", "armrests", "headrest", "headrests", "desk", "desks", "table", "tables", "screen", "screens", "cabinet", "cabinets"]);

/** True only when a closed seating word is found in the group label, display name or category, and no non-seating word is. Unsure means false. */
export function isSeatingRow(input: { groupLabel?: string | null; displayName?: string | null; category?: string | null }): boolean {
  const tokens = words([input.groupLabel, input.displayName, input.category].filter((value): value is string => typeof value === "string").join(" "));
  return tokens.some((word) => SEATING_WORDS.has(word)) && !tokens.some((word) => NOT_SEATING_WORDS.has(word));
}
