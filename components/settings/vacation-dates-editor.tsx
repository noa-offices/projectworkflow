"use client";

import { useState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import type { VacationEntry } from "@/app/hr/actions";

export function formatDateDisplay(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

export function dayCountLabel(startDate: string, endDate: string): string | null {
  if (!startDate || !endDate) return null;
  const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000) + 1;
  if (days < 1) return null;
  return `${days} day${days !== 1 ? "s" : ""}`;
}

function VacationEntryEditForm({
  editVacationAction,
  entry,
  onCancel,
}: {
  editVacationAction: (entryId: string, formData: FormData) => void | Promise<void>;
  entry: VacationEntry;
  onCancel: () => void;
}) {
  const [startDate, setStartDate] = useState(entry.start_date);
  const [endDate, setEndDate] = useState(entry.end_date);
  const days = dayCountLabel(startDate, endDate);

  return (
    <form
      action={editVacationAction.bind(null, entry.id)}
      className="grid gap-3 rounded-md border border-zinc-200 bg-white p-3 md:grid-cols-3"
    >
      <label className="grid gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Start date
        </span>
        <input
          name="start_date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
          className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          End date
        </span>
        <input
          name="end_date"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          required
          className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
        {days ? <span className="text-xs font-medium text-zinc-500">{days}</span> : null}
      </label>
      <label className="grid gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Note (optional)
        </span>
        <input
          name="note"
          type="text"
          defaultValue={entry.note ?? ""}
          className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <div className="flex items-center gap-2 md:col-span-3">
        <PendingSubmitButton
          className="h-9 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
          pendingLabel="Saving..."
        >
          Save
        </PendingSubmitButton>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function VacationDatesEditor({
  addVacationAction,
  editVacationAction,
  removeVacationAction,
  vacationDates,
}: {
  addVacationAction: (formData: FormData) => void | Promise<void>;
  editVacationAction: (entryId: string, formData: FormData) => void | Promise<void>;
  removeVacationAction: (entryId: string, formData: FormData) => void | Promise<void>;
  vacationDates: VacationEntry[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const newDays = dayCountLabel(newStartDate, newEndDate);

  return (
    <div className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        Vacation dates
      </span>

      {vacationDates.length ? (
        <ul className="grid gap-1.5">
          {vacationDates.map((entry) => {
            const entryDays = dayCountLabel(entry.start_date, entry.end_date);

            return editingId === entry.id ? (
              <li key={entry.id}>
                <VacationEntryEditForm
                  entry={entry}
                  editVacationAction={editVacationAction}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
              >
                <span className="font-medium text-zinc-900">
                  {formatDateDisplay(entry.start_date)} – {formatDateDisplay(entry.end_date)}
                  {entryDays ? `  · ${entryDays}` : ""}
                </span>
                {entry.note ? <span className="text-zinc-500">{entry.note}</span> : null}
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingId(entry.id)}
                    className="h-7 rounded-md border border-zinc-200 px-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-white"
                  >
                    Edit
                  </button>
                  <form action={removeVacationAction.bind(null, entry.id)}>
                    <PendingSubmitButton
                      className="h-7 rounded-md border border-red-200 px-2 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                      pendingLabel="Deleting..."
                    >
                      Delete
                    </PendingSubmitButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-zinc-400">No vacation dates logged.</p>
      )}

      {showForm ? (
        <form
          action={addVacationAction}
          className="grid gap-3 rounded-md border border-zinc-200 bg-white p-3 md:grid-cols-3"
        >
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Start date
            </span>
            <input
              name="start_date"
              type="date"
              value={newStartDate}
              onChange={(e) => setNewStartDate(e.target.value)}
              required
              className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              End date
            </span>
            <input
              name="end_date"
              type="date"
              value={newEndDate}
              onChange={(e) => setNewEndDate(e.target.value)}
              required
              className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
            {newDays ? <span className="text-xs font-medium text-zinc-500">{newDays}</span> : null}
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Note (optional)
            </span>
            <input
              name="note"
              type="text"
              className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <div className="flex items-center gap-2 md:col-span-3">
            <PendingSubmitButton
              className="h-9 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
              pendingLabel="Saving..."
            >
              Save Vacation
            </PendingSubmitButton>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setNewStartDate("");
                setNewEndDate("");
              }}
              className="h-9 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="h-9 w-fit rounded-md border border-zinc-200 px-3 text-xs font-semibold text-emerald-900 transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          + Add Vacation
        </button>
      )}
    </div>
  );
}
