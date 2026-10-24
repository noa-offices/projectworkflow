import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared Inventory building blocks. Everything here keeps the ProjectWorkflow look
 * (emerald and zinc, 44px targets, 16px field text) so pages cannot drift apart.
 */
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";
const buttonBase = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
export const buttonClass = {
  primary: `${buttonBase} bg-emerald-900 text-white hover:bg-emerald-800`,
  secondary: `${buttonBase} border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`,
  danger: `${buttonBase} bg-red-700 text-white hover:bg-red-800`,
  quiet: `${buttonBase} text-zinc-700 hover:bg-zinc-100`,
} as const;
export const chipClass = (active: boolean) => `inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium ${focusRing} ${active ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`;
export const fieldClass = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
export const cardClass = "min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5";

const tones = {
  neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
  good: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warn: "border-amber-200 bg-amber-50 text-amber-950",
  bad: "border-red-200 bg-red-50 text-red-900",
} as const;
export type BadgeTone = keyof typeof tones;
/** A status is always a badge with words, never colour alone. */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span data-badge={tone} className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-sm font-medium [overflow-wrap:anywhere] ${tones[tone]}`}>{children}</span>;
}

export function PageHeader({ title, text, actions }: { title: string; text?: string; actions?: ReactNode }) {
  return <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
    <div className="min-w-0"><h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{title}</h1>{text ? <p className="mt-1 text-sm text-zinc-600">{text}</p> : null}</div>
    {actions}
  </header>;
}

/** One helpful sentence and at most one button. */
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: { href: string; label: string } }) {
  return <section data-empty-state className="rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-10 text-center">
    {icon ? <div className="mx-auto flex w-fit text-zinc-400">{icon}</div> : null}
    <h2 className="mt-3 text-lg font-semibold text-zinc-950">{title}</h2>
    <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600">{text}</p>
    {action ? <Link href={action.href} className={`${buttonClass.secondary} mt-5`}>{action.label}</Link> : null}
  </section>;
}

/** Slim paging row: Previous, 1 / 3, Next. */
export function Pager({ label, page, pageCount, previousHref, nextHref }: { label: string; page: number; pageCount: number; previousHref: string | null; nextHref: string | null }) {
  const pages = Math.max(1, pageCount);
  return <nav aria-label={label} className="flex items-center justify-between gap-2">
    {previousHref ? <Link href={previousHref} className={buttonClass.secondary}>Previous</Link> : <span aria-disabled="true" className={`${buttonClass.secondary} opacity-50`}>Previous</span>}
    <p className="text-sm tabular-nums text-zinc-700" aria-live="polite"><span className="sr-only">Page </span>{page} / {pages}</p>
    {nextHref ? <Link href={nextHref} className={buttonClass.secondary}>Next</Link> : <span aria-disabled="true" className={`${buttonClass.secondary} opacity-50`}>Next</span>}
  </nav>;
}

/**
 * Save bar for long forms. It sticks to the bottom of the screen on phones, leaves room on the
 * right for the floating assistant, and shows why a button is disabled.
 */
export function StickyActionBar({ children, reason }: { children: ReactNode; reason?: string | null }) {
  return <div data-sticky-bar className="sticky bottom-0 z-20 -mx-3 space-y-2 border-t border-zinc-200 bg-white/95 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 pr-24 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:pr-3 lg:static lg:pb-3">
    {reason ? <p data-disabled-reason className="text-sm text-zinc-700">{reason}</p> : null}
    {children}
  </div>;
}

/** Inline message that does not move the layout around it. */
export function Banner({ tone, children }: { tone: "success" | "error" | "info"; children: ReactNode }) {
  const style = tone === "success" ? tones.good : tone === "error" ? tones.bad : tones.neutral;
  return <p role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"} data-banner={tone} className={`rounded-lg border p-3 text-sm [overflow-wrap:anywhere] ${style}`}>{children}</p>;
}
