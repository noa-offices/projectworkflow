// I7.1: pure Gemini wire-schema translation, split out from gemini.server.ts (which has
// `import "server-only"` and therefore can't be executed by a plain Node/tsx test - see
// lib/ai/provider-infrastructure.test.mts's own comment on this repo-wide constraint) so this
// logic can be unit-tested directly. No "server-only", no network, no Supabase/auth import - pure
// data transformation only.
//
// Gemini's `generationConfig.responseSchema` is NOT full JSON Schema - it's a restricted
// OpenAPI-3.0-style Schema proto. Verified live against the current API (2026-09-26), not from
// memory or docs (which disagree with the real endpoint here):
//   - a `type` array such as ["string","null"] is REJECTED: "proto field type is not repeating,
//     cannot start list". The real nullable mechanism is a single `type` plus a separate
//     `nullable: true` boolean (confirmed working).
//   - `additionalProperties` is REJECTED outright: "Unknown name additionalProperties". It must be
//     omitted from the wire schema entirely. This only weakens Gemini's OWN wire-level rejection of
//     an unexpected key - isNoaSemanticRequestV2() (called by every caller after the adapter
//     returns) still enforces the full closed shape, so application-level strictness is unchanged.
//   - a genuinely mixed-type enum has no equivalent - a Gemini enum's values must all share the
//     property's single `type`. The shared V2 schema has exactly one such field: `ordinal`
//     (integers 1-10, the string "last", or null). That field alone is wired as a nullable STRING
//     enum ("1".."10","last") and converted back to a number/"last"/null by
//     normalizeGeminiSemanticResponse() below before the shared validator ever sees it - a wire-
//     format conversion only, never a change to the value space or to NOA semantics.
//
// Deliberately NOT a general JSON-Schema-to-Gemini compiler (I7.1 PART 2): it assumes the exact
// flat, one-level shape NOA_SEMANTIC_REQUEST_V2_SCHEMA actually has (verified flat - no nested
// object/array properties - by lib/noa/noa-semantic-v2.test.mts's own test 30) and fails closed
// (throws) for anything outside that proven shape, rather than silently reinterpreting an
// unfamiliar schema construct.

export class GeminiSchemaTranslationError extends Error {}

const ORDINAL_PROPERTY = "ordinal";
const ORDINAL_WIRE_VALUES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "last"] as const;

type JsonSchemaProperty = {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  [key: string]: unknown;
};
type JsonSchemaObject = {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
  additionalProperties?: unknown;
  [key: string]: unknown;
};
// translateSchemaForGemini() always populates `properties` (it throws first otherwise) - a
// dedicated return type says so, rather than every caller having to null-check a field that can't
// actually be absent.
type GeminiWireSchema = JsonSchemaObject & { properties: Record<string, JsonSchemaProperty> };

function translateNullableType(type: string | readonly string[] | undefined, propertyName: string): { type: string; nullable: boolean } {
  if (typeof type === "string") return { type, nullable: false };
  if (!Array.isArray(type)) throw new GeminiSchemaTranslationError(`Gemini schema translation: unsupported type for "${propertyName}".`);
  const nonNull = type.filter((entry) => entry !== "null");
  if (type.length === nonNull.length || nonNull.length !== 1) {
    throw new GeminiSchemaTranslationError(`Gemini schema translation: unsupported multi-type union for "${propertyName}".`);
  }
  return { type: nonNull[0], nullable: true };
}

// The ONE explicit, documented special case (I7.1 PART 5/6) - a narrow provider-wire
// normalization, not a general rule. Every other property translates through the generic
// nullable-type handling above unchanged.
function translateProperty(name: string, property: JsonSchemaProperty): JsonSchemaProperty {
  if (name === ORDINAL_PROPERTY) {
    return { type: "string", enum: ORDINAL_WIRE_VALUES, nullable: true };
  }
  const { type, nullable } = translateNullableType(property.type, name);
  const translated: JsonSchemaProperty = { ...property, type };
  if (nullable) translated.nullable = true;
  if (Array.isArray(property.enum)) {
    if (type === "string") {
      // Strip the `null` sentinel some enum arrays include for the type-array form - the
      // `nullable: true` flag above already expresses absence; Gemini's enum must not also list it.
      translated.enum = property.enum.filter((value) => value !== null);
    } else {
      // Gemini's `enum` field is proto-typed as repeated STRING regardless of the property's own
      // `type` (verified live: an integer-typed enum, e.g. version:{type:"integer",enum:[2]}, is
      // rejected - "Invalid value at '...enum[0]' (TYPE_STRING), 2"). Rather than lossily stringify
      // a non-string enum's values (which would need its own reverse-normalization, expanding the
      // one documented ordinal special case into a general rule), drop the enum constraint on the
      // wire and, for the one shared field this affects (`version`, a single-literal enum: [2]),
      // carry the SAME constraint as a `description` hint instead - verified live to reliably
      // reproduce the literal value (3/3 live calls). This is presentation, not a meaning change:
      // the shared post-response validator (isNoaSemanticRequestV2 -> the exact
      // NOA_SEMANTIC_REQUEST_V2_VERSION check) still enforces the precise value regardless, per I7.1
      // PART 3's explicit allowance ("Gemini wire validation may be weaker than OpenAI's wire
      // validation, but application validation remains strict") - the description hint only makes
      // that weaker wire path practically usable instead of failing shut on every single call.
      delete translated.enum;
      if (property.enum.length === 1) {
        const literal = property.enum[0];
        translated.description = `${typeof property.description === "string" ? `${property.description} ` : ""}This field's value must always be exactly ${JSON.stringify(literal)}.`;
      }
    }
  }
  return translated;
}

// Fails closed (I7.1 PART 9) on anything this flat, one-level translator wasn't built for -
// nested objects/arrays, a schema with no `properties`, or a multi-type union this module doesn't
// recognize - rather than silently dropping or reinterpreting it.
export function translateSchemaForGemini(schema: object): GeminiWireSchema {
  const source = schema as JsonSchemaObject;
  if (source.type !== "object" || !source.properties) {
    throw new GeminiSchemaTranslationError("Gemini schema translation: unsupported root schema shape.");
  }
  const properties: Record<string, JsonSchemaProperty> = {};
  for (const [name, property] of Object.entries(source.properties)) {
    if (property.type === "object" || property.type === "array") {
      throw new GeminiSchemaTranslationError(`Gemini schema translation: nested "${property.type}" properties are not supported ("${name}").`);
    }
    properties[name] = translateProperty(name, property);
  }
  // `additionalProperties` is deliberately omitted, never translated (I7.1 PART 3) - Gemini
  // rejects the keyword outright. `required` passes through unchanged; Gemini supports it.
  return { type: "object", properties, required: source.required };
}

// The inverse of the ordinal wire translation above - converts Gemini's nullable string enum back
// into the exact value shape isNoaSemanticRequestV2()/NoaSemanticOrdinalV2 already expects
// (1-10 | "last" | null), so the shared validator sees an ordinary, unmodified NOA value. Any
// value outside the wired enum (which shouldn't occur, since Gemini's own enum constrains it) is
// passed through unchanged and left to fail the shared validator normally - never coerced here.
function normalizeGeminiSemanticOrdinal(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value === "last") return "last";
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 10 && String(numeric) === value ? numeric : value;
}

// Reverses every wire-only translation this module applied, so the object handed back to the
// caller is an ordinary parsed NOA semantic object - `nullable`/enum-stripping only affected the
// OUTGOING schema, never the model's actual JSON response, so only `ordinal` needs normalizing.
export function normalizeGeminiSemanticResponse(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const record = parsed as Record<string, unknown>;
  if (!(ORDINAL_PROPERTY in record)) return parsed;
  return { ...record, [ORDINAL_PROPERTY]: normalizeGeminiSemanticOrdinal(record[ORDINAL_PROPERTY]) };
}
