"use client";

import { NoaComposer } from "@/components/noa/noa-composer";
import { NoaHeader } from "@/components/noa/noa-header";
import { NoaMessages } from "@/components/noa/noa-messages";
import { NoaStatus } from "@/components/noa/noa-status";
import { useNoaVoice } from "@/components/noa/use-noa-voice";
import { useNoaRealtimeVoice, type VoiceSubmit } from "@/components/noa/use-noa-realtime-voice";
import type { NoaDomain, NoaMessage, NoaVisualState } from "@/lib/noa/noa-types";

export function NoaChatDrawer({
  isOpen,
  messages,
  onClose,
  onSend,
  pendingDomain,
  state,
}: {
  isOpen: boolean;
  messages: NoaMessage[];
  onClose: () => void;
  onSend: VoiceSubmit;
  pendingDomain: NoaDomain | null;
  state: NoaVisualState;
}) {
  const isBusy = state === "thinking" || state === "responding";
  const voice = useNoaVoice(isOpen);
  const realtime = useNoaRealtimeVoice(isOpen, onSend);
  const realtimeEnabled = process.env.NEXT_PUBLIC_NOA_REALTIME_VOICE === "true";
  const manualSend = (text: string) => { realtime.stop(); void onSend(text); };
  const close = () => { realtime.stop(); voice.abortInput(); voice.stopSpeech(); onClose(); };

  return (
    // A floating popup anchored near the launcher, not a full-height drawer: on desktop it's a
    // fixed-size card sitting just above the robot (bottom offset accounts for the launcher's
    // own bottom-24 position plus its ~76px height, plus a ~16px gap, so the popup never covers
    // it); on mobile it grows to fill most of the viewport instead of a fixed card size.
    <div
      aria-hidden={!isOpen}
      // PART 2: a touch more radius + a hairline ring (on top of the existing border/shadow) for a
      // slightly more premium "floating card" feel, especially on mobile where the drawer fills
      // most of the viewport - purely cosmetic, every positioning value below is unchanged so it
      // stays in the exact spot the launcher's own bottom offset comment already accounts for.
      className={`fixed inset-x-3 top-16 bottom-20 z-30 flex origin-bottom-right flex-col overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-2xl ring-1 ring-black/[0.03] transition-all duration-200 ease-out motion-reduce:transition-none sm:inset-x-auto sm:top-auto sm:bottom-[188px] sm:right-6 sm:h-[600px] sm:max-h-[calc(100vh_-_140px)] sm:w-[400px] sm:max-w-[calc(100vw_-_2rem)] ${
        isOpen
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-2 scale-95 opacity-0"
      }`}
    >
      <NoaHeader onClose={close} state={state} />
      {/* A request in flight disables choices and the composer through the same busy state. */}
      <NoaMessages isBusy={isBusy} messages={messages} onQuickPrompt={manualSend} voice={realtime.active ? undefined : voice} />
      <NoaStatus pendingDomain={pendingDomain} state={state} />
      {realtimeEnabled && (
        <div className="min-w-0 shrink-0 border-t border-zinc-100 px-4 py-2 text-xs text-zinc-600">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              aria-label={realtime.active ? "End voice conversation" : "Start voice conversation"}
              aria-pressed={realtime.active}
              disabled={!realtime.active && isBusy}
              className="rounded-lg border border-zinc-200 px-2 py-1.5 font-medium text-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
              onClick={() => {
                if (realtime.active) realtime.stop();
                else { voice.abortInput(); voice.stopSpeech(); void realtime.start(); }
              }}
            >
              {realtime.active ? "End voice" : "Voice"}
            </button>
            <span role="status" aria-live="polite" className="min-w-0 break-words">
              {realtime.phase === "error" ? "Voice unavailable. Use typing or manual voice."
                : realtime.phase === "connecting" ? "Connecting…"
                : realtime.phase === "thinking" ? "Thinking…"
                : realtime.phase === "speaking" ? "Speaking…"
                : realtime.active ? "Listening…" : "Microphone off"}
            </span>
            <span className="text-[10px] text-zinc-400">AI-generated voice</span>
          </div>
          {realtime.error && <p role="status" className="mt-1 break-words">{realtime.error}</p>}
          {realtime.transcript && <p aria-label="Voice transcript" className="mt-1 max-h-16 overflow-y-auto break-words text-zinc-800">{realtime.transcript}</p>}
        </div>
      )}
      <NoaComposer disabled={isBusy} onSend={manualSend} voice={realtime.active ? undefined : voice} />
    </div>
  );
}
