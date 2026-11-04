// Control styles shared by the Product Library and Product Management toolbars, so both look the same.
export const toolbarFocusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
export const toolbarControl = `h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 ${toolbarFocusRing}`;
export const toolbarSecondaryButton = `inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 ${toolbarFocusRing}`;
export const toolbarPrimaryButton = `inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 ${toolbarFocusRing}`;
