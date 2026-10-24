import { ReadCacheSignOut } from "@/components/local-read-cache/sign-out";
import { ReadCacheStatus } from "@/components/local-read-cache/read-status";
import { GlobalRefreshButton } from "@/components/global-refresh-button";
import { NotificationBell } from "@/components/notifications/notification-bell";

type ErpTopbarProps = {
  description: string;
  compact?: boolean;
  eyebrow?: string;
  title: string;
  userDisplayName?: string;
  userEmail?: string | null;
};

export function ErpTopbar({
  description,
  compact = false,
  eyebrow = "ProjectWorkflow",
  title,
  userDisplayName,
  userEmail,
}: ErpTopbarProps) {
  return (
    <header className={`border-b border-zinc-200 bg-white lg:px-8 lg:py-5 ${compact ? "px-3 py-1" : "px-4 py-3"}`}>
      <div className={`flex items-start justify-between ${compact ? "flex-nowrap gap-2 lg:flex-wrap lg:gap-4" : "flex-wrap gap-4"}`}>
        <div>
          <p className="hidden text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 lg:block">{eyebrow}</p>
          <h1 className={`font-semibold text-zinc-950 lg:mt-2 lg:text-3xl ${compact ? "text-base leading-[2.75rem] lg:leading-normal" : "text-lg"}`}>{title}</h1>
          <p className="mt-2 hidden max-w-3xl text-sm leading-6 text-zinc-600 lg:block">{description}</p>
        </div>
        {userDisplayName ? (
          <div className="flex items-center gap-2 text-sm lg:gap-3 lg:rounded-lg lg:border lg:border-zinc-200 lg:bg-zinc-50 lg:px-4 lg:py-3">
            <GlobalRefreshButton responsiveCompact />
            <ReadCacheStatus />
            <NotificationBell />
            <div className="hidden min-w-0 text-right lg:block">
              <p className="truncate font-semibold text-zinc-950">{userDisplayName}</p>
              {userEmail ? <p className="mt-1 truncate text-xs text-zinc-500">{userEmail}</p> : null}
            </div>
            <ReadCacheSignOut />
          </div>
        ) : null}
      </div>
    </header>
  );
}
