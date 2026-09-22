/**
 * Narrow, syntax-only defensive repair for pasted Smart Product Setup AI JSON
 * that is otherwise commercially usable but fails strict JSON.parse because
 * manufacturer text contains a literal, unescaped double quote (inch marks,
 * quoted product/model names) inside a JSON string.
 *
 * This is NOT a general JSON repairer: it never touches braces, brackets,
 * commas, numbers, property names, or any already-valid JSON. It only ever
 * inserts a backslash before a double quote it determines, via a
 * deterministic single-pass scan, is very likely embedded string content
 * rather than a legitimate JSON string boundary.
 */

export type AiJsonQuoteRepairResult = {
  text: string;
  repaired: boolean;
  repairCount: number;
};

const MAX_REPAIRS = 100;
const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

function isDigit(char: string) {
  return char >= "0" && char <= "9";
}

/** First non-whitespace character at or after `fromIndex`, or null when only whitespace/nothing remains. */
function nextSignificant(input: string, fromIndex: number): { char: string; index: number } | null {
  let i = fromIndex;
  while (i < input.length && WHITESPACE.has(input[i])) i++;
  return i < input.length ? { char: input[i], index: i } : null;
}

/**
 * A quote immediately following a comma is a legitimate JSON string boundary
 * when the container is an object and the token after the comma is a plausible
 * next key/closing brace, or when the container is an array and the token
 * after the comma is a plausible next array-value starter.
 */
function commaBoundaryIsLegitimate(input: string, commaIndex: number, container: "object" | "array" | undefined) {
  if (!container) return false;
  const afterComma = nextSignificant(input, commaIndex + 1);
  if (!afterComma) return false;
  if (container === "object") return afterComma.char === "\"" || afterComma.char === "}";
  return (
    afterComma.char === "\"" || afterComma.char === "{" || afterComma.char === "[" || afterComma.char === "]" ||
    afterComma.char === "-" || afterComma.char === "t" || afterComma.char === "f" || afterComma.char === "n" ||
    isDigit(afterComma.char)
  );
}

export function repairLikelyUnescapedJsonQuotes(input: string): AiJsonQuoteRepairResult {
  const out: string[] = [];
  let inString = false;
  let escapedNext = false;
  const containerStack: Array<"object" | "array"> = [];
  let repairCount = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (!inString) {
      out.push(char);
      if (char === "\"") { inString = true; escapedNext = false; }
      else if (char === "{") containerStack.push("object");
      else if (char === "[") containerStack.push("array");
      else if (char === "}" || char === "]") containerStack.pop();
      continue;
    }

    if (escapedNext) {
      // Already-escaped character (for example \" or \\): copy verbatim, never evaluated.
      out.push(char);
      escapedNext = false;
      continue;
    }

    if (char === "\\") {
      out.push(char);
      escapedNext = true;
      continue;
    }

    if (char !== "\"") {
      out.push(char);
      continue;
    }

    // Unescaped quote while inside a string: decide legitimate boundary vs embedded content.
    const container = containerStack[containerStack.length - 1];
    const after = nextSignificant(input, i + 1);
    const legitimate = !after
      || after.char === ":" || after.char === "}" || after.char === "]"
      || (after.char === "," && commaBoundaryIsLegitimate(input, after.index, container));

    if (legitimate) {
      out.push(char);
      inString = false;
      continue;
    }

    if (repairCount + 1 > MAX_REPAIRS) return { text: input, repaired: false, repairCount: 0 };
    out.push("\\", char);
    repairCount++;
  }

  return repairCount > 0
    ? { text: out.join(""), repaired: true, repairCount }
    : { text: input, repaired: false, repairCount: 0 };
}
