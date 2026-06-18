"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { SendNotificationForm } from "@/components/notifications/send-notification-form";

export function NotifyButton({ orderNo }: { orderNo: string }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        <Bell className="h-4 w-4" strokeWidth={2} />
        Notify
      </button>

      {showForm && (
        <SendNotificationForm
          initialOrderNo={orderNo}
          onClose={() => setShowForm(false)}
          onSent={() => setShowForm(false)}
        />
      )}
    </>
  );
}
