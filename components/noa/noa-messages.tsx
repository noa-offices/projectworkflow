"use client";

import { useEffect, useRef } from "react";
import { NoaSourceBadges } from "@/components/noa/noa-source-badges";
import type { NoaMessage } from "@/lib/noa/noa-types";

const QUICK_PROMPTS = ["Find a product", "Check quotation", "Price status", "How do I..."];

export function NoaMessages({
  isBusy = false,
  messages,
  onQuickPrompt,
}: {
  isBusy?: boolean;
  messages: NoaMessage[];
  onQuickPrompt: (prompt: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const hasUserMessage = messages.some((message) => message.role === "user");
  // GPC-3.1 PART 5: only the LATEST message's own choices are ever clickable - once the
  // conversation has moved on (a newer message exists, from either side), an older assistant
  // message's choices render as plain, disabled buttons rather than being removed (the user can
  // still see what was offered, they just can't act on a stale question anymore).
  const latestMessageId = messages.at(-1)?.id;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {messages.map((message) => {
        const choicesEnabled = !isBusy && message.id === latestMessageId;
        return (
          <div
            key={message.id}
            className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}
          >
            <p
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-6 ${
                message.role === "user"
                  ? "bg-emerald-900 text-white"
                  : "bg-zinc-100 text-zinc-900"
              }`}
            >
              {message.text}
            </p>
            {/* Source badges only ever render for assistant messages - user messages never carry
                domain/sources metadata in the first place (see NoaMessage in lib/noa/noa-types.ts). */}
            {message.role === "assistant" ? (
              <NoaSourceBadges domain={message.domain} sources={message.sources} />
            ) : null}
            {/* GPC-3.1: real <button type="button"> elements only - keyboard reachable, visible
                text label, never an icon-only or clickable-div choice. Clicking one sends the
                SAME visible value through the existing onQuickPrompt/handleSend path as typed
                text; the server revalidates it exactly like free text (see
                noa-orchestrator.ts's matchProductConfigurationAnswer). */}
            {message.role === "assistant" && message.choices?.length ? (
              <div className="mt-1.5 flex max-w-[85%] flex-col gap-1.5" role="group">
                {message.choices.map((choice, index) => (
                  <button
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-left text-sm font-medium text-zinc-800 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-200 disabled:hover:bg-white"
                    disabled={!choicesEnabled}
                    key={`${message.id}-choice-${index}`}
                    onClick={() => onQuickPrompt(choice.value)}
                    type="button"
                  >
                    <span className="block">{choice.label}</span>
                    {choice.secondary ? (
                      <span className="mt-0.5 block text-xs font-normal text-zinc-500">{choice.secondary}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {!hasUserMessage ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-emerald-300 hover:bg-emerald-50"
              onClick={() => onQuickPrompt(prompt)}
              type="button"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <div ref={bottomRef} />
    </div>
  );
}
