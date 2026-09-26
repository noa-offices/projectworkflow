"use client";

import { Mic, Send, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { appendVoiceTranscript, type NoaVoice } from "@/components/noa/use-noa-voice";

export function NoaComposer({
  disabled,
  onSend,
  voice,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
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

  return (
    // PART 2: safe-area-aware bottom padding (iOS home-indicator devices) on top of the existing
    // spacing, plus rounding that matches the drawer/bubble family - same submit/keyboard logic.
    <div
      className="border-t border-zinc-200 p-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-end gap-2">
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
          placeholder="Ask NOA about ProjectWorkflow..."
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
