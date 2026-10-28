"use server";

import { revalidatePath } from 'next/cache';
import { requireInventoryUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { canManageInventory } from './access';
import { code, object, uuid, InventoryInputError, invalid } from './action-validation';
import { historyInput, historyCutoff, historyCount, type HistoryInput } from './request-history';

type Result = {ok:true;count:number} | {ok:false;error:string};
const denied = (): Result => ({ok:false,error:'You do not have permission to do that.'});
async function manager() {
  const {profile} = await requireInventoryUser();
  return profile?.account_status === 'active' && canManageInventory(profile.role);
}
async function perform(work:()=>Promise<number>):Promise<Result> {
  try {return {ok:true,count:await work()};}
  catch(error) {return {ok:false,error:error instanceof InventoryInputError ? error.message : 'Unable to update request history. Please try again.'};}
}
function refresh() {
  revalidatePath('/inventory/requests');
  revalidatePath('/inventory');
  revalidatePath('/inventory/products');
  revalidatePath('/inventory/products/[id]', 'page');
}

/** Read-only exact count using the same finished/status/cutoff predicates as the RPC. */
export async function countFinishedRequests(input:HistoryInput):Promise<Result> {
  if (!await manager()) return denied();
  return perform(async()=>{
    const {kind,olderThanDays}=historyInput(input),before=historyCutoff(olderThanDays);
    const client=await createClient();
    const tables = kind === 'product' ? ['product_requests'] : kind === 'movement' ? ['movement_requests'] : ['product_requests','movement_requests'];
    const counts=await Promise.all(tables.map(async table=>{
      let query=client.schema('inventory').from(table).select('id',{head:true,count:'exact'}).in('request_status',['approved','rejected']).is('cleared_at',null);
      if(before) query=query.lte('reviewed_at',before);
      const {count,error}=await query;
      if(error || count==null) throw new Error('Count failed');
      return count;
    }));
    return counts.reduce((sum,count)=>sum+count,0);
  });
}
export async function countClearedRequests(kind:'product'|'movement'|'all'='all'):Promise<Result> {
  if (!await manager()) return denied();
  return perform(async()=>{
    const selected=code(kind,['product','movement','all'],'request kind');
    const client=await createClient();
    const tables=selected==='product'?['product_requests']:selected==='movement'?['movement_requests']:['product_requests','movement_requests'];
    const counts=await Promise.all(tables.map(async table=>{
      const {count,error}=await client.schema('inventory').from(table).select('id',{head:true,count:'exact'}).not('cleared_at','is',null);
      if(error || count==null) throw new Error('Count failed');
      return count;
    }));
    return counts.reduce((sum,count)=>sum+count,0);
  });
}
export async function clearFinishedRequests(input:HistoryInput):Promise<Result> {
  if (!await manager()) return denied();
  return perform(async()=>{
    const {kind,olderThanDays}=historyInput(input);
    const {data,error}=await (await createClient()).schema('inventory').rpc('clear_finished_requests',{p_kind:kind,p_before:historyCutoff(olderThanDays)});
    if(error) throw error;
    const count=historyCount(data);refresh();return count;
  });
}
export async function restoreClearedRequests(input:{kind:'product'|'movement'|'all';id?:string}):Promise<Result> {
  if (!await manager()) return denied();
  return perform(async()=>{
    const value=object(input),kind=code(value.kind,['product','movement','all'],'request kind');
    if(value.id!==undefined && kind==='all') invalid('Choose a request type to restore one request.');
    const id=value.id===undefined?null:uuid(value.id);
    const client=await createClient();
    const {data,error}=await client.schema('inventory').rpc(id?'restore_cleared_request':'restore_cleared_requests',id?{p_kind:kind,p_id:id}:{p_kind:kind});
    if(error) throw error;
    const count=historyCount(data);refresh();return count;
  });
}
