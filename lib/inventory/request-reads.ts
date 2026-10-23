'use server';

import { uuid } from './action-validation';
import { getProductRequestImages } from './queries';
import type { InventoryImage } from './types';

export async function loadProductRequestImages(requestId: string): Promise<{ok:true;images:InventoryImage[]}|{ok:false;error:string}> {
  // Authentication and role checks run in the query; the signed-in client keeps RLS.
  const id = uuid(requestId);
  try { return {ok:true, images:await getProductRequestImages(id)}; }
  catch { return {ok:false,error:'Unable to load request photos. Please try again.'}; }
}
