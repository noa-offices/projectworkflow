import assert from "node:assert/strict";
import test from "node:test";
import { photoSelectionError, productRequestFormInput, productRequestSuccessHref, sendProductRequest } from "./product-request-submission";
const id = "11111111-1111-4111-8111-111111111111";
test('managers continue to the created product; warehouse and unsuccessful submissions stay on the request form',()=>{
  const success={ok:true as const,requestId:id,productId:id,failedCount:0,photoError:null};
  for(const role of ['system_owner','admin_manager']) {
    assert.equal(productRequestSuccessHref(success,role),`/inventory/products/${id}`);
    assert.equal(productRequestSuccessHref({...success,failedCount:2},role),`/inventory/products/${id}?photoFailures=2`);
    assert.equal(productRequestSuccessHref({...success,productId:null},role),null);
    assert.equal(productRequestSuccessHref({ok:false,error:'Failed'},role),null);
  }
  for(const role of ['warehouse_staff','viewer','designer','sales_designer','sales_coordinator','procurement_manager',null]) assert.equal(productRequestSuccessHref(success,role),null);
});
function form() {
  const data = new FormData();
  for (const [key,value] of Object.entries({brand_id:id, category_id:id, stock_ref:"S",item_code:"I",item_name:"Chair",model_name:"M",quantity:"2",price:"12.50"})) data.set(key,value);
  return data;
}
test('add-item form ignores supplied stock reference and normalizes optional fields to null',()=>{
  const data=form();data.set('stock_ref','browser-ref');data.set('item_code','  ');data.delete('model_name');
  const input=productRequestFormInput(data,false);
  assert.equal('stock_ref' in input,false);
  assert.equal(input.item_code,null);assert.equal(input.model_name,null);
});
test("product form converts numbers, omits empty dimensions and excludes non-manager costs",()=>{
  assert.equal(productRequestFormInput(form(),false).quantity,2);
  assert.equal("costs" in productRequestFormInput(form(),false),false);
  assert.deepEqual(productRequestFormInput(form(),true).costs,{price:12.5,freight_cost:0,c_and_f:0,transport:0,custom_duty:0,labour:0,vat:0});
  const data=form(); data.set("dimension_length","2"); assert.throws(()=>productRequestFormInput(data,false));
});
test("product form requires all dimensions and rejects decimal precision beyond two places",()=>{
  const data=form();data.set("dimension_length","2");data.set("dimension_width","3");data.set("dimension_height","4");data.set("dimension_unit","cm");
  assert.equal(productRequestFormInput(data,false).dimension_unit,"cm");
  data.set("dimension_height","4.001");assert.throws(()=>productRequestFormInput(data,false));
  data.set("dimension_height","");assert.throws(()=>productRequestFormInput(data,false));
  const costs=form();costs.set("price","1.001");assert.throws(()=>productRequestFormInput(costs,true));
});
test("photo picker accepts three supported photos and refuses additions past three or unsupported formats",()=>{
  const photo={type:"image/jpeg"};
  assert.equal(photoSelectionError(0,[photo,photo,photo]),null);
  assert.match(photoSelectionError(2,[photo,photo])!,/three photos/);
  assert.match(photoSelectionError(0,[{type:"application/pdf"}])!,/JPEG, PNG or WebP/);
});
test("request is created first and successful photos are registered in main-first order after partial upload failure",async()=>{
  const calls:string[]=[];
  const result=await sendProductRequest({},[new File(["a"],"a.jpg"),new File(["b"],"b.jpg")],{
    submit:async()=>{calls.push("request");return {ok:true,requestId:id};},
    upload:async()=>{calls.push("upload");return {files:[{path:"requests/photo.jpg",contentType:"image/jpeg",sizeBytes:1}],failedCount:1,errors:["Photo 2 failed"]};},
    register:async(input)=>{calls.push("register");assert.equal(input.ownerId,id);assert.equal(input.files[0].isMain,true);assert.equal(input.files[0].sortOrder,0);return {ok:true,registeredCount:1,failedCount:0};},
  });
  assert.deepEqual(calls,["request","upload","register"]);
  assert.deepEqual(result,{ok:true,requestId:id,failedCount:1,photoError:"Photo 2 failed"});
});
test("registration failure retains the request and counts all unregistered photos",async()=>{
  const result=await sendProductRequest({},[new File(["a"],"a.jpg")],{
    submit:async()=>({ok:true,requestId:id}), upload:async()=>({files:[{path:"photo",contentType:"image/jpeg",sizeBytes:1}],failedCount:0,errors:[]}),
    register:async()=>({ok:false,error:"Already reviewed",failedCount:1}),
  });
  assert.equal(result.ok,true); if(result.ok) {assert.equal(result.requestId,id);assert.equal(result.failedCount,1);assert.equal(result.photoError,"Already reviewed");}
});
test('manager uploads and registers against the created product',async()=>{
  const productId='22222222-2222-4222-8222-222222222222';
  const result=await sendProductRequest({},[new File(['a'],'a.jpg')],{
    submit:async()=>({ok:true,requestId:id,productId}),
    upload:async owner=>{assert.equal(owner.ownerType,'product');assert.equal(owner.ownerId,productId);return {files:[{path:`products/${productId}/a.jpg`,contentType:'image/jpeg',sizeBytes:1}],failedCount:0,errors:[]};},
    register:async owner=>{assert.equal(owner.ownerType,'product');assert.equal(owner.ownerId,productId);return {ok:true,registeredCount:1,failedCount:0};},
  });
  assert.equal(result.ok,true);
  if(result.ok) assert.equal(result.productId,productId);
});
test("request failure never starts photos; an unexpected upload failure keeps the successful request",async()=>{
  const deps={submit:async()=>({ok:false,error:"Unavailable"} as const),upload:async()=>{throw new Error("must not upload");},register:async()=>{throw new Error("must not register");}};
  assert.deepEqual(await sendProductRequest({},[],deps),{ok:false,error:"Unavailable"});
  const result=await sendProductRequest({},[new File(["a"],"a.jpg")],{...deps,submit:async()=>({ok:true,requestId:id})});
  assert.equal(result.ok,true);if(result.ok)assert.equal(result.failedCount,1);
});
