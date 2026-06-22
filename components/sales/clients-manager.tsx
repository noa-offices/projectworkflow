"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientWithCount } from "@/app/sales/clients/page";
import {
  deactivateClient,
  mergeClients,
  permanentlyDeleteClient,
  updateClient,
} from "@/app/sales/clients/actions";

type EditFields = {
  company_name: string;
  client_code: string;
  contact_person: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  city: string;
  country: string;
  trn: string;
  notes: string;
};

const TEXT_FIELDS: { key: keyof Omit<EditFields, "company_name" | "notes">; label: string }[] = [
  { key: "client_code", label: "Client Code" },
  { key: "contact_person", label: "Contact Person" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "trn", label: "TRN" },
];

function fieldClass(small = false) {
  return `${small ? "h-8 text-xs" : "h-9 text-sm"} w-full rounded-md border border-zinc-200 px-3 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-900/10`;
}

export function ClientsManager({
  clients,
  canManage,
}: {
  clients: ClientWithCount[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editingClient, setEditingClient] = useState<ClientWithCount | null>(null);
  const [editFields, setEditFields] = useState<EditFields | null>(null);
  const [mergingClient, setMergingClient] = useState<ClientWithCount | null>(null);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [pending, setPending] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      clients.filter(
        (c) =>
          (showInactive || c.is_active) &&
          (!search ||
            c.company_name.toLowerCase().includes(search.toLowerCase()) ||
            (c.client_number?.toLowerCase() ?? "").includes(search.toLowerCase()) ||
            (c.client_code?.toLowerCase() ?? "").includes(search.toLowerCase())),
      ),
    [clients, search, showInactive],
  );

  const mergeOptions = useMemo(
    () =>
      clients.filter(
        (c) =>
          c.is_active &&
          c.id !== mergingClient?.id &&
          (!mergeSearch ||
            c.company_name.toLowerCase().includes(mergeSearch.toLowerCase())),
      ),
    [clients, mergingClient?.id, mergeSearch],
  );

  const mergeTargetClient = useMemo(
    () => clients.find((c) => c.id === mergeTargetId) ?? null,
    [clients, mergeTargetId],
  );

  function openEdit(c: ClientWithCount) {
    setEditingClient(c);
    setEditFields({
      company_name: c.company_name,
      client_code: c.client_code ?? "",
      contact_person: c.contact_person ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      website: c.website ?? "",
      address: c.address ?? "",
      city: c.city ?? "",
      country: c.country,
      trn: c.trn ?? "",
      notes: c.notes ?? "",
    });
    setModalError(null);
  }

  function setField(key: keyof EditFields, value: string) {
    setEditFields((prev) => (prev ? { ...prev, [key]: value } : null));
  }

  function closeEdit() {
    setEditingClient(null);
    setEditFields(null);
  }

  function openMerge(c: ClientWithCount) {
    setMergingClient(c);
    setMergeSearch("");
    setMergeTargetId("");
    setModalError(null);
  }

  function closeMerge() {
    setMergingClient(null);
    setMergeTargetId("");
  }

  async function handleSaveEdit() {
    if (!editingClient || !editFields || !editFields.company_name.trim()) return;
    setPending(true);
    setModalError(null);
    try {
      const result = await updateClient(editingClient.id, {
        company_name: editFields.company_name.trim(),
        client_code: editFields.client_code || null,
        contact_person: editFields.contact_person || null,
        email: editFields.email || null,
        phone: editFields.phone || null,
        website: editFields.website || null,
        address: editFields.address || null,
        city: editFields.city || null,
        country: editFields.country || "UAE",
        trn: editFields.trn || null,
        notes: editFields.notes || null,
      });
      if (result.ok) {
        closeEdit();
        router.refresh();
      } else {
        setModalError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(c: ClientWithCount) {
    if (c.quotationCount > 0) return;
    const confirmed = window.confirm(
      `Deactivate "${c.company_name}"?\n\nThey will no longer appear in dropdowns but their data is preserved.`,
    );
    if (!confirmed) return;
    setPending(true);
    try {
      const result = await deactivateClient(c.id);
      if (!result.ok) alert(result.error);
      else router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handlePermanentDelete(c: ClientWithCount) {
    const confirmed = window.confirm(
      `Permanently delete "${c.company_name}"?\n\nThis cannot be undone. The client record will be removed forever.`,
    );
    if (!confirmed) return;
    setPending(true);
    try {
      const result = await permanentlyDeleteClient(c.id);
      if (!result.ok) alert(result.error);
      else router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleMerge() {
    if (!mergingClient || !mergeTargetClient) return;
    const confirmed = window.confirm(
      `Merge "${mergingClient.company_name}" into "${mergeTargetClient.company_name}"?\n\nAll quotations from "${mergingClient.company_name}" will be moved to "${mergeTargetClient.company_name}". The duplicate will be deactivated. This cannot be undone.`,
    );
    if (!confirmed) return;
    setPending(true);
    setModalError(null);
    try {
      const result = await mergeClients(mergeTargetClient.id, mergingClient.id);
      if (result.ok) {
        closeMerge();
        router.refresh();
      } else {
        setModalError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <input
          type="text"
          placeholder="Search by name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-64 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none"
        />
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 accent-emerald-700"
            />
            Show inactive
          </label>
          <p className="text-sm text-zinc-400">
            {filtered.length} client{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[860px] border-collapse text-left text-sm">
          <thead className="bg-zinc-50 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            <tr>
              <th className="border-b border-zinc-100 px-4 py-2.5">Code</th>
              <th className="border-b border-zinc-100 px-4 py-2.5">Company Name</th>
              <th className="border-b border-zinc-100 px-4 py-2.5">Contact</th>
              <th className="border-b border-zinc-100 px-4 py-2.5">Email</th>
              <th className="border-b border-zinc-100 px-4 py-2.5">Phone</th>
              <th className="border-b border-zinc-100 px-4 py-2.5">City</th>
              <th className="border-b border-zinc-100 px-4 py-2.5 text-right">Qtns</th>
              <th className="border-b border-zinc-100 px-4 py-2.5 text-right">Proj</th>
              <th className="border-b border-zinc-100 px-4 py-2.5">Status</th>
              {canManage && (
                <th className="border-b border-zinc-100 px-4 py-2.5">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={canManage ? 10 : 9}
                  className="px-4 py-12 text-center text-sm text-zinc-400"
                >
                  {search ? "No clients match the search." : "No clients found."}
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50"
                >
                  <td className="px-4 py-3 text-xs text-zinc-500">{c.client_number ?? c.client_code ?? "—"}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-zinc-900">{c.company_name}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">{c.contact_person ?? "—"}</td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-xs text-zinc-600">
                    {c.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-zinc-600">{c.city ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-zinc-700">
                    {c.quotationCount}
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-medium">
                    <span className={c.projectCount > 0 ? "text-amber-600" : "text-zinc-400"}>
                      {c.projectCount}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {c.is_active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                        Inactive
                      </span>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
                        >
                          Edit
                        </button>
                        {c.is_active && (
                          <button
                            type="button"
                            onClick={() => openMerge(c)}
                            className="rounded px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-50"
                          >
                            Merge
                          </button>
                        )}
                        {c.is_active ? (
                          <button
                            type="button"
                            onClick={() => void handleDelete(c)}
                            disabled={c.quotationCount > 0 || pending}
                            title={
                              c.quotationCount > 0
                                ? "Has quotations — cannot delete"
                                : "Deactivate client"
                            }
                            className={`rounded px-2 py-1 text-xs font-medium ${
                              c.quotationCount > 0
                                ? "cursor-not-allowed text-zinc-300"
                                : "text-red-600 hover:bg-red-50"
                            }`}
                          >
                            Delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handlePermanentDelete(c)}
                            disabled={c.quotationCount > 0 || c.projectCount > 0 || pending}
                            title={
                              c.quotationCount > 0
                                ? `Has ${c.quotationCount} quotation(s) — cannot delete`
                                : c.projectCount > 0
                                  ? `Has ${c.projectCount} linked project(s) — cannot delete`
                                  : "Permanently remove this client record"
                            }
                            className={`rounded border px-2 py-1 text-xs font-semibold ${
                              c.quotationCount > 0 || c.projectCount > 0
                                ? "cursor-not-allowed border-zinc-200 text-zinc-300"
                                : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                            }`}
                          >
                            Delete Permanently
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Edit Modal ──────────────────────────────────────────────────────── */}
      {editingClient && editFields && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
              <h2 className="text-base font-semibold text-zinc-950">Edit Client</h2>
              <button
                type="button"
                onClick={closeEdit}
                className="text-zinc-400 hover:text-zinc-700"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="mb-1 block text-xs font-semibold uppercase text-zinc-500">
                    Company Name *
                  </span>
                  <input
                    value={editFields.company_name}
                    onChange={(e) => setField("company_name", e.target.value)}
                    required
                    className={fieldClass()}
                  />
                </label>

                {TEXT_FIELDS.map(({ key, label }) => (
                  <label key={key}>
                    <span className="mb-1 block text-xs font-semibold uppercase text-zinc-500">
                      {label}
                    </span>
                    <input
                      value={editFields[key]}
                      onChange={(e) => setField(key, e.target.value)}
                      className={fieldClass()}
                    />
                  </label>
                ))}

                <label className="sm:col-span-2">
                  <span className="mb-1 block text-xs font-semibold uppercase text-zinc-500">
                    Notes
                  </span>
                  <textarea
                    value={editFields.notes}
                    onChange={(e) => setField("notes", e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-900/10"
                  />
                </label>
              </div>

              {modalError && (
                <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                  {modalError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-zinc-100 px-6 py-4">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={pending || !editFields.company_name.trim()}
                className="rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:bg-zinc-300"
              >
                {pending ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Merge Modal ─────────────────────────────────────────────────────── */}
      {mergingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
              <h2 className="text-base font-semibold text-zinc-950">Merge Duplicate Client</h2>
              <button
                type="button"
                onClick={closeMerge}
                className="text-zinc-400 hover:text-zinc-700"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5 space-y-4">
              <div className="rounded-md bg-zinc-50 px-4 py-3">
                <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">
                  Duplicate to remove
                </p>
                <p className="font-medium text-zinc-900">{mergingClient.company_name}</p>
                <p className="text-xs text-zinc-400">
                  {mergingClient.quotationCount} quotation
                  {mergingClient.quotationCount !== 1 ? "s" : ""}
                </p>
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">
                  Primary client (keep this one)
                </p>
                <input
                  type="text"
                  placeholder="Search clients…"
                  value={mergeSearch}
                  onChange={(e) => {
                    setMergeSearch(e.target.value);
                    setMergeTargetId("");
                  }}
                  className="mb-2 h-9 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-emerald-600"
                />
                <div className="max-h-48 overflow-y-auto rounded-md border border-zinc-200">
                  {mergeOptions.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-zinc-400">
                      No clients found.
                    </p>
                  ) : (
                    mergeOptions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setMergeTargetId(c.id)}
                        className={`flex w-full items-center justify-between border-b border-zinc-50 px-3 py-2.5 text-left text-sm transition last:border-0 hover:bg-zinc-50 ${
                          mergeTargetId === c.id
                            ? "bg-emerald-50 font-medium text-emerald-900"
                            : "text-zinc-700"
                        }`}
                      >
                        <span>{c.company_name}</span>
                        <span className="text-xs text-zinc-400">{c.quotationCount} qtns</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {mergeTargetClient && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  All quotations from <strong>{mergingClient.company_name}</strong> will be moved
                  to <strong>{mergeTargetClient.company_name}</strong>. The duplicate will be
                  deactivated. This cannot be undone.
                </div>
              )}

              {modalError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                  {modalError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-zinc-100 px-6 py-4">
              <button
                type="button"
                onClick={closeMerge}
                className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleMerge()}
                disabled={pending || !mergeTargetId}
                className="rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-600 disabled:bg-zinc-300"
              >
                {pending ? "Merging…" : "Confirm Merge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
