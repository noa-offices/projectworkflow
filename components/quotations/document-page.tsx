import type { ReactNode } from "react";

const FOOTER_SECONDARY_TEXT = "Dubai | info@noaoffices.com | +971 4 3809234 | Abu Dhabi | sales@noaoffices.com | +971 2 5754022";
const FOOTER_RIGHT_PREFIX = "www.noaoffices.com";

export function DocumentPage({
  children,
  orientation = "landscape",
}: {
  children: ReactNode;
  orientation?: "landscape" | "portrait";
}) {
  const pageClassName = orientation === "portrait"
    ? "h-[297mm] min-h-[297mm] w-[210mm] print:h-[297mm] print:min-h-[297mm] print:w-[210mm]"
    : "h-[210mm] min-h-[210mm] w-[297mm] print:h-[210mm] print:min-h-[210mm] print:w-[297mm]";

  return (
    <section className={`doc-page mx-auto mb-6 flex max-w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white px-[10mm] py-[10mm] shadow-[0_20px_60px_rgba(15,23,42,0.08)] print:mb-0 print:max-w-none print:rounded-none print:border-0 print:px-[10mm] print:py-[10mm] print:shadow-none ${pageClassName}`}>
      {children}
    </section>
  );
}

export function DocumentHeader({
  children,
}: {
  children: ReactNode;
}) {
  return <header className="shrink-0 border-b border-zinc-200 pb-3">{children}</header>;
}

export function DocumentFooter({
  pageNumber,
  totalPages,
}: {
  pageNumber: number;
  totalPages: number;
}) {
  return (
    <footer className="mt-auto flex items-center gap-3 border-t border-zinc-300 pt-2 text-[7.5px] leading-4 text-zinc-500">
      <p className="shrink-0 font-semibold text-zinc-700">Noa Office Solutions LLC</p>
      <p className="min-w-0 flex-1 text-center leading-4">{FOOTER_SECONDARY_TEXT}</p>
      <p className="shrink-0 text-right">{FOOTER_RIGHT_PREFIX} | Page {pageNumber} of {totalPages}</p>
    </footer>
  );
}

export function DocumentMetaList({
  entries,
}: {
  entries: Array<{ label: string; value: string | null | undefined }>;
}) {
  const visibleEntries = entries.filter((entry) => entry.value && entry.value.trim().length > 0);

  return (
    <div className="grid gap-1 text-[8px] leading-4">
      {visibleEntries.map((entry) => (
        <p key={`${entry.label}-${entry.value}`}>
          <span className="text-[7px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{entry.label}</span>
          <span className="ml-2 text-[9px] font-medium text-zinc-900">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}
