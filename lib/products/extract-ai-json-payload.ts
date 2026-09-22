/**
 * Narrow, syntax-only defensive extraction of a likely JSON payload from
 * pasted external-LLM output that wraps the actual ProductTemplateDraft JSON
 * in prose, an explanation, a Python example block, "Code output" text, or
 * a fenced code block.
 *
 * This is NOT a general AI-output repair engine: it never converts Python
 * dictionaries to JSON, never repairs quotes/commas/braces, and never
 * chooses an arbitrary `{...}` snippet. It only isolates a likely JSON
 * payload using a small, deterministic priority order.
 */

export type AiJsonPayloadExtractionResult = {
  text: string;
  extracted: boolean;
  source: "original" | "json_fence" | "version_object";
};

/**
 * Scans forward from an opening `{` at `openIndex`, respecting JSON strings
 * and escaped characters, and returns the index of the matching top-level
 * `}` once brace depth returns to zero, or null if the object never closes.
 */
function findBalancedObjectEnd(input: string, openIndex: number): number | null {
  let depth = 0;
  let inString = false;
  let escapedNext = false;
  for (let i = openIndex; i < input.length; i++) {
    const char = input[i];
    if (inString) {
      if (escapedNext) { escapedNext = false; continue; }
      if (char === "\\") { escapedNext = true; continue; }
      if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") { inString = true; continue; }
    if (char === "{") depth++;
    else if (char === "}") { depth--; if (depth === 0) return i; }
  }
  return null;
}

export function extractLikelyAiJsonPayload(input: string): AiJsonPayloadExtractionResult {
  const trimmed = input.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return { text: input, extracted: false, source: "original" };
  }

  // Explicit ```json fenced block only — never ```python, ```javascript, or a generic fence.
  const fenceMatch = /```json([\s\S]*?)```/.exec(input);
  if (fenceMatch) {
    const fenced = fenceMatch[1].trim();
    if (fenced) return { text: fenced, extracted: true, source: "json_fence" };
  }

  // ProductTemplateDraft version-object candidate: requires the JSON-style, double-quoted
  // "version": 1 property (a Python dict's 'version': 1 never matches this pattern).
  const versionMatch = /"version"\s*:\s*1\b/.exec(input);
  if (versionMatch) {
    const openIndex = input.lastIndexOf("{", versionMatch.index);
    if (openIndex !== -1) {
      const endIndex = findBalancedObjectEnd(input, openIndex);
      if (endIndex !== null) {
        return { text: input.slice(openIndex, endIndex + 1), extracted: true, source: "version_object" };
      }
    }
  }

  return { text: input, extracted: false, source: "original" };
}
