"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ClipboardList, Plus, Search } from "lucide-react";
import { canManageInventory, canSubmitAddTake } from "@/lib/inventory/access";
import { reviewMovementRequest, reviewProductRequest } from "@/lib/inventory/actions";
import { dimensionLabel, formatInventoryDate, formatInventoryNumber, inventoryLabel, inventoryOptionalText, orderedProductImages } from "@/lib/inventory/presentation";
import { reviewRequestPayload } from "@/lib/inventory/request-presentation";
import { loadProductRequestImages } from "@/lib/inventory/request-reads";
import { LOCATION_LABELS, type InventoryImage, type InventoryMovementRequest, type InventoryProductRequest, type InventoryBrand, type InventoryCategoryNode } from "@/lib/inventory/types";
import { ProductImageGallery } from "./product-image-gallery";
import { EmptyState, Pager, chipClass } from "./inventory-ui";
import { RequestDialog } from "./request-dialog";
import { ProductRequestForm } from './product-request-form';
import { saveFailureMessage } from "@/lib/inventory/save-errors";

type Request = InventoryProductRequest | InventoryMovementRequest;
type Tab = "products" | "movements";
type Status = "pending_review" | "approved" | "rejected" | "all";
type Props = { q?: string; products: InventoryProductRequest[]; movements: InventoryMovementRequest[]; tab: Tab; status: Status; mine: boolean; userId: string; role: string | null; page: number; pageCount: number; total: number; preview?: boolean; previewImages?: InventoryImage[]; brands?: InventoryBrand[]; categories?: InventoryCategoryNode[] };
const controlBase = "inline-flex min-h-11 items-center justify-center rounded-lg border font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50";
const buttonBase = `${controlBase} px-4 py-2.5 text-sm`;
const button = `${buttonBase} border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50`;
const primary = `${buttonBase} border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800`;
const field = "mt-1 w-full min-w-0 rounded-lg border border-zinc-300 bg-white p-3 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100";
const isProduct = (request: Request): request is InventoryProductRequest => "item_name" in request;
const requestName = (request: Request) => isProduct(request) ? request.item_name : request.product?.item_name || "Unknown product";
const statusLabel = (value: Status) => value === "pending_review" ? "Pending" : value === "all" ? "All" : inventoryLabel(value);

function StatusBadge({ status }: { status: Status }) {
  const color = status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : status === "rejected" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-950";
  return <span className={`rounded-full border px-2.5 py-1 text-sm font-semibold ${color}`}>{statusLabel(status)}</span>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-sm text-zinc-500">{label}</dt><dd className="mt-1 text-sm font-medium text-zinc-900 [overflow-wrap:anywhere]">{children || "Not specified"}</dd></div>;
}
function RequestLocations({ request }: { request: Request }) {
  if (isProduct(request)) return <p className="text-sm text-zinc-600">Initial stock: {Object.entries(request.initial_stock ?? {warehouse:request.quantity}).filter(([,count]) => count > 0).map(([key,count]) => `${LOCATION_LABELS[key as keyof typeof LOCATION_LABELS]} ${count}`).join(', ')}</p>;
  return <p className="text-sm text-zinc-600 [overflow-wrap:anywhere]">{request.from_location ? LOCATION_LABELS[request.from_location] : "No source specified"}{request.to_location ? ` → ${LOCATION_LABELS[request.to_location]}` : ""}</p>;
}
function ReservationRequestDetails({request}: {request:Request}) {
  if (isProduct(request) || !['hold','book'].includes(request.request_type)) return null;
  return <div className="mt-3 space-y-1 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 [overflow-wrap:anywhere]">
    <p><span className="font-semibold">Project / reference:</span> {request.project_label || request.reference_note || 'Not specified'}</p>
    {request.project_label && request.reference_note && <p>{request.reference_note}</p>}
    {request.expires_at && <p><span className="font-semibold">Hold until:</span> {formatInventoryDate(request.expires_at)}</p>}
  </div>;
}

function RequestDetails({ request, preview, previewImages, onClose }: { request: Request; preview: boolean; previewImages?: InventoryImage[]; onClose: () => void }) {
  const product = isProduct(request) ? request : null;
  const movement = isProduct(request) ? null : request;
  const [images, setImages] = useState<InventoryImage[] | null>(product && preview ? previewImages ?? [] : null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!product || preview) return;
    let active = true;
    void loadProductRequestImages(product.id).then(result => {
      if (!active) return;
      if (result.ok) setImages(result.images); else setError(result.error);
    }).catch(() => { if (active) setError("Photos could not be loaded. Please try again."); });
    return () => { active = false; };
  }, [product, preview, attempt]);
  return <RequestDialog title="Request details" onClose={onClose}>
    <div className="space-y-5">
      <div><h3 className="text-lg font-semibold text-zinc-950 [overflow-wrap:anywhere]">{requestName(request)}</h3><p className="mt-1 text-sm text-zinc-500">{inventoryOptionalText(isProduct(request) ? request.item_code : request.product?.item_code)}</p><div className="mt-3 flex flex-wrap gap-2"><StatusBadge status={request.request_status} /><span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-semibold text-zinc-700">{product ? "Add item" : inventoryLabel((request as InventoryMovementRequest).request_type)}</span></div></div>
      {product ? images ? <ProductImageGallery images={orderedProductImages(images)} productName={product.item_name} /> : error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><p>{error}</p><button type="button" className={`${button} mt-3`} onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry photos</button></div> : <p role="status" className="text-sm text-zinc-500">Loading photos…</p> : null}
      <dl className="grid min-w-0 grid-cols-2 gap-4">
        <Field label="Quantity">{formatInventoryNumber(request.quantity)}</Field><Field label="Submitted by">{request.submitter_display_name || "Unknown"}</Field>
        <Field label="Submitted">{formatInventoryDate(request.submitted_at)}</Field>
        {product ? <><Field label="Brand">{product.brand_name}</Field><Field label="Category">{product.custom_category_name || product.category_name}</Field><Field label="Subcategory">{product.subcategory_name}</Field><Field label="Stock reference">{inventoryOptionalText(product.stock_ref)}</Field><Field label="Model">{inventoryOptionalText(product.model_name)}</Field><Field label="Item type">{inventoryLabel(product.item_type)}</Field><Field label="Requested status">{inventoryLabel(product.requested_status)}</Field><Field label="Condition">{inventoryLabel(product.condition)}</Field><Field label="Source">{inventoryLabel(product.source)}</Field><Field label="Dimensions (L × W × H)">{dimensionLabel(product)}</Field></> : <><Field label="Item code">{inventoryOptionalText(movement?.product?.item_code)}</Field><Field label="Stock reference">{inventoryOptionalText(movement?.product?.stock_ref)}</Field><Field label="Model">{inventoryOptionalText(movement?.product?.model_name)}</Field></>}
      </dl>
      <RequestLocations request={request} />
      <ReservationRequestDetails request={request} />
      {product?.description ? <div><h4 className="text-sm font-semibold text-zinc-900">Description</h4><p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 [overflow-wrap:anywhere]">{product.description}</p></div> : null}
      {request.note ? <div><h4 className="text-sm font-semibold text-zinc-900">Note</h4><p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 [overflow-wrap:anywhere]">{request.note}</p></div> : null}
      {product?.costs ? <section className="rounded-lg border border-zinc-200 p-3"><h4 className="text-sm font-semibold text-zinc-900">Cost breakdown</h4><dl className="mt-3 grid grid-cols-2 gap-3">{Object.entries(product.costs).map(([key, value]) => <Field key={key} label={inventoryLabel(key)}>{value.toFixed(2)}</Field>)}</dl></section> : null}
      {request.reviewed_at ? <div className="rounded-lg bg-zinc-50 p-3"><p className="text-sm font-semibold text-zinc-900">Reviewed {formatInventoryDate(request.reviewed_at)}</p><p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 [overflow-wrap:anywhere]">{request.review_note || "No review note recorded."}</p></div> : null}
      <button type="button" className={`${button} w-full`} onClick={onClose}>Close details</button>
    </div>
  </RequestDialog>;
}

function ProductReviewDialog({request, props, onClose, onSuccess}: {request:InventoryProductRequest;props:Props;onClose:()=>void;onSuccess:(message:string)=>void}) {
  const [images,setImages] = useState<InventoryImage[] | null>(props.preview ? props.previewImages ?? [] : null);
  const [error,setError] = useState(''), [attempt,setAttempt] = useState(0), [busy,setBusy] = useState(false);
  useEffect(() => {
    if (props.preview) return;
    let active = true;
    void loadProductRequestImages(request.id).then(result => {if (!active) return; if (result.ok) setImages(result.images); else setError(result.error);}).catch(() => {if (active) setError('Photos could not be loaded.');});
    return () => {active = false;};
  },[request.id,props.preview,attempt]);
  return <RequestDialog title="Review and approve" onClose={onClose} busy={busy} fullScreen>{images ? <ProductRequestForm brands={props.brands ?? []} categories={props.categories ?? []} role={props.role} preview={props.preview} request={request} images={images} onCancel={onClose} onBusyChange={setBusy} onApproved={() => onSuccess(props.preview ? 'Preview: request approved. No changes were saved.' : 'Request approved.')} /> : error ? <div role="alert"><p>{error}</p><button type="button" className={button} onClick={() => {setError('');setAttempt(value => value + 1);}}>Retry photos</button></div> : <p role="status">Loading photos…</p>}</RequestDialog>;
}

function ReviewDialog({ request, decision, preview, onClose, onSuccess }: { request: Request; decision: "approved" | "rejected"; preview: boolean; onClose: () => void; onSuccess: (message: string) => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const approving = decision === "approved";
  const noStock = !isProduct(request) && (request.request_type === "hold" || request.request_type === "book");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    let payload;
    try { payload = reviewRequestPayload(request.id, decision, note); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check your review note."); return; }
    submitting.current = true;
    setBusy(true);
    try {
      if (preview) { onSuccess(`Preview: request ${decision}. No changes were saved.`); return; }
      const result = await (isProduct(request) ? reviewProductRequest(payload) : reviewMovementRequest(payload));
      if (!result.ok) { setError(result.error); return; }
      onSuccess(`Request ${decision}.`);
    } catch (failure) { setError(saveFailureMessage(failure)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <RequestDialog title={approving ? "Approve request" : "Reject request"} busy={busy} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <div><h3 className="font-semibold text-zinc-950 [overflow-wrap:anywhere]">{requestName(request)}</h3><p className="mt-1 text-sm text-zinc-600">{formatInventoryNumber(request.quantity)} units · {isProduct(request) ? "Add item" : inventoryLabel(request.request_type)}</p></div>
      <ReservationRequestDetails request={request} />
      <p className="text-sm leading-6 text-zinc-600">{approving ? noStock ? "Approving reserves these units. Availability is checked again before the reservation is created." : isProduct(request) ? "Approving adds this item to inventory." : "Approving applies this stock movement." : "Reject this request? The submitter can see your review note."}</p>
      <label className="block text-sm font-medium text-zinc-700" htmlFor="request-review-note">Review note {approving ? "(optional)" : "(required)"}<textarea id="request-review-note" value={note} onChange={event => setNote(event.target.value)} rows={4} maxLength={2000} required={!approving} disabled={busy} aria-invalid={!!error} aria-describedby={error ? "request-review-error" : undefined} className={field} /></label>
      {error ? <p id="request-review-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 [overflow-wrap:anywhere]">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3"><button type="button" className={button} disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className={approving ? primary : `${buttonBase} border-red-700 bg-red-700 text-white hover:bg-red-800`} disabled={busy}>{busy ? "Saving…" : approving ? "Approve" : "Reject"}</button></div>
    </form>
  </RequestDialog>;
}

export function RequestsView(props: Props) {
  const { products, movements, tab, status, mine, userId, role, page, pageCount, total, preview = false } = props, q = props.q ?? "";
  const router = useRouter();
  const [details, setDetails] = useState<Request | null>(null);
  const [review, setReview] = useState<{ request: Request; decision: "approved" | "rejected" } | null>(null);
  const [message, setMessage] = useState("");
  const manager = canManageInventory(role);
  function href(patch: Partial<{ tab: Tab; status: Status; mine: boolean; page: number; q: string }> = {}) {
    const next = { tab, status, mine, q, page: 1, ...patch };
    const query = new URLSearchParams(preview ? `view=requests&frame=1&role=${encodeURIComponent(role ?? '')}` : "");
    query.set("tab", next.tab); query.set("status", next.status);
    if (next.mine) query.set("mine", "1");
    if (next.q) query.set("q", next.q);
    if (next.page > 1) query.set("page", String(next.page));
    return `${preview ? "/dev/inventory-preview" : "/inventory/requests"}?${query}`;
  }
  const requests: Request[] = tab === "products" ? products : movements;
  return <div className="min-w-0 space-y-4">
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Requests</h1><p className="mt-1 text-sm text-zinc-500">Track new items and stock requests.</p></div>{manager || canSubmitAddTake(role) ? <Link href={preview ? `/dev/inventory-preview?view=new-product&frame=1&role=${encodeURIComponent(role ?? "")}` : "/inventory/requests/new-product"} className={primary}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Add item</Link> : null}</header>
    {message ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">{message}</p> : null}
    <nav aria-label="Request types" className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-200 bg-white p-1">{(["products", "movements"] as const).map(value => <Link key={value} href={href({ tab: value })} aria-current={tab === value ? "page" : undefined} className={`${controlBase} border-transparent px-2 py-2.5 text-center text-sm ${tab === value ? "bg-emerald-50 text-emerald-900 hover:bg-emerald-100" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}>{value === "products" ? "Product requests" : "Movement requests"}</Link>)}</nav>
    <form method="get" action={preview ? "/dev/inventory-preview" : "/inventory/requests"} role="search" aria-label="Search requests" className="min-w-0 space-y-1">
      {preview ? <><input type="hidden" name="view" value="requests" /><input type="hidden" name="frame" value="1" /><input type="hidden" name="role" value={role ?? ""} /></> : null}
      <input type="hidden" name="tab" value={tab} /><input type="hidden" name="status" value={status} />{mine ? <input type="hidden" name="mine" value="1" /> : null}
      <div className="flex min-w-0 items-center gap-1 rounded-lg border border-zinc-300 bg-white pl-3 focus-within:border-emerald-700 focus-within:ring-2 focus-within:ring-emerald-100">
        <label htmlFor="request-search" className="sr-only">Search requests</label>
        <input id="request-search" type="search" inputMode="search" enterKeyHint="search" name="q" defaultValue={q} maxLength={100} placeholder="Search requests" aria-describedby="request-search-help" className="min-h-11 w-0 min-w-0 flex-1 bg-transparent text-base outline-none" />
        <button type="submit" aria-label="Search" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-emerald-900 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-700"><Search size={18} aria-hidden="true" /></button>
      </div>
      <p id="request-search-help" className="text-sm text-zinc-600">{manager ? "Search by product, stock ref, item code, model or person." : "Search by product, stock ref, item code or model."}</p>
      {q ? <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-700"><span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-900 [overflow-wrap:anywhere]">Search: {q}</span><Link href={href({ q: "" })} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Clear search</Link></p> : null}
    </form>
    <section aria-label="Filter requests" className="space-y-2">
      <nav aria-label="Request status" className="grid grid-cols-4 gap-1 rounded-lg border border-zinc-200 bg-white p-1">{(["pending_review", "approved", "rejected", "all"] as const).map(value => <Link key={value} href={href({ status: value })} aria-current={status === value ? "page" : undefined} className={`${controlBase} border-transparent px-1 py-2 text-sm ${status === value ? "bg-emerald-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}>{statusLabel(value)}</Link>)}</nav>
      <Link href={href({ mine: !mine })} aria-current={mine ? "page" : undefined} className={chipClass(mine)}><span aria-hidden="true" className="font-bold">{mine ? "✓" : "+"}</span>My requests</Link>
    </section>
    <p className="text-sm text-zinc-500">{formatInventoryNumber(total)} {total === 1 ? "request" : "requests"}{mine ? " submitted by you" : ""}</p>
    {requests.length ? <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">{requests.map(request => {
      const own = !manager && request.submitted_by === userId;
      return <article key={request.id} className={`min-w-0 rounded-lg border bg-white p-4 shadow-sm ${own ? "border-emerald-300" : "border-zinc-200"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold uppercase tracking-wide text-emerald-800">{isProduct(request) ? "Add item" : inventoryLabel(request.request_type)}</span><StatusBadge status={request.request_status} /></div>
        <h2 className="mt-3 text-base font-semibold text-zinc-950 [overflow-wrap:anywhere]">{requestName(request)}</h2>
        <p className="mt-1 text-sm text-zinc-500 [overflow-wrap:anywhere]">{inventoryOptionalText(isProduct(request) ? request.item_code : request.product?.item_code)} · {inventoryOptionalText(isProduct(request) ? request.model_name : request.product?.model_name)}</p>
        <p className="mt-3 text-sm font-semibold text-zinc-900">{formatInventoryNumber(request.quantity)} units</p><div className="mt-1"><RequestLocations request={request} /></div><ReservationRequestDetails request={request} />
        {request.note ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-600 [overflow-wrap:anywhere]">{request.note}</p> : null}
        <div className="mt-4 border-t border-zinc-100 pt-3"><p className="text-sm text-zinc-700 [overflow-wrap:anywhere]">{request.submitter_display_name || "Unknown"}{own ? <span className="ml-2 rounded-full bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-900">Your request</span> : null}</p><p className="mt-1 text-sm leading-5 text-zinc-500"><time dateTime={request.submitted_at}>{formatInventoryDate(request.submitted_at)}</time></p></div>
        {request.reviewed_at || request.request_status !== "pending_review" ? <div className="mt-3 rounded-lg bg-zinc-50 p-3"><p className="text-sm font-semibold text-zinc-700">Review note</p><p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 [overflow-wrap:anywhere]">{request.review_note || "No review note recorded."}</p></div> : null}
        <button type="button" className={`${button} mt-4 w-full`} onClick={() => setDetails(request)}>View details</button>
        {manager && request.request_status === "pending_review" ? <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" className={primary} onClick={() => { setMessage(""); setReview({ request, decision: "approved" }); }}>{isProduct(request) ? 'Review and approve' : 'Approve'}</button><button type="button" className={`${button} text-red-700`} onClick={() => { setMessage(""); setReview({ request, decision: "rejected" }); }}>Reject</button></div> : null}
      </article>;
    })}</div> : <EmptyState icon={<ClipboardList size={32} aria-hidden="true" />} title="No requests found" text={q ? "Nothing matches your search." : "No requests with these filters."} action={{ href: href({ status: "all", mine: false, q: "" }), label: "Show all requests" }} />}
    {pageCount > 1 ? <Pager label="Request pages" page={page} pageCount={pageCount} previousHref={page > 1 ? href({ page: page - 1 }) : null} nextHref={page < pageCount ? href({ page: page + 1 }) : null} /> : null}
    {details ? <RequestDetails request={details} preview={preview} previewImages={props.previewImages} onClose={() => setDetails(null)} /> : null}
    {review ? isProduct(review.request) && review.decision === 'approved' ? <ProductReviewDialog request={review.request} props={props} onClose={() => setReview(null)} onSuccess={text => {setReview(null);setMessage(text);if (!preview) router.refresh();}} /> : <ReviewDialog request={review.request} decision={review.decision} preview={preview} onClose={() => setReview(null)} onSuccess={text => { setReview(null); setMessage(text); if (!preview) router.refresh(); }} /> : null}
  </div>;
}
