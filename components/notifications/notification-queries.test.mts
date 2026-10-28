import assert from 'node:assert/strict';
import test,{mock} from 'node:test';
import {createClient as supabaseClient} from '@supabase/supabase-js';
let role='sales_coordinator';
const reads:string[][]=[];
const rows=[{id:'n1',recipient_id:'self',sender_id:'boss',body:'Your request was approved',order_no:'/inventory/requests',created_at:'2026-10-28T00:00:00Z'},{id:'n2',recipient_id:'self',sender_id:'self',body:'Own notification',order_no:'/inventory',created_at:'2026-10-28T00:00:00Z'}];
const client=supabaseClient('https://inventory.test','test-key',{auth:{persistSession:false},global:{fetch:async(input)=>{
  const url=new URL(String(input));assert.equal(url.searchParams.get('recipient_id'),'eq.self');return Response.json(rows);
}}});
mock.module('@/lib/auth',{namedExports:{requireInventoryUser:async()=>({user:{id:'self'},profile:{role,account_status:'active'}})}});
mock.module('@/lib/supabase/server',{namedExports:{createClient:async()=>client}});
mock.module('@/lib/supabase/admin',{namedExports:{createAdminClient:()=>({client:{from:()=>({select:()=>({in:async(_key:string,ids:string[])=>{reads.push(ids);return {data:ids.map(id=>({id,full_name:id==='self'?'Own Person':'Manager Name'}))};}})})},error:null})}});
const {getRecentNotificationsWithSenders}=await import('./notification-queries');
test('nonmanager inventory notifications contain only their own sender name',async()=>{
  role='sales_coordinator';reads.length=0;const result=await getRecentNotificationsWithSenders();assert.ok(result.ok);
  assert.equal(result.data[0].sender_name,null);assert.equal(result.data[1].sender_name,'Own Person');assert.deepEqual(reads,[['self']]);
});
test('manager notification names and received-only query behavior stay unchanged',async()=>{
  role='admin_manager';reads.length=0;const result=await getRecentNotificationsWithSenders();assert.ok(result.ok);assert.equal(result.data[0].sender_name,'Manager Name');assert.deepEqual(reads,[['boss','self']]);
});
