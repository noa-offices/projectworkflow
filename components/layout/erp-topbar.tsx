import { signOut } from "@/app/auth/actions";
import { GlobalRefreshButton } from "@/components/global-refresh-button";
import { NotificationBell } from "@/components/notifications/notification-bell";

type ErpTopbarProps = {
  description: string;
  eyebrow?: string;
  title: string;
  userDisplayName?: string;
  userEmail?: string | null;
};

export function ErpTopbar({
  description,
  eyebrow = "ProjectWorkflow",
  title,
  userDisplayName,
  userEmail,
}: ErpTopbarProps) {
  return (
    <header className="border-b border-zinc-200 bg-white px-4 py-3 lg:px-8 lg:py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="hidden text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 lg:block">{eyebrow}</p>
          <h1 className="text-lg font-semibold text-zinc-950 lg:mt-2 lg:text-3xl">{title}</h1>
          <p className="mt-2 hidden max-w-3xl text-sm leading-6 text-zinc-600 lg:block">{description}</p>
        </div>
        {userDisplayName ? (
          <div className="flex items-center gap-2 text-sm lg:gap-3 lg:rounded-lg lg:border lg:border-zinc-200 lg:bg-zinc-50 lg:px-4 lg:py-3">
            <GlobalRefreshButton responsiveCompact />
            <NotificationBell />
            <div className="hidden min-w-0 text-right lg:block">
              <p className="truncate font-semibold text-zinc-950">{userDisplayName}</p>
              {userEmail ? <p className="mt-1 truncate text-xs text-zinc-500">{userEmail}</p> : null}
            </div>
            <form action={signOut} className="hidden lg:block">
              <button
                type="submit"
                className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </header>
  );
}
