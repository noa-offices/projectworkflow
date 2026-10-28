import assert from 'node:assert/strict';
import test, {mock} from 'node:test';
import {createClient as supabaseClient} from '@supabase/supabase-js';
let role = 'admin_manager', status='active';
const calls: Array<{url:URL;method:string;body:Record<string,unknown>|null}> = [];
const invalidations: string[]=[];
let clients=0, fail=false;
const client=supabaseClient('https://inventory.test','test-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
  const url=new URL(String(input)),method=init?.method ?? 'GET';
  calls.push({url,method,body:init?.body ? JSON.parse(String(init.body)):null});
  if(fail) return Response.json({message:'private database failure'},{status:500});
  if(url.pathname.includes('/rpc/')) return Response.json([{product_count:2,movement_count:3}]);
  return new Response(null,{headers:{'Content-Range':'*/4'}});
}}});
mock.module('server-only',{namedExports:{}});
mock.module('@/lib/auth',{namedExports:{requireInventoryUser:async()=>({user:{id:'self'},profile:role ? {role,account_status:status}:null})}});
mock.module('@/lib/supabase/server',{namedExports:{createClient:async()=>{clients++;return client;}}});
mock.module('next/cache',{namedExports:{revalidatePath:(path:string)=>invalidations.push(path)}});
const actions=await import('./request-history-actions');
const reset=()=>{role='admin_manager';status='active';calls.length=0;invalidations.length=0;clients=0;fail=false;};

test('all history actions reject nonmanagers and inactive profiles before any database access',async()=>{
  for(const nextRole of ['procurement_manager','sales_designer','sales_coordinator','designer','viewer','warehouse_staff','']) {
    reset();role=nextRole;
    for(const action of [()=>actions.countFinishedRequests({kind:'all',olderThanDays:0}),()=>actions.clearFinishedRequests({kind:'all',olderThanDays:0}),()=>actions.restoreClearedRequests({kind:'all'})]) assert.equal((await action()).ok,false);
    assert.equal(clients,0);
  }
  for(const nextStatus of ['disabled','pending']) {reset();status=nextStatus;assert.equal((await actions.clearFinishedRequests({kind:'all',olderThanDays:0})).ok,false);assert.equal(clients,0);}
});
test('count is read-only, finished-only and uses the selected scope and cutoff',async()=>{
  reset();const result=await actions.countFinishedRequests({kind:'movement',olderThanDays:30});
  assert.deepEqual(result,{ok:true,count:4});assert.equal(calls.length,1);assert.equal(calls[0].method,'HEAD');
  const url=calls[0].url;assert.ok(url.pathname.endsWith('/movement_requests'));assert.equal(url.searchParams.get('request_status'),'in.(approved,rejected)');assert.equal(url.searchParams.get('cleared_at'),'is.null');assert.ok(url.searchParams.get('reviewed_at')?.startsWith('lte.'));assert.deepEqual(invalidations,[]);
});
test('clear and individual/bulk restore call only the guarded RPC and invalidate affected pages',async()=>{
  reset();assert.deepEqual(await actions.clearFinishedRequests({kind:'product',olderThanDays:0}),{ok:true,count:5});
  assert.deepEqual(calls[0].body,{p_kind:'product',p_before:null});assert.ok(calls[0].url.pathname.endsWith('/clear_finished_requests'));
  assert.ok(invalidations.includes('/inventory/requests'));assert.ok(invalidations.includes('/inventory'));assert.ok(invalidations.includes('/inventory/products'));
  reset();await actions.restoreClearedRequests({kind:'movement',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});assert.ok(calls[0].url.pathname.endsWith('/restore_cleared_request'));assert.deepEqual(calls[0].body,{p_kind:'movement',p_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  reset();await actions.restoreClearedRequests({kind:'all'});assert.ok(calls[0].url.pathname.endsWith('/restore_cleared_requests'));
});
test('invalid scope, age or row id never reaches the database and errors do not leak details',async()=>{
  reset();assert.equal((await actions.clearFinishedRequests({kind:'evil',olderThanDays:0} as never)).ok,false);assert.equal(clients,0);
  assert.equal((await actions.restoreClearedRequests({kind:'all',id:'bad'})).ok,false);assert.equal(clients,0);
  fail=true;const result=await actions.clearFinishedRequests({kind:'all',olderThanDays:0});assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes('private database'));assert.deepEqual(invalidations,[]);
});
