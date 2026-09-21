"use client";

import { useRef, useState } from "react";
import { buildProductTemplateSetupPlanningPrompt, getProductTemplateAiExtractionPrompt, type ExtractionPromptFocus, type ProductTemplateSetupPlanningFocus } from "@/lib/products/product-template-ai-extraction-prompt";

const choices: Array<{ focus: ExtractionPromptFocus; label: string; description: string }> = [
  { focus: "base_model", label: "Desks / Executive Desks", description: "Extract desk models, sizes, returns, service units, top-access and related desk configuration." },
  { focus: "workstation", label: "Workstations / Bench Systems", description: "Plan and extract workstation desks, benches, clusters, screens, required structural companions, cable management, and related storage." },
  { focus: "screens", label: "Screens / Dividers", description: "Extract desk, bench, side, freestanding and floor screens, acoustic/fabric variants, mounting requirements, finish pricing and screen accessories." },
  { focus: "chair_seating", label: "Chair & Seating", description: "Chair-specific extraction for models, upholstery matrices, mechanisms, bases, arms, castors/glides, and seating options." },
  { focus: "sofa_lounge", label: "Sofas / Lounge / Armchairs", description: "Extract sofas, lounge armchairs, modular seating, upholstery pricing and related lounge configuration." },
  { focus: "meeting_conference", label: "Meeting / Conference Tables", description: "Extract complete meeting tables, terminal/intermediate systems, top-access and related cable management." },
  { focus: "storage_cabinets", label: "Storage / Cabinets / Credenzas", description: "Extract cabinets, credenzas, pedestals, service units, carcasses, doors, tops, shelves, locks and storage accessories." },
];

const planningChoices: Array<{ focus: ProductTemplateSetupPlanningFocus; label: string; description: string }> = [
  { focus: "general", label: "General / Auto Detect", description: "Analyze any manufacturer price list and recommend Product Template splits, pages, batches and setup order." },
  { focus: "chair_seating", label: "Chair & Seating", description: "Chair-specific planning for seating models, upholstery pricing, mechanisms, bases, arms, castors/glides, and seating configuration." },
  { focus: "desk_executive", label: "Desks / Executive Desks", description: "Plan desk models, sizes, returns, service units, top-access and related desk configuration." },
  { focus: "workstation", label: "Workstations / Bench Systems", description: "Plan workstation and bench families, direct-priced systems, starter/add-on architecture, required companions, screens, storage integration, and extraction batches." },
  { focus: "sofa_lounge", label: "Sofas / Lounge / Armchairs", description: "Plan sofas, lounge armchairs, modular seating, upholstery pricing and related lounge configuration." },
  { focus: "meeting_conference", label: "Meeting / Conference Tables", description: "Plan complete meeting tables, terminal/intermediate systems, top-access and related cable management." },
  { focus: "storage_cabinets", label: "Storage / Cabinets / Credenzas", description: "Plan cabinets, credenzas, pedestals, service units, storage systems, lockers, doors, tops, internals and related configuration." },
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

export function CopyAiSetupPlanningPrompt() {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<ProductTemplateSetupPlanningFocus>("general");
  const [copied, setCopied] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selected = planningChoices.find((choice) => choice.focus === focus)!;
  const prompt = buildProductTemplateSetupPlanningPrompt(focus);
  const close = () => { setOpen(false); setShowFallback(false); };
  const copyPrompt = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(prompt);
      setCopied(`${selected.label} planning prompt copied.`);
      close();
      window.setTimeout(() => setCopied(null), 2400);
    } catch { setShowFallback(true); }
  };
  const selectPrompt = () => { textareaRef.current?.focus(); textareaRef.current?.select(); };
  return <div className="relative"><button type="button" title="Use this before extraction for large or complex price lists. The AI will recommend Product Template splits, page ranges, batches, accessories, and setup order." onClick={() => setOpen(true)} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-500">Copy AI Setup Planning Prompt</button>{copied ? <p role="status" className="absolute right-0 top-full z-10 mt-1 w-max rounded-md bg-emerald-900 px-2 py-1 text-xs font-medium text-white">{copied}</p> : null}{open ? <div role="dialog" aria-modal="true" aria-label="Choose Planning Focus" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"><div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Choose Planning Focus</h2><p className="mt-1 text-sm text-zinc-600">Choose how the AI should analyze and structure the manufacturer price list.</p></div><button type="button" onClick={close} className="text-sm font-medium text-zinc-700">Close</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{planningChoices.map((choice) => <label key={choice.focus} className={"cursor-pointer rounded-md border p-3 " + (focus === choice.focus ? "border-emerald-600 bg-emerald-50" : "border-zinc-200")}><input className="sr-only" type="radio" name="planning-focus" checked={focus === choice.focus} onChange={() => setFocus(choice.focus)} /><span className="block text-sm font-semibold text-zinc-900">{choice.label}</span><span className="mt-1 block text-xs leading-4 text-zinc-600">{choice.description}</span></label>)}</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={close} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Cancel</button><button type="button" onClick={copyPrompt} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Copy Prompt</button></div></div></div> : null}{showFallback ? <div role="dialog" aria-modal="true" aria-label="Copy AI setup planning prompt" className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/40 p-4"><div className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Copy AI Setup Planning Prompt</h2><p className="mt-1 text-sm text-zinc-600">Use the returned plan to decide which Product Templates/pages to extract. Then use Copy AI Extraction Prompt for each planned batch.</p></div><button type="button" onClick={close} className="text-sm font-medium text-zinc-700">Close</button></div><textarea ref={textareaRef} readOnly value={prompt} className="mt-4 min-h-80 w-full rounded-md border border-zinc-300 p-3 font-mono text-xs" aria-label="AI setup planning prompt" /><div className="mt-3 flex gap-2"><button type="button" onClick={copyPrompt} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Copy</button><button type="button" onClick={selectPrompt} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Select All</button></div></div></div> : null}</div>;
}
