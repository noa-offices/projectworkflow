"use client";

import { createContext, useContext, type ReactNode } from "react";
import { pendingSubgroupImageKey, type PendingProductTemplateSubgroupImage } from "@/lib/products/smart-product-row-images";
import type { ProductTemplateGroupReferenceType } from "@/lib/products/product-template-group-references";

type ContextValue = { images: Readonly<Record<string, PendingProductTemplateSubgroupImage>>; remove: (pricingType: ProductTemplateGroupReferenceType, groupId: string, subgroupId: string) => void; replace: (pricingType: ProductTemplateGroupReferenceType, groupId: string, subgroupId: string, file: File, previewUrl: string) => void };
const Context = createContext<ContextValue | null>(null);
export function PendingSubgroupReferenceProvider({ children, value }: { children: ReactNode; value: ContextValue }) { return <Context.Provider value={value}>{children}</Context.Provider>; }
export function usePendingSubgroupReference(pricingType: ProductTemplateGroupReferenceType, groupId: string, subgroupId: string) { const context = useContext(Context); return context ? { image: context.images[pendingSubgroupImageKey(pricingType, groupId, subgroupId)] ?? null, remove: () => context.remove(pricingType, groupId, subgroupId), replace: (file: File, previewUrl: string) => context.replace(pricingType, groupId, subgroupId, file, previewUrl) } : null; }
