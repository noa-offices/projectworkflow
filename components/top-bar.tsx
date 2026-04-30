type TopBarProps = {
  title: string;
  description: string;
};

export function TopBar({ title, description }: TopBarProps) {
  return (
    <header className="border-b border-zinc-200 bg-white px-5 py-5 sm:px-8">
      <p className="text-sm font-medium text-emerald-900">ProjectWorkflow</p>
      <div className="mt-2 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500 sm:text-base">
          {description}
        </p>
      </div>
    </header>
  );
}
