import { inventoryAttributionLine } from "@/lib/inventory/attribution";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, History, Package } from "lucide-react";
import { EmptyState, Pager, buttonClass } from "./inventory-ui";
import { ACTION_FORM_LABELS, actionHistoryLabel, canUseManagerMovements, movementLinkLabel, movementRoute } from "@/lib/inventory/movement-form";
import { hasMovementFilters, movementsHref, type MovementUrlState } from "@/lib/inventory/movement-history";
import { formatInventoryDate, formatInventoryNumber } from "@/lib/inventory/presentation";
import { LOCATION_LABELS, MOVEMENT_ACTIONS, type InventoryMovement, type InventoryPage } from "@/lib/inventory/types";

const control = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";

function Thumb({ movement }: { movement: InventoryMovement }) {
  return <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-100">
    {movement.main_image_url ? <Image src={movement.main_image_url} alt="" fill unoptimized className="object-cover" sizes="48px" /> : <div className="flex h-full items-center justify-center text-zinc-400"><Package size={18} aria-hidden="true" /></div>}
  </div>;
}
function ProductCell({ movement, detailHrefPrefix }: { movement: InventoryMovement; detailHrefPrefix: string }) {
  const product = movement.product;
  return <div className="flex min-w-0 items-center gap-3"><Thumb movement={movement} />
    <div className="min-w-0">
      {product ? <Link href={`${detailHrefPrefix}${product.id}`} className="inline-flex min-h-11 items-center break-words font-semibold text-zinc-950 hover:text-emerald-800">{product.item_name}</Link> : <span className="font-semibold text-zinc-950">Unknown product</span>}
      {product?.brand_name && <p className="text-sm text-zinc-600 [overflow-wrap:anywhere]">{product.brand_name}</p>}
      <p className="text-sm text-emerald-800 [overflow-wrap:anywhere]">{product?.stock_ref ?? "—"}</p>
    </div></div>;
}
const when = (movement: InventoryMovement) => <time dateTime={movement.created_at}>{formatInventoryDate(movement.created_at)}</time>;

export function MovementsView({ result, state, role, baseHref = "/inventory/movements", detailHrefPrefix = "/inventory/products/", productName }: { result: InventoryPage<InventoryMovement>; state: MovementUrlState; role: string | null; baseHref?: string; detailHrefPrefix?: string; productName?: string | null }) {
  if (!canUseManagerMovements(role)) return <p role="alert" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">You do not have permission to view movements.</p>;
  const [path, fixed] = baseHref.split("?", 2), fixedParams = [...new URLSearchParams(fixed)];
  const pages = Math.max(1, result.page_count), filtered = hasMovementFilters(state);
  return <div className="min-w-0 space-y-4">
    <header className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Movements</h1><p className="text-sm text-zinc-600">Every stock change, newest first.</p></header>
    <form method="get" action={path} aria-label="Filter movements" className="min-w-0 space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      {fixedParams.map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
      {state.product && <input type="hidden" name="product" value={state.product} />}
      <label className="block text-sm font-medium text-zinc-700">Search product<input type="search" name="q" defaultValue={state.q} maxLength={100} placeholder="Name, stock ref or item code" className={control} /></label>
      <details className="rounded-lg border border-zinc-200" open={!!(state.action||state.location||state.from||state.to||state.person)}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-zinc-800">More filters<ChevronDown size={18} aria-hidden="true" /></summary>
        <div className="border-t border-zinc-200 p-3">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="min-w-0 text-sm font-medium text-zinc-700">Action<select name="action" defaultValue={state.action} className={control}><option value="">All actions</option>{MOVEMENT_ACTIONS.map(value => <option key={value} value={value}>{actionHistoryLabel(value)} ({ACTION_FORM_LABELS[value]})</option>)}</select></label>
        <label className="min-w-0 text-sm font-medium text-zinc-700">Location<select name="location" defaultValue={state.location} className={control}><option value="">All locations</option>{Object.entries(LOCATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="min-w-0 text-sm font-medium text-zinc-700">Done by<input type="search" name="person" defaultValue={state.person} maxLength={100} placeholder="Person name" className={control} /></label>
        <label className="min-w-0 text-sm font-medium text-zinc-700">From date<input type="date" name="from" defaultValue={state.from} className={control} /></label>
        <label className="min-w-0 text-sm font-medium text-zinc-700">To date<input type="date" name="to" defaultValue={state.to} className={control} /></label>
      </div>
        </div>
      </details>
      <div className="grid grid-cols-2 gap-2"><button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white hover:bg-emerald-800">Apply filters</button>{filtered ? <Link href={baseHref} className={buttonClass.secondary}>Clear filters</Link> : <span />}</div>
      {state.product && <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-700"><span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-900">Product: {productName || "Selected product"}</span><Link href={movementsHref(state, { product: "", page: 1 }, baseHref)} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Show all products</Link></p>}
    </form>
    <p className="text-sm text-zinc-600">{formatInventoryNumber(result.total)} {result.total === 1 ? "movement" : "movements"}</p>
    {result.items.length === 0 ? <EmptyState icon={<History size={32} aria-hidden="true" />} title={filtered ? "No movements found" : "No movements yet"} text={filtered ? "Nothing matches these filters." : "Stock changes show here after the first movement."} action={filtered ? { href: baseHref, label: "Clear filters" } : { href: "/inventory/move", label: "Move stock" }} /> : <>
      <ul className="grid min-w-0 gap-3 md:hidden" aria-label="Movements">
        {result.items.map(movement => <li key={movement.id} className="min-w-0 space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm font-semibold text-emerald-900">{actionHistoryLabel(movement.action_type)}</span><span className="text-sm text-zinc-500">{when(movement)}</span></div>
          <ProductCell movement={movement} detailHrefPrefix={detailHrefPrefix} />
          <p className="text-sm text-zinc-700">{movementRoute(movement)}</p>
          <p className="text-sm font-semibold text-zinc-900">{formatInventoryNumber(movement.quantity)} {movement.quantity === 1 ? "unit" : "units"} <span className="font-normal text-zinc-500">· total {formatInventoryNumber(movement.previous_quantity)} → {formatInventoryNumber(movement.new_quantity)}</span></p>
          {movement.note && <p className="whitespace-pre-wrap text-sm text-zinc-600 [overflow-wrap:anywhere]">{movement.note}</p>}
          <p className="text-sm text-zinc-500 [overflow-wrap:anywhere]">{inventoryAttributionLine(movement.attribution ?? { creator_name: movement.actor_display_name, request: null }, "Recorded")}{movementLinkLabel(movement.linked) ? ` · ${movementLinkLabel(movement.linked)}` : ""}</p>
        </li>)}
      </ul>
      <div className="hidden min-w-0 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm md:block">
        <table className="w-full min-w-0 text-left text-sm"><caption className="sr-only">Movements</caption>
          <thead className="bg-zinc-50 text-sm uppercase tracking-wide text-zinc-500"><tr>{["When", "Product", "Action", "From → to", "Qty", "Total", "Note", "By"].map(heading => <th key={heading} scope="col" className="px-3 py-3 font-semibold">{heading}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-100">{result.items.map(movement => <tr key={movement.id} className="align-top">
            <td className="whitespace-nowrap px-3 py-3 text-zinc-600">{when(movement)}</td>
            <td className="min-w-48 px-3 py-3"><ProductCell movement={movement} detailHrefPrefix={detailHrefPrefix} /></td>
            <td className="px-3 py-3 font-medium text-zinc-900">{actionHistoryLabel(movement.action_type)}</td>
            <td className="px-3 py-3 text-zinc-700">{movementRoute(movement)}</td>
            <td className="px-3 py-3 font-semibold tabular-nums">{formatInventoryNumber(movement.quantity)}</td>
            <td className="whitespace-nowrap px-3 py-3 tabular-nums text-zinc-600">{formatInventoryNumber(movement.previous_quantity)} → {formatInventoryNumber(movement.new_quantity)}</td>
            <td className="max-w-56 px-3 py-3 text-zinc-600 [overflow-wrap:anywhere]">{movement.note || "—"}</td>
            <td className="px-3 py-3 text-zinc-600 [overflow-wrap:anywhere]">{inventoryAttributionLine(movement.attribution ?? { creator_name: movement.actor_display_name, request: null }, "Recorded")}{movementLinkLabel(movement.linked) ? <span className="block text-sm text-zinc-500">{movementLinkLabel(movement.linked)}</span> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    {pages > 1 ? <Pager label="Movement pages" page={result.page} pageCount={pages} previousHref={result.page > 1 ? movementsHref(state, { page: result.page - 1 }, baseHref) : null} nextHref={result.page < pages ? movementsHref(state, { page: result.page + 1 }, baseHref) : null} /> : null}
  </div>;
}
