"use client";

import { NoaComposer } from "@/components/noa/noa-composer";
import { NoaHeader } from "@/components/noa/noa-header";
import { NoaMessages } from "@/components/noa/noa-messages";
import { NoaStatus } from "@/components/noa/noa-status";
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
  onSend: (text: string) => void;
  pendingDomain: NoaDomain | null;
  state: NoaVisualState;
}) {
  const isBusy = state === "thinking" || state === "responding";

  return (
    // A floating popup anchored near the launcher, not a full-height drawer: on desktop it's a
    // fixed-size card sitting just above the robot (bottom offset accounts for the launcher's
    // own bottom-24 position plus its ~76px height, plus a ~16px gap, so the popup never covers
    // it); on mobile it grows to fill most of the viewport instead of a fixed card size.
    <div
      aria-hidden={!isOpen}
      className={`fixed inset-x-3 top-16 bottom-20 z-30 flex origin-bottom-right flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl transition-all duration-200 ease-out motion-reduce:transition-none sm:inset-x-auto sm:top-auto sm:bottom-[188px] sm:right-6 sm:h-[600px] sm:max-h-[calc(100vh_-_140px)] sm:w-[400px] sm:max-w-[calc(100vw_-_2rem)] ${
        isOpen
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-2 scale-95 opacity-0"
      }`}
    >
      <NoaHeader onClose={onClose} state={state} />
      <NoaMessages messages={messages} onQuickPrompt={onSend} />
      <NoaStatus pendingDomain={pendingDomain} state={state} />
      <NoaComposer disabled={isBusy} onSend={onSend} />
    </div>
  );
}
