import Link from "next/link";
import type { FolderVersionRow } from "@/lib/quotations/folder-versions";

function VersionTable({ title, rows }: { title: string; rows: FolderVersionRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <h3 className="text-xs font-semibold text-zinc-600">{title}</h3>
      <div className="mt-1 overflow-x-auto rounded-md border border-zinc-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Quotation</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Updated</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row) => (
              <tr key={row.id} className={row.isCurrent ? "bg-emerald-50/60" : undefined}>
                <td className="px-3 py-2.5">
                  <span className="font-semibold text-zinc-950">{row.quotationNo}</span>
                  <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                    {row.variationTag ? <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700">{row.variationTag}</span> : null}
                    {row.isProjectQuotation ? <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">Project quotation</span> : null}
                    {row.isCurrent ? <span className="rounded-full border border-emerald-300 bg-emerald-700 px-2 py-0.5 text-[11px] font-semibold text-white">Open now</span> : null}
                  </span>
                  {row.appliedTo ? <span className="block text-xs text-zinc-400">{row.appliedTo}</span> : null}
                </td>
                <td className="px-3 py-2.5"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${row.statusClassName}`}>{row.statusLabel}</span></td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.total}</td>
                <td className="px-3 py-2.5 text-zinc-600">{row.updatedAt}</td>
                <td className="px-3 py-2.5 text-right"><Link href={`/quotations/${row.id}`} className="inline-flex min-h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800">Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function QuotationFolderVersions({ rows }: { rows: FolderVersionRow[] }) {
  return (
    <section className="no-print mt-5" aria-label="Folder versions">
      <h2 className="text-sm font-semibold text-zinc-950">Folder versions</h2>
      <VersionTable title="Active" rows={rows.filter((row) => !row.archived)} />
      <VersionTable title="Archived" rows={rows.filter((row) => row.archived)} />
    </section>
  );
}
