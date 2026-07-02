"use client";

import { useMemo, useState } from "react";
import { dayCountLabel, formatDateDisplay } from "@/components/settings/vacation-dates-editor";
import type { VacationEntry } from "@/app/hr/actions";

function entryYear(entry: VacationEntry): number {
  return Number(entry.start_date.slice(0, 4));
}

export function VacationHistoryModal({
  onClose,
  personName,
  vacationDates,
}: {
  onClose: () => void;
  personName: string;
  vacationDates: VacationEntry[];
}) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const years = useMemo(() => {
    const set = new Set<number>([currentYear, ...vacationDates.map(entryYear)]);
    return Array.from(set).sort((a, b) => b - a);
  }, [currentYear, vacationDates]);

  const filteredEntries = useMemo(
    () => vacationDates.filter((entry) => entryYear(entry) === selectedYear),
    [selectedYear, vacationDates],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-zinc-950">{personName}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-7 w-7 shrink-0 rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            ×
          </button>
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">Vacation dates</p>

        <label className="mt-4 grid gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Year
          </span>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 grid gap-1.5">
          {filteredEntries.length ? (
            filteredEntries.map((entry) => {
              const days = dayCountLabel(entry.start_date, entry.end_date);
              return (
                <div
                  key={entry.id}
                  className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
                >
                  <p className="font-medium text-zinc-900">
                    {formatDateDisplay(entry.start_date)} – {formatDateDisplay(entry.end_date)}
                    {days ? `  · ${days}` : ""}
                  </p>
                  {entry.note ? <p className="mt-0.5 text-zinc-500">{entry.note}</p> : null}
                </div>
              );
            })
          ) : (
            <p className="text-sm text-zinc-400">No vacation dates for this year.</p>
          )}
        </div>
      </div>
    </div>
  );
}
