type ActionErrorLike = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
  stack?: string | null;
};

type ActionErrorContext = Record<string, unknown>;

function redactSensitiveSegments(value: string) {
  return value
    .replace(/\b(eyJ[A-Za-z0-9._-]+)\b/g, "[redacted-token]")
    .replace(/([?&](?:token|apikey|api_key|service_role|signature|sig|x-amz-signature|x-amz-security-token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]+\b/gi, "$1[redacted]")
    .replace(/https?:\/\/[^\s)]+/gi, (url) => {
      try {
        const parsed = new URL(url);

        for (const key of parsed.searchParams.keys()) {
          if (/(token|apikey|api_key|service_role|signature|sig|x-amz-signature|x-amz-security-token)/i.test(key)) {
            parsed.searchParams.set(key, "[redacted]");
          }
        }

        return parsed.toString();
      } catch {
        return "[redacted-url]";
      }
    });
}

function sanitizeText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? redactSensitiveSegments(trimmed) : null;
}

function sanitizeContextValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeText(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeContextValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeContextValue(entry)]),
    );
  }

  return value;
}

export function extractActionError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as ActionErrorLike;
    return {
      code: sanitizeText(candidate.code) ?? null,
      details: sanitizeText(candidate.details) ?? null,
      hint: sanitizeText(candidate.hint) ?? null,
      message: sanitizeText(candidate.message) ?? null,
      stack: sanitizeText(candidate.stack) ?? null,
    };
  }

  if (typeof error === "string") {
    return {
      code: null,
      details: null,
      hint: null,
      message: sanitizeText(error),
      stack: null,
    };
  }

  return {
    code: null,
    details: null,
    hint: null,
    message: null,
    stack: null,
  };
}

export function formatSafeActionError(
  actionLabel: string,
  error: unknown,
  fallbackMessage = "Unknown server error",
) {
  const extracted = extractActionError(error);
  const message = extracted.message ?? fallbackMessage;
  return `${actionLabel}: ${extracted.code ? `${extracted.code} - ` : ""}${message}`;
}

export function logServerActionError(
  actionLabel: string,
  error: unknown,
  context: ActionErrorContext = {},
) {
  const extracted = extractActionError(error);
  const safeContext = sanitizeContextValue(context) as ActionErrorContext;

  console.error(actionLabel, {
    ...safeContext,
    code: extracted.code,
    message: extracted.message,
    details: extracted.details,
    hint: extracted.hint,
    stack: extracted.stack,
  });
}
