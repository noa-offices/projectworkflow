import type { FinalSpecificationMode, FinalSpecificationRequest } from "./final-specification-ai-contract";

// Pure checks around the Final Specification AI. Code, not the AI, decides whether a suggestion may be used.
const DIMENSION_LINE = /^\s*dimension\s*:/i;
export const finalSpecificationMode = (request: Pick<FinalSpecificationRequest, "mode">): FinalSpecificationMode => request.mode ?? "improve";

/** After "Use suggestion": the original "Dimension: ..." line is added back as the last line, unchanged. No Dimension line in the original means nothing is added. */
export function keepDimensionLine(originalText: string | null, suggestion: string): string {
  const line = (originalText ?? "").split("\n").find((entry) => DIMENSION_LINE.test(entry));
  return line ? `${suggestion.trimEnd()}\n${line.trim()}` : suggestion;
}

const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole words only: "Era" does not match inside "general". Both sides are normalized (case, punctuation).
function hasWords(text: string, term: string, plural = false): boolean {
  const needle = normalize(term);
  return Boolean(needle) && new RegExp(`(?<![\\p{L}\\p{N}])${escape(needle)}${plural ? "(?:s|es)?" : ""}(?![\\p{L}\\p{N}])`, "u").test(normalize(text));
}
// An accessory whose label is only colour, finish or generic part words (for example "Black Plastic Parts") is a colour choice,
// not a feature, so the AI may leave it out. Any other word (castors, armrests, column ...) makes it a required feature.
const COLOUR_OR_FINISH_WORDS = new Set([
  "black", "white", "grey", "gray", "silver", "beige", "brown", "blue", "green", "red", "anthracite", "chrome", "cream", "ivory", "yellow", "orange", "pink", "purple", "gold", "bronze", "charcoal",
  "matt", "matte", "gloss", "glossy", "polished", "powder", "coated", "painted", "finish", "colour", "color",
  "parts", "part", "trim", "trims", "frame", "base", "details", "plastic", "and",
]);
export function isColourOrFinishOnly(label: string): boolean {
  const words = normalize(label).split(" ").filter(Boolean);
  return words.length > 0 && words.every((word) => COLOUR_OR_FINISH_WORDS.has(word));
}
// Numbers such as 65, 5 or 2D in the current text (not the Dimension line) must stay in the suggestion. Digits inside codes (ER01) are not counted.
const NUMBER_TOKEN = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?:D(?![\p{L}\p{N}]))?/giu;
const numberTokens = (text: string) => text.match(NUMBER_TOKEN) ?? [];
const mainWord = (label: string) => normalize(label).split(" ").filter((word) => word.length >= 3).sort((a, b) => b.length - a.length)[0] ?? normalize(label);
const stem = (word: string) => word.replace(/s$/, "");

// Hard reject: the suggestion is hidden and the current text is kept. Everything else is a warning: the suggestion is still shown.
export type FinalSpecificationCheck = { ok: true; text: string; warnings: string[] } | { ok: false; message: string };
export function checkFinalSpecificationSuggestion({ accessoryLabels, brand, current, finishTerms, mode, origin, suggestion }: {
  accessoryLabels: readonly string[];
  brand?: string | null;
  current: string | null;
  finishTerms: readonly string[];
  mode: FinalSpecificationMode;
  origin?: string | null;
  suggestion: string;
}): FinalSpecificationCheck {
  const reject = (message: string): FinalSpecificationCheck => ({ ok: false, message: `${message} The current text was kept.` });
  // A Dimension line in the answer is removed here (it is added back separately); the rest is checked.
  const text = suggestion.split("\n").filter((line) => !DIMENSION_LINE.test(line)).join("\n").trim();
  if (!text) return reject("The suggestion was empty.");
  if ([brand, origin].some((term) => term && hasWords(text, term))) return reject("The suggestion names the brand or country.");
  if (finishTerms.some((term) => term && hasWords(text, term))) return reject("The suggestion names a finish.");

  const warnings: string[] = [];
  if (mode === "shorten" && text.length >= (current ?? "").trim().length) warnings.push("Check: the suggestion is not shorter than the current text.");
  const kept = new Set(numberTokens(text).map((token) => token.toLowerCase()));
  const lostNumbers = [...new Set(numberTokens((current ?? "").split("\n").filter((line) => !DIMENSION_LINE.test(line)).join("\n")))].filter((token) => !kept.has(token.toLowerCase()));
  if (lostNumbers.length) warnings.push(`Check: the number ${lostNumbers.join(", ")} from the current text is missing.`);
  // The main word of every real feature accessory should appear (colour-only labels are skipped).
  const missing = accessoryLabels.filter((label) => !isColourOrFinishOnly(label) && !hasWords(text, stem(mainWord(label)), true));
  if (missing.length) warnings.push(`Check: a selected accessory may be missing: ${missing.join(", ")}.`);
  return { ok: true, text, warnings };
}
