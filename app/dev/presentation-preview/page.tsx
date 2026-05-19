import Link from "next/link";
import { notFound } from "next/navigation";
import { QuotationPresentation } from "@/components/quotations/quotation-presentation";
import { buildMockPresentationPreviewData } from "@/lib/quotations/mock-presentation-data";

export const dynamic = "force-dynamic";

type DevPresentationPreviewPageProps = {
  searchParams: Promise<{
    case?: string;
    finishes?: string;
    layout?: string;
    scale?: string;
  }>;
};

function normalizedLayoutMode(value: string | undefined) {
  return value === "two_per_page" || value === "two" ? "two_per_page" : "single";
}

function normalizedPreviewCase(value: string | undefined) {
  return value === "no-finishes" || value === "scaled-images" ? value : null;
}

function normalizedFinishesMode(value: string | undefined, previewCase: ReturnType<typeof normalizedPreviewCase>) {
  if (previewCase === "no-finishes") return "off";
  return value === "off" ? "off" : "on";
}

function normalizedScaleMode(value: string | undefined, previewCase: ReturnType<typeof normalizedPreviewCase>) {
  if (previewCase === "scaled-images") return "zoomed";
  return value === "zoomed" ? "zoomed" : "default";
}

function hrefForVariant(
  options: {
    layout?: "single" | "two_per_page";
    previewCase?: "no-finishes" | "scaled-images" | null;
  },
) {
  const params = new URLSearchParams();
  if (options.layout === "two_per_page") params.set("layout", "two");
  if (options.previewCase) params.set("case", options.previewCase);
  const query = params.toString();
  return query ? `/dev/presentation-preview?${query}` : "/dev/presentation-preview";
}

function VariantLink({
  active,
  href,
  label,
}: {
  active: boolean;
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold transition ${
        active
          ? "border-zinc-950 bg-zinc-950 text-white"
          : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:text-zinc-950"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function DevPresentationPreviewPage({ searchParams }: DevPresentationPreviewPageProps) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const previewCase = normalizedPreviewCase(params.case);
  const layout = normalizedLayoutMode(params.layout);
  const finishes = normalizedFinishesMode(params.finishes, previewCase);
  const scale = normalizedScaleMode(params.scale, previewCase);
  const previewData = buildMockPresentationPreviewData({ finishes, layout, scale });

  return (
    <>
      <section className="print:hidden">
        <div className="mx-auto max-w-7xl px-4 py-5">
          <div className="rounded-[28px] border border-amber-200 bg-amber-50 px-5 py-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Development Preview Only</p>
            <h1 className="mt-2 text-2xl font-semibold text-zinc-950">Quotation Presentation Visual QA</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-700">
              This route uses mock presentation data only. It does not bypass auth, fetch live quotations, or save to real presentation settings.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <VariantLink active={layout === "single"} href={hrefForVariant({ layout: "single", previewCase })} label="One item per page" />
              <VariantLink active={layout === "two_per_page"} href={hrefForVariant({ layout: "two_per_page", previewCase })} label="Two items per page" />
              <VariantLink active={previewCase !== "no-finishes"} href={hrefForVariant({ layout, previewCase: null })} label="With finishes" />
              <VariantLink active={previewCase === "no-finishes"} href={hrefForVariant({ layout, previewCase: "no-finishes" })} label="Without finishes" />
              <VariantLink active={previewCase === "scaled-images"} href={hrefForVariant({ layout, previewCase: "scaled-images" })} label="Image scale examples" />
              <VariantLink active={previewCase !== "scaled-images"} href={hrefForVariant({ layout, previewCase: null })} label="Default image scale" />
              <Link
                href="#presentation-preview"
                className="inline-flex h-10 items-center rounded-full border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950"
              >
                Print preview
              </Link>
            </div>

            <p className="mt-4 text-xs text-zinc-600">
              Current mode: {layout === "two_per_page" ? "Two items per page" : "One item per page"}, finishes {finishes === "on" ? "enabled" : "hidden"}, image scale {scale === "zoomed" ? "zoomed" : "default"}.
            </p>
          </div>
        </div>
      </section>

      <div id="presentation-preview">
        <QuotationPresentation
          client={previewData.client}
          companyProfile={previewData.companyProfile}
          finishImageUrlByItemAndFinishId={previewData.finishImageUrlByItemAndFinishId}
          imageUrlByItemId={previewData.imageUrlByItemId}
          initialSettings={previewData.initialSettings}
          items={previewData.items}
          mainLayoutImageUrlById={previewData.mainLayoutImageUrlById}
          presentationOverrideImageUrlByItemId={previewData.presentationOverrideImageUrlByItemId}
          previewMode={{ disablePersistence: true, disableUploads: true }}
          project={previewData.project}
          quotation={previewData.quotation}
          sectionOverrideImageUrlBySectionAndField={previewData.sectionOverrideImageUrlBySectionAndField}
          sections={previewData.sections}
        />
      </div>
    </>
  );
}
