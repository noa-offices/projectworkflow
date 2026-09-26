import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_NOA_REALTIME_VOICE !== "true") return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const key = process.env.OPENAI_API_KEY?.trim() || process.env.SOURCE_QA_AI_API_KEY?.trim();
  if (!key) return Response.json({ error: "Realtime voice isn't available right now." }, { status: 503 });
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
            transcription: { model: "gpt-4o-mini-transcribe", prompt: "NOA, ProjectWorkflow, LAS, LAS MOBILI, Interstuhl, EXQUITECH, ETA, ETD, RFQ, quotation, Project File." },
            turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 800 },
          } },
        },
      }),
    });
    if (!response.ok) throw new Error("Session unavailable");
    const body = await response.json() as { value?: string; expires_at?: number };
    if (!body.value?.startsWith("ek_") || typeof body.expires_at !== "number") throw new Error("Invalid session");
    return Response.json({ value: body.value, expires_at: body.expires_at }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Realtime voice isn't available right now." }, { status: 502 });
  }
}
