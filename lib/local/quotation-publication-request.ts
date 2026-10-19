import type { PublicationAttempt } from "./quotation-publication";

export type PublicationResponse =
  | { ok: true; version: string; savedAt: string; mutationId: string }
  | { ok: false; state: "conflict" | "uncertain" | "error"; error: string };

// Lightweight preflight / Keep My Version baseline. It is a hint, never a lock: the RPC re-checks atomically.
export async function fetchServerVersion(
  quotationId: string,
  send: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(15000),
): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const unreachable = "Could not check the latest quotation version. Your local draft is kept - check your connection and try again.";
  let response: Response;
  try {
    response = await send(`/api/quotations/${quotationId}/local-workspace`, { method: "GET", cache: "no-store", signal });
  } catch {
    throw new Error(unreachable);
  }
  const result = await response.json().catch(() => null);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!response.ok || !result?.ok || !uuid.test(result.version ?? "")) {
    if (response.status >= 500 || !result) throw new Error(unreachable);
    return { ok: false, error: result?.error ?? unreachable };
  }
  return { ok: true, version: result.version };
}

// A missing/invalid acknowledgement is uncertain; the caller retains the attempt.
export async function requestPublication(
  quotationId: string,
  attempt: PublicationAttempt,
  send: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(60000),
): Promise<PublicationResponse> {
  const response = await send(`/api/quotations/${quotationId}/local-workspace`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: attempt.snapshot, baseVersion: attempt.baseVersion, mutationId: attempt.mutationId }),
    signal,
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    return {
      ok: false,
      state: result?.code === "CONFLICT" ? "conflict" : response.status >= 500 ? "uncertain" : "error",
      error: result?.error ?? "Publication could not be confirmed. Retry the same save.",
    };
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(result.version ?? "") || typeof result.savedAt !== "string" ||
      !Number.isFinite(Date.parse(result.savedAt)) || result.mutationId !== attempt.mutationId) {
    throw new Error("Publication acknowledgement was incomplete.");
  }
  return result;
}
