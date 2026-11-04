import Link from "next/link";
import type { ReactNode } from "react";
import { cardGridColumns } from "./product-toolbar-styles";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";

/**
 * The compact product card shared by Product Library and Product Management: a short image frame with the status badge and image count on
 * its corners, a title, ONE line for brand and category, optional code / description lines, and two small buttons side by side.
 * The pages pass in the image, badges, checkbox and menu; this component only lays them out.
 */
export function ProductCompactCard({
  badge,
  checkbox,
  codeLine,
  descriptionLine,
  editHref,
  imageCount,
  media,
  menu,
  metaLine,
  openHref,
  quoteName,
  selected = false,
  statusBadge,
  title,
}: {
  badge: ReactNode;
  checkbox?: ReactNode;
  codeLine?: string | null;
  descriptionLine?: string | null;
  editHref: string;
  imageCount: number;
  media: ReactNode;
  menu?: ReactNode;
  metaLine: string;
  openHref: string;
  quoteName?: string | null;
  selected?: boolean;
  /** Page B: the price status badge, shown on the top-left of the image next to the checkbox. Its long note belongs in the badge tooltip. */
  statusBadge?: ReactNode;
  title: string;
}) {
  return (
    <article className={`flex h-full min-w-0 flex-col overflow-visible rounded-lg border bg-white shadow-sm ${selected ? "border-emerald-200 bg-emerald-50/30" : "border-zinc-200"}`}>
      <div className="p-2 pb-0">
        <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-md border border-zinc-100 bg-zinc-50">
          {media}
          {checkbox}
          {statusBadge ? <span className="absolute left-7 top-1.5 z-10 max-w-[55%]">{statusBadge}</span> : null}
          <span className="pointer-events-none absolute right-1.5 top-1.5 z-10">{badge}</span>
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-10 rounded-full border border-zinc-200 bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600">
            {imageCount} {imageCount === 1 ? "image" : "images"}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-950" title={title}>{title}</h3>
          {menu}
        </div>
        {quoteName ? <p className="truncate text-xs font-medium text-zinc-500" title={`Quote name: ${quoteName}`}>Quote name: {quoteName}</p> : null}
        <p className="truncate text-xs text-zinc-500" title={metaLine}>{metaLine}</p>
        {codeLine ? <p className="truncate text-xs text-zinc-500" title={codeLine}>{codeLine}</p> : null}
        {descriptionLine ? <p className="truncate text-xs text-zinc-600" title={descriptionLine}>{descriptionLine}</p> : null}
        <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
          <Link href={openHref} className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100 ${focusRing}`}>View Details</Link>
          <Link href={editHref} className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 ${focusRing}`}>Edit Template</Link>
        </div>
      </div>
    </article>
  );
}

/** The grid both pages use: 1, 2, 3 and 4 columns by the width of the page content (put "@container" on a wrapper), equal heights in a row. */
export const productCardGridClass = cardGridColumns;
