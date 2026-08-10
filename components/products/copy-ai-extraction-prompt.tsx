"use client";

import { useRef, useState } from "react";
import { getProductTemplateAiExtractionPrompt } from "@/lib/products/product-template-ai-extraction-prompt";

const prompt = getProductTemplateAiExtractionPrompt();

export function CopyAiExtractionPrompt() {
  const [copied, setCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const copyPrompt = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setShowFallback(false);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setShowFallback(true);
    }
  };

  const selectPrompt = () => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  };

  return <div className="relative">
    <button type="button" onClick={copyPrompt} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-500 hover:text-emerald-900">Copy AI Extraction Prompt</button>
    {copied ? <p role="status" className="absolute right-0 top-full z-10 mt-1 w-max rounded-md bg-emerald-900 px-2 py-1 text-xs font-medium text-white">AI extraction prompt copied.</p> : null}
    {showFallback ? <div role="dialog" aria-modal="true" aria-label="Copy AI extraction prompt" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"><div className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Copy AI Extraction Prompt</h2><p className="mt-1 text-sm text-zinc-600">Clipboard access is unavailable. Select the prompt below and copy it manually.</p></div><button type="button" onClick={() => setShowFallback(false)} className="text-sm font-medium text-zinc-700">Close</button></div><textarea ref={textareaRef} readOnly value={prompt} className="mt-4 min-h-80 w-full rounded-md border border-zinc-300 p-3 font-mono text-xs" aria-label="AI extraction prompt" /><div className="mt-3 flex gap-2"><button type="button" onClick={copyPrompt} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Copy</button><button type="button" onClick={selectPrompt} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Select All</button></div></div></div> : null}
  </div>;
}
