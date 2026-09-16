/**
 * Deterministic, syntax-only repair for pasted AI JSON. This never changes
 * commercial meaning: it only fixes formatting an external LLM sometimes
 * produces (Markdown fences, a stray leading BOM, invalid "\_" Markdown-style
 * escapes, trailing commas, and unescaped quotes nested inside a string
 * value). It is invoked only after a strict JSON.parse has already failed.
 */

export const SYNTAX_REPAIR_KINDS = [
  "byte_order_mark",
  "markdown_fence",
  "invalid_underscore_escape",
  "trailing_comma",
  "unescaped_quote",
] as const;
export type SyntaxRepairKind = typeof SYNTAX_REPAIR_KINDS[number];

export type SyntaxRepairResult = {
  text: string;
  applied: SyntaxRepairKind[];
};

function stripByteOrderMark(text: string): { text: string; changed: boolean } {
  if (text.charCodeAt(0) === 0xfeff) return { text: text.slice(1), changed: true };
  return { text, changed: false };
}

function stripMarkdownFence(text: string): { text: string; changed: boolean } {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (match) return { text: match[1].trim(), changed: true };
  return { text, changed: false };
}

function fixUnderscoreEscapes(text: string): { text: string; changed: boolean } {
  // A literal backslash never precedes an underscore in valid JSON (outside or
  // inside a string); "\_" is a Markdown-escape artifact, never intentional data.
  if (!text.includes("\\_")) return { text, changed: false };
  return { text: text.replace(/\\_/g, "_"), changed: true };
}

/**
 * Single pass that tracks JSON string context so trailing-comma removal and
 * unescaped-quote escaping only ever touch structural syntax or genuinely
 * unescaped characters inside a string value - never a string's own content
 * that happens to contain a comma or an already-escaped quote.
 */
function repairStructuralSyntax(text: string): { text: string; trailingCommaFixed: boolean; unescapedQuoteFixed: boolean } {
  let result = "";
  let inString = false;
  let trailingCommaFixed = false;
  let unescapedQuoteFixed = false;
  const n = text.length;
  let i = 0;

  while (i < n) {
    const ch = text[i];

    if (inString) {
      if (ch === "\\") {
        result += ch;
        if (i + 1 < n) { result += text[i + 1]; i += 2; } else { i += 1; }
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < n && /\s/.test(text[j])) j++;
        const next = text[j];
        const genuineClose = next === undefined || next === "," || next === "}" || next === "]" || next === ":";
        if (genuineClose) {
          inString = false;
          result += ch;
          i += 1;
          continue;
        }
        result += '\\"';
        unescapedQuoteFixed = true;
        i += 1;
        continue;
      }
      result += ch;
      i += 1;
      continue;
    }

    if (ch === '"') { inString = true; result += ch; i += 1; continue; }
    if (ch === ",") {
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") {
        trailingCommaFixed = true;
        i += 1;
        continue;
      }
      result += ch;
      i += 1;
      continue;
    }
    result += ch;
    i += 1;
  }

  return { text: result, trailingCommaFixed, unescapedQuoteFixed };
}

export function repairJsonSyntax(rawText: string): SyntaxRepairResult {
  const applied: SyntaxRepairKind[] = [];
  let text = rawText;

  const bom = stripByteOrderMark(text);
  text = bom.text;
  if (bom.changed) applied.push("byte_order_mark");

  const fence = stripMarkdownFence(text);
  text = fence.text;
  if (fence.changed) applied.push("markdown_fence");

  const underscore = fixUnderscoreEscapes(text);
  text = underscore.text;
  if (underscore.changed) applied.push("invalid_underscore_escape");

  const structural = repairStructuralSyntax(text);
  text = structural.text;
  if (structural.trailingCommaFixed) applied.push("trailing_comma");
  if (structural.unescapedQuoteFixed) applied.push("unescaped_quote");

  return { text, applied };
}

export const SYNTAX_REPAIR_LABELS: Record<SyntaxRepairKind, string> = {
  byte_order_mark: "removed a leading byte-order mark",
  markdown_fence: "removed a Markdown code fence",
  invalid_underscore_escape: "fixed invalid \\_ escapes",
  trailing_comma: "removed trailing commas",
  unescaped_quote: "escaped an unescaped quote inside a text value",
};
