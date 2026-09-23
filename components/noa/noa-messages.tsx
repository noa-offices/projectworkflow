"use client";

import { useEffect, useRef } from "react";
import { NoaSourceBadges } from "@/components/noa/noa-source-badges";
import type { NoaMessage } from "@/lib/noa/noa-types";

const QUICK_PROMPTS = ["Find a product", "Check quotation", "Price status", "How do I..."];

export function NoaMessages({
  messages,
  onQuickPrompt,
}: {
  messages: NoaMessage[];
  onQuickPrompt: (prompt: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const hasUserMessage = messages.some((message) => message.role === "user");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {messages.map((message) => (
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
        </div>
      ))}

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
