import Link from "next/link";

type ModuleCardProps = {
  title: string;
  description: string;
  href: string;
};

export function ModuleCard({ title, description, href }: ModuleCardProps) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-emerald-900/25 hover:shadow-md"
    >
      <div className="flex h-full flex-col justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>
        </div>
        <span className="text-sm font-semibold text-emerald-900 transition group-hover:text-emerald-800">
          Open module
        </span>
      </div>
    </Link>
  );
}
