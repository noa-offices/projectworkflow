"use client";

import { useRef, useState } from "react";
import { getProductTemplateAiExtractionPrompt, type ExtractionPromptFocus } from "@/lib/products/product-template-ai-extraction-prompt";

const choices: Array<{ focus: ExtractionPromptFocus; label: string; description: string }> = [
  { focus: "full", label: "Full Product / Complete Extraction", description: "Extract all clearly supported product details, pricing, options, materials, finishes and technical information." },
  { focus: "base_model", label: "Base / Model Pricing", description: "Focus on directly priced models, variants, configurations, dimensions and supplier codes." },
  { focus: "workstation", label: "Workstation Pricing", description: "Focus on workstation sizes, layouts, configurations, additional pricing and related accessories." },
  { focus: "category_matrix", label: "Category / Matrix Pricing", description: "Focus on row-by-category pricing such as fabric, leather, finish or other price matrices." },
  { focus: "modular", label: "Modular Pricing", description: "Focus on modular families, modules, groups, shared price categories and related configuration." },
  { focus: "accessories", label: "Accessories / Configuration Only", description: "Focus only on accessories, options, companion components and configuration rules." },
  { focus: "product_details", label: "Product Details / Specifications", description: "Focus on product identity, descriptions, technical specifications, dimensions and model details." },
  { focus: "materials", label: "Materials / Finishes", description: "Focus on finish codes, materials, colours, combinations and applicability." },
];

export function CopyAiExtractionPrompt() {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<ExtractionPromptFocus>("full");
  const [copied, setCopied] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selected = choices.find((choice) => choice.focus === focus)!;
  const prompt = getProductTemplateAiExtractionPrompt(focus);
  const close = () => { setOpen(false); setShowFallback(false); };
  const copyPrompt = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(prompt);
      setCopied(`${selected.label} extraction prompt copied.`);
      close();
      window.setTimeout(() => setCopied(null), 2400);
    } catch { setShowFallback(true); }
  };
  const selectPrompt = () => { textareaRef.current?.focus(); textareaRef.current?.select(); };

  return <div className="relative"><button type="button" onClick={() => setOpen(true)} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-500 hover:text-emerald-900">Copy AI Extraction Prompt</button>{copied ? <p role="status" className="absolute right-0 top-full z-10 mt-1 w-max rounded-md bg-emerald-900 px-2 py-1 text-xs font-medium text-white">{copied}</p> : null}{open ? <div role="dialog" aria-modal="true" aria-label="Choose Extraction Focus" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"><div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Choose Extraction Focus</h2><p className="mt-1 text-sm text-zinc-600">The returned JSON always uses ProductTemplateDraft v1.</p></div><button type="button" onClick={close} className="text-sm font-medium text-zinc-700">Close</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{choices.map((choice) => <label key={choice.focus} className={`cursor-pointer rounded-md border p-3 ${focus === choice.focus ? "border-emerald-600 bg-emerald-50" : "border-zinc-200"}`}><input className="sr-only" type="radio" name="extraction-focus" checked={focus === choice.focus} onChange={() => setFocus(choice.focus)} /><span className="block text-sm font-semibold text-zinc-900">{choice.label}</span><span className="mt-1 block text-xs leading-4 text-zinc-600">{choice.description}</span></label>)}</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={close} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Cancel</button><button type="button" onClick={copyPrompt} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Copy Prompt</button></div></div></div> : null}{showFallback ? <div role="dialog" aria-modal="true" aria-label="Copy AI extraction prompt" className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/40 p-4"><div className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Copy AI Extraction Prompt</h2><p className="mt-1 text-sm text-zinc-600">Clipboard access is unavailable. Select the prompt below and copy it manually.</p></div><button type="button" onClick={close} className="text-sm font-medium text-zinc-700">Close</button></div><textarea ref={textareaRef} readOnly value={prompt} className="mt-4 min-h-80 w-full rounded-md border border-zinc-300 p-3 font-mono text-xs" aria-label="AI extraction prompt" /><div className="mt-3 flex gap-2"><button type="button" onClick={copyPrompt} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Copy</button><button type="button" onClick={selectPrompt} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Select All</button></div></div></div> : null}</div>;
}
