import { createClient } from "@/lib/supabase/server";

// gpt-live-transcribe requires client-side VAD + explicit commits. Keep the supported
// server-VAD model until the client turn protocol is deliberately migrated with it.
const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

function safeErrorField(value: unknown, secrets: string[]): string | null {
  if (typeof value !== "string") return null;
  let text = value;
  for (const secret of secrets) if (secret) text = text.split(secret).join("[REDACTED]");
  return text
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-|ek_)[\w.*-]+/gi, "[REDACTED]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 500);
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_NOA_REALTIME_VOICE !== "true") return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const key = process.env.OPENAI_API_KEY?.trim() || process.env.SOURCE_QA_AI_API_KEY?.trim();
  if (!key) return Response.json({ error: "Realtime voice isn't available right now." }, { status: 503 });
  let upstreamStatus: number | null = null;
  let failureLogged = false;
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 60 },
        session: {
          type: "transcription",
          audio: { input: {
            noise_reduction: { type: "near_field" },
            transcription: { model: TRANSCRIPTION_MODEL, prompt: "This is ProjectWorkflow. The assistant's name is NOA, spelled N-O-A. When addressing the assistant as NOA or Hey NOA, transcribe the name as NOA, not Noah. Preserve Noah when referring to a person. Vocabulary: NOA, ProjectWorkflow, LAS, LAS MOBILI, Interstuhl, EXQUITECH, ETA, ETD, RFQ, Quotation, Project File." },
            turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 800 },
          } },
        },
      }),
    });
    upstreamStatus = response.status;
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const error = body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
        ? body.error as Record<string, unknown> : {};
      const secrets = [key, process.env.OPENAI_API_KEY?.trim() ?? "", process.env.SOURCE_QA_AI_API_KEY?.trim() ?? ""];
      // Never log response/request objects, headers, credentials, or non-error payload fields.
      console.error({ upstreamStatus, model: TRANSCRIPTION_MODEL,
        code: safeErrorField(error.code, secrets), type: safeErrorField(error.type, secrets), message: safeErrorField(error.message, secrets) });
      failureLogged = true;
      throw new Error("Session unavailable");
    }
    const body = await response.json() as { value?: string; expires_at?: number };
    if (!body.value?.startsWith("ek_") || typeof body.expires_at !== "number") throw new Error("Invalid session");
    return Response.json({ value: body.value, expires_at: body.expires_at }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    if (!failureLogged) {
      // Fixed local failure categories distinguish timeouts/network/schema errors without
      // logging exception text (which can contain credentials or upstream response data).
      const name = error instanceof Error ? error.name : "";
      console.error({ upstreamStatus, model: TRANSCRIPTION_MODEL, type: "local_session_error",
        code: upstreamStatus !== null ? "invalid_session_response" : name === "TimeoutError" ? "session_timeout" : name === "AbortError" ? "session_aborted" : "session_request_failed",
        message: "No usable realtime session response was received." });
    }
    return Response.json({ error: "Realtime voice isn't available right now." }, { status: 502 });
  }
}
