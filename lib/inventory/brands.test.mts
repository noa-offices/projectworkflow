import test from 'node:test';
import assert from 'node:assert/strict';
import { brandFields } from './brands';
import { changedProductRequestFields } from './product-request-submission';
import { productInput } from './action-validation';
import { parseInventoryProductParams } from './presentation';
import { parseCurrentInventoryParams } from './reports/params';
const id='73000000-0000-0000-0000-000000000001';
test('brand identities accept no brand and local brands and reject both',()=>{
 assert.deepEqual(productInput({brand_id:null,local_brand_id:id},false,true),{brand_id:null,local_brand_id:id});
 assert.deepEqual(productInput({brand_id:null,local_brand_id:null},false,true),{brand_id:null,local_brand_id:null});
 assert.throws(()=>productInput({brand_id:id,local_brand_id:id},false,true),/one brand/i);
});
test('product and report filters preserve local and no-brand selections',()=>{
 for(const brand of ['none',`local:${id}`]) {
  assert.equal(parseInventoryProductParams({brand}).state.brand,brand);
  const report=parseCurrentInventoryParams({brand}); assert.equal(report.ok,true);
  if(report.ok) assert.equal(report.value.brand,brand);
 }
});

test('forms and cross-kind patches always clear the previous brand identity',()=>{
 const data=new FormData();data.set('brand_selection',`local:${id}`);
 const local=brandFields(data);assert.deepEqual(local,{brand_id:null,local_brand_id:id});
 assert.deepEqual(changedProductRequestFields({brand_id:id,local_brand_id:null},local),local);
 data.set('brand_selection',id);const shared=brandFields(data);
 assert.deepEqual(changedProductRequestFields(local,shared),{brand_id:id,local_brand_id:null});
 data.set('brand_selection','none');assert.deepEqual(brandFields(data),{brand_id:null,local_brand_id:null});
});
