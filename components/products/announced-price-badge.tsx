import { announcementBadge, type AnnouncementView } from "@/lib/products/price-announcements";

/** "+3% announced from 1 Dec 2026". Information only: it never changes a displayed price. Shown only while the notice is active. */
export function AnnouncedPriceBadge({ announcement, className = "" }: { announcement: AnnouncementView | null | undefined; className?: string }) {
  if (!announcement || announcement.state !== "active") return null;
  const text = announcementBadge(announcement);
  return <span title={announcement.note || text} className={`inline-flex max-w-full truncate rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-900 ${className}`}>{text}</span>;
}
