import { signOut } from "@/app/auth/actions";
import { GlobalRefreshButton } from "@/components/global-refresh-button";

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
    <header className="border-b border-zinc-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">{eyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950 sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{description}</p>
        </div>
        {userDisplayName ? (
          <div className="flex flex-col items-stretch gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm sm:flex-row sm:items-center">
            <GlobalRefreshButton />
            <div className="min-w-0 text-right">
              <p className="truncate font-semibold text-zinc-950">{userDisplayName}</p>
              {userEmail ? <p className="mt-1 truncate text-xs text-zinc-500">{userEmail}</p> : null}
            </div>
            <form action={signOut}>
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
