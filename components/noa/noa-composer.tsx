"use client";

import { AudioLines, Mic, Send, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { appendVoiceTranscript, type NoaVoice } from "@/components/noa/use-noa-voice";
import type { VoicePhase } from "@/components/noa/use-noa-realtime-voice";

// Live Voice sits next to (never merges with) the manual mic: waveform glyph + emerald accent
// for the realtime conversation, distinct from the manual mic's dictation glyph.
export interface NoaComposerRealtime {
  active: boolean;
  phase: VoicePhase;
  error?: string;
  transcript: string;
  disabled: boolean;
  onToggle: () => void;
}

const REALTIME_STATUS_TEXT: Record<VoicePhase, string> = {
  idle: "",
  error: "Voice unavailable. Use typing or manual voice.",
  connecting: "Connecting…",
  listening: "Listening…",
  transcribing: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export function NoaComposer({
  disabled,
  onSend,
  realtime,
  voice,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  realtime?: NoaComposerRealtime;
  voice?: NoaVoice;
}) {
  const [value, setValue] = useState("");
  const abortInput = voice?.abortInput;
  useEffect(() => { if (disabled) abortInput?.(); }, [disabled, abortInput]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    abortInput?.();
    onSend(trimmed);
    setValue("");
  }

  const statusText = realtime && (realtime.active || realtime.phase === "error") ? REALTIME_STATUS_TEXT[realtime.phase] : "";

  return (
    // PART 2: safe-area-aware bottom padding (iOS home-indicator devices) on top of the existing
    // spacing, plus rounding that matches the drawer/bubble family - same submit/keyboard logic.
    <div
      className="border-t border-zinc-200 p-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {realtime && (statusText || realtime.transcript) ? (
        <div className="mb-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5 text-xs">
          {statusText && (
            <span aria-live="polite" className={`font-medium ${realtime.phase === "error" ? "text-amber-700" : "text-emerald-800"}`} role="status">
              {statusText}
            </span>
          )}
          {realtime.active && <span className="text-[10px] text-zinc-400">AI-generated voice</span>}
          {realtime.transcript && (
            <span aria-label="Voice transcript" className="w-full break-words text-zinc-500">{realtime.transcript}</span>
          )}
        </div>
      ) : null}
      <div className="flex items-end gap-1.5">
        <textarea
          className="max-h-28 min-h-[42px] min-w-0 flex-1 resize-none rounded-2xl border border-zinc-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 disabled:bg-zinc-50 disabled:text-zinc-400"
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Ask NOA..."
          rows={1}
          value={value}
        />
        {voice?.recognitionSupported ? (
          <button
            aria-label={voice.listening ? "Stop voice input" : "Start voice input"}
            aria-pressed={voice.listening}
            title={voice.listening ? "Stop listening" : "Start voice input"}
            className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-2xl border border-zinc-200 text-zinc-700 hover:bg-zinc-100 aria-pressed:bg-emerald-50 disabled:opacity-50"
            disabled={disabled || voice.ending}
            onClick={() => voice.toggleInput((text) => setValue((current) => appendVoiceTranscript(current, text)))}
            type="button"
          >
            {voice.listening ? <Square aria-hidden="true" className="h-4 w-4" /> : <Mic aria-hidden="true" className="h-4 w-4" />}
          </button>
        ) : null}
        {realtime ? (
          <button
            aria-label={realtime.active ? "End voice conversation" : "Start voice conversation"}
            aria-pressed={realtime.active}
            title={realtime.active ? "End voice conversation" : "Start voice conversation"}
            className={`inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
              realtime.phase === "error"
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : realtime.active
                  ? "border-emerald-800 bg-emerald-900 text-white shadow-sm"
                  : "border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
            }`}
            disabled={realtime.disabled}
            onClick={realtime.onToggle}
            type="button"
          >
            <AudioLines
              aria-hidden="true"
              className={`h-4 w-4 ${
                (realtime.phase === "listening" || realtime.phase === "speaking") ? "motion-safe:animate-pulse" : ""
              } ${realtime.phase === "thinking" ? "opacity-60" : ""}`}
            />
          </button>
        ) : null}
        <button
          aria-label="Send message"
          className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-2xl bg-emerald-900 text-white transition hover:bg-emerald-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
          disabled={disabled || !value.trim()}
          onClick={submit}
          type="button"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {voice?.listening || voice?.error ? (
        <p className="mt-2 break-words text-xs text-zinc-600" role="status">
          {voice.error || (voice.ending ? "Finishing voice input..." : "Listening... Tap stop when done.")}
        </p>
      ) : null}
    </div>
  );
}
