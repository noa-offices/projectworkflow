import { signOut } from "@/app/auth/actions";

type TopBarProps = {
  title: string;
  description: string;
  userDisplayName?: string;
  userEmail?: string;
};

export function TopBar({
  title,
  description,
  userDisplayName,
  userEmail,
}: TopBarProps) {
  return (
    <header className="border-b border-zinc-200 bg-white px-5 py-5 sm:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-900">ProjectWorkflow</p>
          <div className="mt-2 max-w-3xl">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
              {title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-500 sm:text-base">
              {description}
            </p>
          </div>
        </div>
        {userDisplayName ? (
          <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="min-w-0 text-right">
              <p className="truncate text-sm font-medium text-zinc-950">
                {userDisplayName}
              </p>
              {userEmail ? (
                <p className="truncate text-xs text-zinc-500">{userEmail}</p>
              ) : null}
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
