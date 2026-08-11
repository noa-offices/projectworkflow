"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ProductTemplateGroupReferenceType } from "@/lib/products/product-template-group-references";
import { pendingRowImageKey, type PendingProductTemplateRowImage } from "@/lib/products/smart-product-row-images";

type PendingContext = { images: Readonly<Record<string, PendingProductTemplateRowImage>>; remove: (pricingType: ProductTemplateGroupReferenceType, rowId: string) => void; replace: (pricingType: ProductTemplateGroupReferenceType, rowId: string, file: File, previewUrl: string) => void };
const Context = createContext<PendingContext | null>(null);

export function PendingRowReferenceProvider({ children, value }: { children: ReactNode; value: PendingContext }) { return <Context.Provider value={value}>{children}</Context.Provider>; }
export function usePendingRowReference(pricingType: ProductTemplateGroupReferenceType, rowId: string) {
  const context = useContext(Context);
  return context ? { image: context.images[pendingRowImageKey(pricingType, rowId)] ?? null, remove: () => context.remove(pricingType, rowId), replace: (file: File, previewUrl: string) => context.replace(pricingType, rowId, file, previewUrl) } : null;
}
