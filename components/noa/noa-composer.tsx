"use client";

import { Send } from "lucide-react";
import { useState } from "react";

export function NoaComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
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
          className="max-h-28 min-h-[42px] flex-1 resize-none rounded-2xl border border-zinc-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 disabled:bg-zinc-50 disabled:text-zinc-400"
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
    </div>
  );
}
