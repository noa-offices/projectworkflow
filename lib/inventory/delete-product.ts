export type ProductDeleteSummary = {stock_ref:string;photos:number;movements:number;reservations:number};
export function deleteConfirmationMatches(typed: string, stockRef: string): boolean { return stockRef.length>0 && typed===stockRef; }
export function deletedProductHref(failedPhotoCount: number): string {
 return `/inventory/products?deleted=1${failedPhotoCount>0 ? `&photoCleanup=${failedPhotoCount}` : ""}`;
}
export function deletedProductMessage(failedPhotoCount: number): string {
 return failedPhotoCount>0 ? `Item deleted, ${failedPhotoCount} ${failedPhotoCount===1 ? "photo" : "photos"} could not be removed.` : "Item deleted.";
}
