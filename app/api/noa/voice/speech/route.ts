import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_NOA_REALTIME_VOICE !== "true") return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Bound bytes while reading, including requests without Content-Length.
  let body: unknown;
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Invalid voice text" }, { status: 400 });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return Response.json({ error: "Voice text too long" }, { status: 413 }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return Response.json({ error: "Invalid voice text" }, { status: 400 }); }
  finally { reader.releaseLock(); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "voiceText") || !("voiceText" in body)) {
    return Response.json({ error: "Invalid voice text" }, { status: 400 });
  }
  const text = body.voiceText;
  if (typeof text !== "string" || text.length > 600 || !/[\p{L}\p{N}]/u.test(text) || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    return Response.json({ error: "Invalid voice text" }, { status: 400 });
  }
  const key = process.env.OPENAI_API_KEY?.trim() || process.env.SOURCE_QA_AI_API_KEY?.trim();
  if (!key) return Response.json({ error: "Speech unavailable" }, { status: 503 });
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "marin", input: text, response_format: "pcm" }),
    });
    if (!response.ok || !response.body) throw new Error("Speech unavailable");
    return new Response(response.body, { headers: { "Content-Type": "audio/pcm", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return Response.json({ error: "Speech unavailable" }, { status: 502 }); }
}
