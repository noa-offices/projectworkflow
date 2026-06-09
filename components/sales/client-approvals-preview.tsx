"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type ApprovalStatus =
  | "Sent to Client"
  | "Awaiting Approval"
  | "Revision Requested"
  | "Approved"
  | "Rejected / Lost"
  | "Ready to Convert";

type ApprovalRecord = {
  assignedTo: string;
  clientProject: string;
  followUpDate: string;
  notes: string;
  quotationNo: string;
  sentDate: string;
  status: ApprovalStatus;
  title: string;
  value: string;
};

const approvals: ApprovalRecord[] = [
  {
    quotationNo: "Q-2026-1042",
    clientProject: "Gulf Meridian / HQ refresh",
    title: "Executive office refresh package",
    status: "Awaiting Approval",
    value: "AED 185,000",
    sentDate: "05 Jun 2026",
    followUpDate: "12 Jun 2026",
    assignedTo: "Aisha Khan",
    notes: "Client requested internal approval from finance before confirming the premium workstation option.",
  },
  {
    quotationNo: "Q-2026-1039",
    clientProject: "Al Noor Clinic / Reception upgrade",
    title: "Reception and staff storage quotation",
    status: "Revision Requested",
    value: "AED 96,500",
    sentDate: "03 Jun 2026",
    followUpDate: "11 Jun 2026",
    assignedTo: "Maya Thomas",
    notes: "Client asked for alternate upholstery and a shorter delivery window for staff lockers.",
  },
  {
    quotationNo: "Q-2026-1035",
    clientProject: "WorkNest / Floor 8 expansion",
    title: "Co-working acoustic pods and benching",
    status: "Sent to Client",
    value: "AED 275,000",
    sentDate: "06 Jun 2026",
    followUpDate: "13 Jun 2026",
    assignedTo: "Maya Thomas",
    notes: "Quotation shared with procurement. Waiting for technical comparison against existing supplier.",
  },
  {
    quotationNo: "Q-2026-1031",
    clientProject: "Northbridge Academy / Campus expansion",
    title: "Campus furniture zone proposal",
    status: "Ready to Convert",
    value: "AED 410,000",
    sentDate: "29 May 2026",
    followUpDate: "10 Jun 2026",
    assignedTo: "Aisha Khan",
    notes: "Commercial approval received. Waiting for final project kickoff details before conversion.",
  },
  {
    quotationNo: "Q-2026-1028",
    clientProject: "Marina View Hotel / Lobby renovation",
    title: "Hotel lobby loose furniture",
    status: "Approved",
    value: "AED 320,000",
    sentDate: "27 May 2026",
    followUpDate: "Closed",
    assignedTo: "Omar Nasser",
    notes: "Client approved phase one package. Conversion controls will be added in the future workflow.",
  },
  {
    quotationNo: "Q-2026-1021",
    clientProject: "Private Client / Villa fit-out",
    title: "Villa joinery and loose furniture",
    status: "Rejected / Lost",
    value: "AED 140,000",
    sentDate: "20 May 2026",
    followUpDate: "Closed",
    assignedTo: "Omar Nasser",
    notes: "Client chose a residential contractor. Keep the quotation history for future relationship context.",
  },
];

const statuses = [
  "All statuses",
  "Sent to Client",
  "Awaiting Approval",
  "Revision Requested",
  "Approved",
  "Rejected / Lost",
  "Ready to Convert",
] as const;
const clients = [
  "All clients",
  "Gulf Meridian",
  "Al Noor Clinic",
  "WorkNest",
  "Northbridge Academy",
  "Marina View Hotel",
  "Private Client",
] as const;
const assignees = ["All users", "Aisha Khan", "Omar Nasser", "Maya Thomas"] as const;

function statusClassName(status: ApprovalStatus) {
  if (status === "Approved" || status === "Ready to Convert") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "Rejected / Lost") return "border-zinc-200 bg-zinc-100 text-zinc-700";
  if (status === "Revision Requested") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "Awaiting Approval") return "border-sky-200 bg-sky-50 text-sky-900";
  return "border-indigo-200 bg-indigo-50 text-indigo-900";
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-zinc-950">{value}</p>
    </section>
  );
}

export function ClientApprovalsPreview() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof statuses)[number]>("All statuses");
  const [client, setClient] = useState<(typeof clients)[number]>("All clients");
  const [assignedTo, setAssignedTo] = useState<(typeof assignees)[number]>("All users");
  const [selectedNo, setSelectedNo] = useState(approvals[0]?.quotationNo ?? "");

  const filteredApprovals = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return approvals.filter((approval) => {
      const matchesQuery =
        !normalizedQuery ||
        [
          approval.quotationNo,
          approval.clientProject,
          approval.title,
          approval.status,
          approval.value,
          approval.assignedTo,
        ].some((value) => value.toLowerCase().includes(normalizedQuery));

      return (
        matchesQuery &&
        (status === "All statuses" || approval.status === status) &&
        (client === "All clients" || approval.clientProject.toLowerCase().includes(client.toLowerCase())) &&
        (assignedTo === "All users" || approval.assignedTo === assignedTo)
      );
    });
  }, [assignedTo, client, query, status]);

  const selectedApproval =
    filteredApprovals.find((approval) => approval.quotationNo === selectedNo) ??
    filteredApprovals[0] ??
    approvals[0];

  function resetFilters() {
    setQuery("");
    setStatus("All statuses");
    setClient("All clients");
    setAssignedTo("All users");
    setSelectedNo(approvals[0]?.quotationNo ?? "");
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Awaiting Approval" value={approvals.filter((approval) => approval.status === "Awaiting Approval" || approval.status === "Sent to Client").length} />
        <SummaryCard label="Revision Requested" value={approvals.filter((approval) => approval.status === "Revision Requested").length} />
        <SummaryCard label="Approved" value={approvals.filter((approval) => approval.status === "Approved" || approval.status === "Ready to Convert").length} />
        <SummaryCard label="Rejected / Lost" value={approvals.filter((approval) => approval.status === "Rejected / Lost").length} />
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_1fr_auto]">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search quotation, client, title..."
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Approval Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as (typeof statuses)[number])}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {statuses.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Client</span>
            <select
              value={client}
              onChange={(event) => setClient(event.target.value as (typeof clients)[number])}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {clients.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Assigned To</span>
            <select
              value={assignedTo}
              onChange={(event) => setAssignedTo(event.target.value as (typeof assignees)[number])}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {assignees.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={resetFilters}
              className="h-10 w-full rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">ERP sales flow</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Enquiry &gt; Opportunity &gt; Quotation &gt; Client Approval &gt; Confirmed Project &gt; Procurement
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href="/sales/opportunities"
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Open Opportunities
            </Link>
            <Link
              href="/quotations"
              className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              Open Quotations
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.8fr)]">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Approval list</h2>
              <p className="text-sm text-zinc-500">Static local preview records for the future client approval module.</p>
            </div>
            <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              UI preview only - approval records are not updated yet.
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                  <th className="py-3 pr-4">Quotation No.</th>
                  <th className="py-3 pr-4">Client / Project</th>
                  <th className="py-3 pr-4">Quotation Title</th>
                  <th className="py-3 pr-4">Approval Status</th>
                  <th className="py-3 pr-4">Value</th>
                  <th className="py-3 pr-4">Sent Date</th>
                  <th className="py-3 pr-4">Follow-up Date</th>
                  <th className="py-3 pr-4">Assigned To</th>
                  <th className="py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredApprovals.map((approval) => (
                  <tr key={approval.quotationNo} className="border-b border-zinc-100 align-top">
                    <td className="py-3 pr-4 font-semibold text-zinc-950">{approval.quotationNo}</td>
                    <td className="py-3 pr-4 text-zinc-700">{approval.clientProject}</td>
                    <td className="max-w-sm py-3 pr-4 text-zinc-600">{approval.title}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClassName(approval.status)}`}>
                        {approval.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-medium text-zinc-950">{approval.value}</td>
                    <td className="py-3 pr-4 text-zinc-600">{approval.sentDate}</td>
                    <td className="py-3 pr-4 text-zinc-600">{approval.followUpDate}</td>
                    <td className="py-3 pr-4 text-zinc-600">{approval.assignedTo}</td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedNo(approval.quotationNo)}
                        className={[
                          "text-sm font-semibold transition",
                          selectedApproval?.quotationNo === approval.quotationNo ? "text-emerald-950" : "text-emerald-800 hover:text-emerald-950",
                        ].join(" ")}
                      >
                        Preview
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!filteredApprovals.length ? (
            <div className="mt-4 rounded-md border border-dashed border-zinc-200 p-6 text-center">
              <p className="text-sm font-semibold text-zinc-950">No approvals match these filters.</p>
              <p className="mt-1 text-sm text-zinc-500">Try clearing filters to return to the preview approval list.</p>
            </div>
          ) : null}
        </section>

        <aside className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Detail preview</p>
          {selectedApproval ? (
            <div className="mt-4 grid gap-4">
              <div>
                <h2 className="text-xl font-semibold text-zinc-950">{selectedApproval.quotationNo}</h2>
                <p className="mt-1 text-sm text-zinc-500">{selectedApproval.clientProject}</p>
              </div>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-semibold uppercase text-zinc-500">Quotation title</p>
                <p className="mt-2 text-sm font-semibold text-zinc-950">{selectedApproval.title}</p>
                <p className="mt-2 text-sm text-zinc-700">{selectedApproval.notes}</p>
              </div>
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Approval status</dt>
                  <dd className="font-medium text-zinc-950">{selectedApproval.status}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Value</dt>
                  <dd className="font-medium text-zinc-950">{selectedApproval.value}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Sent date</dt>
                  <dd className="font-medium text-zinc-950">{selectedApproval.sentDate}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-100 pb-2">
                  <dt className="text-zinc-500">Follow-up date</dt>
                  <dd className="font-medium text-zinc-950">{selectedApproval.followUpDate}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">Assigned user</dt>
                  <dd className="font-medium text-zinc-950">{selectedApproval.assignedTo}</dd>
                </div>
              </dl>
              <div className="rounded-md border border-zinc-200 p-4">
                <p className="text-sm font-semibold text-zinc-950">Planned next actions</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
                  <li>Confirm client response and revision requirements.</li>
                  <li>Update quotation status once approval workflow is implemented.</li>
                  <li>Convert approved quotation into a confirmed project in a future release.</li>
                </ul>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Link
                  href="/quotations"
                  className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
                >
                  Open Quotation
                </Link>
                <button
                  type="button"
                  disabled
                  className="h-10 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-400"
                >
                  Mark Approved
                </button>
                <button
                  type="button"
                  disabled
                  className="h-10 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-400"
                >
                  Request Revision
                </button>
                <button
                  type="button"
                  disabled
                  className="h-10 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-400"
                >
                  Convert to Project
                </button>
              </div>
              <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-950">
                Future version will save approval decisions locally first, then sync to Supabase.
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
