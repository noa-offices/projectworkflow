"use client";

import { createContext, useContext, type ReactNode } from "react";
import { pendingSubgroupImageKey, type PendingProductTemplateSubgroupImage } from "@/lib/products/smart-product-row-images";

type ContextValue = { images: Readonly<Record<string, PendingProductTemplateSubgroupImage>>; remove: (subgroupId: string) => void; replace: (subgroupId: string, file: File, previewUrl: string) => void };
const Context = createContext<ContextValue | null>(null);
export function PendingSubgroupReferenceProvider({ children, value }: { children: ReactNode; value: ContextValue }) { return <Context.Provider value={value}>{children}</Context.Provider>; }
export function usePendingSubgroupReference(subgroupId: string) { const context = useContext(Context); return context ? { image: context.images[pendingSubgroupImageKey("base_model", subgroupId)] ?? null, remove: () => context.remove(subgroupId), replace: (file: File, previewUrl: string) => context.replace(subgroupId, file, previewUrl) } : null; }
