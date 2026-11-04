// Control styles shared by the Product Library and Product Management toolbars, so both look the same.
export const toolbarFocusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
export const toolbarControl = `h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 ${toolbarFocusRing}`;
export const toolbarSecondaryButton = `inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 ${toolbarFocusRing}`;
export const toolbarPrimaryButton = `inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 ${toolbarFocusRing}`;

// Layout shared by the toolbars and card grids. Sizes follow the width of the page content (container queries), not the window,
// because the sidebar takes 280 px. Put "@container" on a wrapper; the classes below apply to elements inside it.
export const toolbarContainer = "@container";
export const toolbarRow = "flex flex-wrap items-center gap-2";
/** The search box grows to fill the free space. */
export const toolbarSearch = "relative w-full min-w-0 @xl:w-auto @xl:min-w-[14rem] @xl:flex-1";
/** Filter dropdowns keep a compact fixed width on wider content and fill the row on a phone. */
export const toolbarSelectWidth = "w-full @xl:w-40";
/** The action buttons stay together as one group at the right end and move to the next row as a whole. */
export const toolbarActions = "flex w-full flex-wrap items-center gap-2 @xl:ml-auto @xl:w-auto @xl:justify-end";
/** Card grids: 1 column, then 2 / 3 / 4 as the content gets wider. All three use arbitrary values so Tailwind keeps them in size order. */
export const cardGridColumns = "grid auto-rows-fr gap-3 @min-[576px]:grid-cols-2 @min-[896px]:grid-cols-3 @min-[1040px]:grid-cols-4";
