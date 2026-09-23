import { NextResponse } from "next/server";
import { logServerActionError } from "@/lib/action-errors";
import { runNoaOrchestrator } from "@/lib/noa/noa-orchestrator";
import { NoaProviderError } from "@/lib/noa/noa-provider.server";
import type { NoaChatRequest, NoaPageContext } from "@/lib/noa/noa-types";
import { createClient } from "@/lib/supabase/server";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_RECENT_MESSAGES = 6;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function isValidPageContext(value: unknown): value is NoaPageContext {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { pathname?: unknown }).pathname === "string" &&
    typeof (value as { section?: unknown }).section === "string",
  );
}

function isValidRecentMessage(value: unknown): value is { role: "user" | "assistant"; text: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    ((value as { role?: unknown }).role === "user" || (value as { role?: unknown }).role === "assistant") &&
    typeof (value as { text?: unknown }).text === "string",
  );
}

export async function POST(request: Request) {
  // Non-redirecting on purpose, matching the same pattern app/layout.tsx uses for NOA's own
  // visibility: a route handler consumed via fetch() by the client must never let
  // requireActiveUser()'s redirect() escape as an actual HTTP redirect (the JSON caller can't
  // follow it usefully) - authentication here is a direct, manual Supabase check instead.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return errorResponse("You need to be signed in to use NOA.", 401);
  }

  // Conversation polish: the caller's own safe display name only (profiles.full_name via RLS
  // profiles_select_own) - never email, never another user's row. Failure is non-fatal: NOA
  // falls back to a generic greeting rather than erroring when the name is unavailable.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle<{ full_name: string | null }>();
  const displayName = typeof profile?.full_name === "string" ? profile.full_name.trim() || undefined : undefined;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid request.", 400);
  }

  if (!body || typeof body !== "object") {
    return errorResponse("Invalid request.", 400);
  }

  const rawMessage = (body as { message?: unknown }).message;
  const message = typeof rawMessage === "string" ? rawMessage.trim() : "";

  if (!message) {
    return errorResponse("A message is required.", 400);
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse("That message is too long.", 400);
  }

  const rawContext = (body as { context?: unknown }).context;
  const context: NoaPageContext = isValidPageContext(rawContext)
    ? rawContext
    : { pathname: "", section: "other" };

  const rawRecentMessages = (body as { recentMessages?: unknown }).recentMessages;
  const recentMessages = Array.isArray(rawRecentMessages)
    ? rawRecentMessages.filter(isValidRecentMessage).slice(-MAX_RECENT_MESSAGES)
    : [];

  const chatRequest: NoaChatRequest = { context, displayName, message, recentMessages };

  try {
    const answer = await runNoaOrchestrator(chatRequest);
    return NextResponse.json(answer);
  } catch (error) {
    logServerActionError("NOA CHAT ERROR", error, { action: "noaChatRoute.POST" });

    if (error instanceof NoaProviderError) {
      return errorResponse("NOA isn't available right now. Please try again shortly.", error.kind === "not_configured" ? 503 : 502);
    }

    return errorResponse("NOA isn't available right now. Please try again shortly.", 500);
  }
}
