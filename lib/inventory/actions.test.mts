import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createClient as sdkClient } from "@supabase/supabase-js";
const id="11111111-1111-4111-8111-111111111111", other="22222222-2222-4222-8222-222222222222";
let role:string|null="viewer", authenticated=true, clients=0, adminClients=0, invalidations=0;
let calls:{url:URL;method:string;body:Record<string,unknown>|Record<string,unknown>[]|null}[]=[];
let failure:{code:string;message:string}|null=null, failStorage=false, requestOwner=id, requestStatus="pending_review";
let images:Record<string,unknown>[]=[], storageSize=100, storageType="image/jpeg", disguisedPhoto=false, storageBytesType:string|null=null;
let photoInsertFailure=false, deleteDbFailure=false,storageDeletes=0,failStorageAt=-1,throwStorageAt=-1;
const deletePaths=[`products/${id}/one.webp`,`requests/${other}/two.jpg`];
let categoryRows:Record<string,unknown>[]=[];
const client=sdkClient("https://inventory.test","publishable-fixture",{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
  const url=new URL(String(input)),method=init?.method??"GET",body=init?.body?JSON.parse(String(init.body)):null;
  calls.push({url,method,body});
  const name=url.pathname.split("/").at(-1)!;
  if(url.pathname.includes("/rpc/")){
    assert.equal(new Headers(init?.headers).get("Content-Profile"),"inventory");
    if(failure)return Response.json(failure,{status:400});
    if(name==="get_product_delete_summary")return Response.json({stock_ref:'S1',photos:2,movements:3,reservations:1});
    if(name==="delete_product_permanently")return deleteDbFailure ? Response.json({code:'P0001',message:'fixture database refusal'},{status:400}) : Response.json(deletePaths);
    if(name==="remove_product_photo")return Response.json(`products/${id}/image.jpg`);
    if(name==="submit_product_request")return Response.json({request_id:id,product_id:role && ["system_owner","admin_manager"].includes(role)?other:null});
    if(name==="submit_movement_request")return Response.json({request_id:id,movement_id:role && ["system_owner","admin_manager"].includes(role)?other:null,reservation_id:null});
    return Response.json(["review_movement_request","update_product","remove_product","set_main_product_photo"].includes(name)?null:id);
  }
  if(url.pathname.includes("/storage/")){
    if(method==="DELETE") {
      const index=storageDeletes++;if(index===throwStorageAt) throw new Error("fixture Storage transport failure");
      return failStorage || index===failStorageAt ? Response.json({message:"fixture remove failure"},{status:500}) : Response.json([]);
    }
    if(!url.pathname.includes('/object/info/')) {
      const bytes=new Uint8Array(storageSize), format=storageBytesType ?? storageType;
      const signature=disguisedPhoto ? [71,73,70,56,57,97] : format==='image/webp' ? [82,73,70,70,0,0,0,0,87,69,66,80] : format==='image/png' ? [137,80,78,71,13,10,26,10] : [255,216,255];
      bytes.set(signature);
      return new Response(bytes,{headers:{'Content-Type':storageType}});
    }
    return Response.json({name:`products/${id}/image.jpg`,size:storageSize,content_type:storageType});
  }
  assert.equal(new Headers(init?.headers).get(method==="GET"?"Accept-Profile":"Content-Profile"),"inventory");
  if(name==="product_images"&&method==="POST"&&photoInsertFailure)return Response.json({code:"42501",message:"Photos require a pending product request"},{status:403});
  if(method!=="GET")return Response.json(name==="categories"?[{id}]:[],{status:200});
  if(name==="product_images")return Response.json(images);
  if(name==="reservations")return Response.json([{created_by:requestOwner}]);
  if(name==="product_requests")return Response.json([{id,submitted_by:requestOwner,request_status:requestStatus}]);
  if(name==="categories")return Response.json(categoryRows);
  return Response.json([{id,is_active:true}]);
}}});
mock.module("@/lib/auth",{namedExports:{requireInventoryUser:async()=>{
  if(!authenticated)throw new Error("authentication required");
  return {user:{id},profile:{role,account_status:"active"}};
}}});
mock.module("@/lib/supabase/server",{namedExports:{createClient:async()=>{clients++;return client;}}});
mock.module("@/lib/supabase/admin",{namedExports:{createAdminClient:()=>{adminClients++;throw new Error("Service role must never be used");}}});
mock.module("next/cache",{namedExports:{revalidatePath:(path:string,type:string)=>{assert.equal(path,"/inventory");assert.equal(type,"layout");invalidations++;}}});
const actions=await import("./actions");
const product={brand_id:id,category_id:id,stock_ref:"S1",item_code:"I1",item_name:"Chair",model_name:"Model",quantity:2};
const photo={path:`products/${id}/image.jpg`,contentType:"image/jpeg",sizeBytes:100,sortOrder:0,isMain:true};
function reset(nextRole="admin_manager"){
  role=nextRole;authenticated=true;clients=0;adminClients=0;invalidations=0;calls=[];failure=null;failStorage=false;images=[];requestOwner=id;requestStatus="pending_review";storageSize=100;storageType="image/jpeg";disguisedPhoto=false;storageBytesType=null;categoryRows=[];photoInsertFailure=false;deleteDbFailure=false;storageDeletes=0;failStorageAt=-1;throwStorageAt=-1;
}
const managers=new Set(["system_owner","admin_manager"]);
const office=new Set(["procurement_manager","sales_designer","sales_coordinator","designer"]);
test("role matrix covers every action; denied roles never create a database client",async()=>{
  for(const nextRole of [...managers,...office,"warehouse_staff","viewer","unknown"]){
    const probes:[string,()=>Promise<{ok:boolean}>,boolean][]=[
      ["review edits",()=>actions.reviewProductRequestWithEdits({requestId:id,decision:"approved",edits:{}}),managers.has(nextRole)],
      ["fulfil",()=>actions.fulfilReservation({reservationId:id,actionType:"sale",fromLocation:"warehouse"}),managers.has(nextRole)],
      ["direct",()=>actions.recordDirectMovement({productId:id,actionType:"receive_stock",quantity:1}),managers.has(nextRole)],
      ["review movement",()=>actions.reviewMovementRequest({requestId:id,decision:"approved"}),managers.has(nextRole)],
      ["submit product",()=>actions.submitProductRequest(product),managers.has(nextRole)||nextRole==="warehouse_staff"],
      ["review product",()=>actions.reviewProductRequest({requestId:id,decision:"approved"}),managers.has(nextRole)],
      ["update product",()=>actions.updateProduct({productId:id,patch:{item_name:"New"}}),managers.has(nextRole)],
      ["remove product",()=>actions.removeProduct({productId:id,reason:"Old"}),managers.has(nextRole)],
      ["create category",()=>actions.createCategory({name:"New"}),managers.has(nextRole)],
      ["update category",()=>actions.updateCategory({categoryId:id,patch:{name:"New"}}),managers.has(nextRole)],
      ["category active",()=>actions.setCategoryActive({categoryId:id,active:false}),managers.has(nextRole)],
      ["register product photo",()=>actions.registerInventoryPhotos({ownerType:"product",ownerId:id,files:[photo]}),managers.has(nextRole)],
      ["register request photo",()=>actions.registerInventoryPhotos({ownerType:"request",ownerId:id,files:[{...photo,path:`requests/${id}/image.jpg`}]}),managers.has(nextRole)||nextRole==="warehouse_staff"],
      ["main photo",()=>actions.setMainProductPhoto({photoId:id}),managers.has(nextRole)],
      ["remove photo",()=>actions.removeProductPhoto({photoId:id}),managers.has(nextRole)],
    ];
    for(const kind of ["hold","book","take","move"]){
      probes.push([`submit ${kind}`,()=>actions.submitMovementRequest({productId:id,requestType:kind,referenceNote:kind === "book" ? "Project reference" : null,actionType:"internal_transfer",fromLocation:"warehouse",toLocation:"dubai_showroom",quantity:1}),managers.has(nextRole)||(office.has(nextRole)?["hold","book"].includes(kind):nextRole==="warehouse_staff"&&["take","move"].includes(kind))]);
    }
    for(const [name,run,allowed] of probes){
      reset(nextRole); categoryRows=[{id,parent_id:null}];
      const result=await run();assert.equal(result.ok,allowed,`${nextRole}: ${name}`);
      if(!allowed){assert.equal(clients,0,`${nextRole}: ${name}`);assert.equal(calls.length,0);}
      assert.equal(adminClients,0);assert.equal(invalidations,allowed?1:0);
    }
  }
});
test("auth redirects propagate before client access; invalid input never reaches writes",async()=>{
  reset();authenticated=false;
  await assert.rejects(()=>actions.recordDirectMovement({}),/authentication required/);assert.equal(clients,0);
  reset();
  for(const run of [()=>actions.recordDirectMovement({productId:id,actionType:"sale",quantity:0}),()=>actions.removeProduct({productId:id,reason:"  "}),()=>actions.updateProduct({productId:"bad",patch:{item_name:"New"}})])assert.equal((await run()).ok,false);
  assert.equal(calls.length,0);
});
test('manager submission returns linked product and movement ids; requesters get pending ids',async()=>{
  reset();
  assert.deepEqual(await actions.submitProductRequest(product),{ok:true,requestId:id,productId:other});
  assert.deepEqual(await actions.submitMovementRequest({productId:id,requestType:'take',actionType:'sale',fromLocation:'warehouse',quantity:1}),{ok:true,requestId:id,movementId:other,reservationId:null});
  reset('warehouse_staff');
  assert.deepEqual(await actions.submitProductRequest(product),{ok:true,requestId:id,productId:null});
});
test("RPC payloads are whitelisted, costs are stripped for warehouse, hold/book normalized",async()=>{
  reset("warehouse_staff");
  const result=await actions.submitProductRequest({...product,costs:{price:"invalid"},submitted_by:other,request_status:"approved"});
  assert.equal(result.ok,true);assert.equal("costs" in (calls[0].body as {payload:object}).payload,false);
  assert.equal("submitted_by" in (calls[0].body as {payload:object}).payload,false);
  reset("admin_manager");await actions.submitProductRequest({...product,costs:{price:10,total_cost:100}});
  assert.deepEqual((calls[0].body as {payload:{costs:object}}).payload.costs,{price:10});
  reset("designer");await actions.submitMovementRequest({productId:id,requestType:"book",referenceNote:" Project reference ",quantity:1});
  assert.deepEqual(calls[0].body,{product_id:id,request_type:"book",action_type:"internal_transfer",from_location:null,to_location:null,quantity:1,note:null,project_id:null,reference_note:"Project reference",expires_at:null});
});
test('submit and review strip stock references while accepting empty optional identifiers',async()=>{
  reset();
  assert.equal((await actions.submitProductRequest({brand_id:id,category_id:id,item_name:'Chair',quantity:2,stock_ref:{spoof:true},item_code:' ',model_name:''})).ok,true);
  const payload=(calls[0].body as {payload:Record<string,unknown>}).payload;
  assert.equal('stock_ref' in payload,false);assert.equal(payload.item_code,null);assert.equal(payload.model_name,null);
  reset();
  assert.equal((await actions.reviewProductRequestWithEdits({requestId:id,decision:'approved',edits:{stock_ref:'Spoof',item_code:null,model_name:''}})).ok,true);
  assert.deepEqual((calls[0].body as {edits:object}).edits,{item_code:null,model_name:null});
  reset();failure={code:'P0001',message:'Brand needs a code'};
  assert.deepEqual(await actions.submitProductRequest({brand_id:id,category_id:id,item_name:'Chair',quantity:1}),{ok:false,error:'Brand needs a code.'});
});
test("known RPC errors are friendly; unexpected errors are logged without returning details",async()=>{
  reset();failure={code:"P0001",message:"Only 2 units are in warehouse"};
  assert.deepEqual(await actions.recordDirectMovement({productId:id,actionType:"receive_stock",quantity:1}),{ok:false,error:"Only 2 units are in Warehouse."});
  assert.equal(invalidations,0);
  reset();failure={code:"XX000",message:"sensitive query details"};const logs=mock.method(console,"error",()=>{});
  const result=await actions.reviewProductRequest({requestId:id,decision:"approved"});
  assert.equal(result.ok,false);assert.equal(JSON.stringify(result).includes("sensitive"),false);assert.equal(logs.mock.callCount(),1);logs.mock.restore();
});
test("registration enforces ownership, pending status, counts, metadata and all-or-nothing failed count",async()=>{
  for(const scenario of ["other","reviewed","full","wrong-path","wrong-type","metadata"]){
    reset("warehouse_staff");const file={...photo,path:`requests/${id}/image.jpg`};
    if(scenario==="other")requestOwner=other;
    if(scenario==="reviewed")requestStatus="approved";
    if(scenario==="full")images=[{sort_order:0,is_main:true},{sort_order:1,is_main:false},{sort_order:2,is_main:false}];
    if(scenario==="wrong-path")file.path=`products/${id}/image.jpg`;
    if(scenario==="wrong-type")file.contentType="text/plain";
    if(scenario==="metadata")storageSize=101;
    const result=await actions.registerInventoryPhotos({ownerType:"request",ownerId:id,files:[file]});
    assert.equal(result.ok,false,scenario);assert.equal(result.failedCount,1);assert.equal(calls.some(c=>c.method==="POST"),false);
  }
  reset("warehouse_staff");const result=await actions.registerInventoryPhotos({ownerType:"request",ownerId:id,files:[{...photo,path:`requests/${id}/image.jpg`}]});
  assert.equal(result.ok,true);assert.equal(result.failedCount,0);
  const inserted=calls.find(c=>c.method==="POST")!.body as Record<string,unknown>[];
  assert.equal(inserted[0].uploaded_by,id);assert.equal(inserted[0].product_request_id,id);assert.equal(inserted[0].product_id,null);
});
test("photo removal deletes the record via RPC before storage, reports cleanup failure without restoring it",async()=>{
  reset();failStorage=true;const logs=mock.method(console,"error",()=>{});
  const result=await actions.removeProductPhoto({photoId:id});
  assert.equal(result.ok,false);assert.match("error" in result?result.error:"",/record was removed/i);
  assert.equal(calls[0].url.pathname,"/rest/v1/rpc/remove_product_photo");assert.equal(calls[1].method,"DELETE");
  assert.equal(calls.length,2);assert.equal(invalidations,1);logs.mock.restore();
});
test("a failed photo batch reports every unregistered file and retains the created request",async()=>{
  reset("warehouse_staff");
  assert.equal((await actions.submitProductRequest(product)).ok,true);
  photoInsertFailure=true;
  const files=[{...photo,path:`requests/${id}/first.jpg`},{...photo,path:`requests/${id}/second.jpg`,sortOrder:1,isMain:false}];
  const result=await actions.registerInventoryPhotos({ownerType:"request",ownerId:id,files});
  assert.equal(result.ok,false);assert.equal(result.failedCount,2);
  assert.match("error" in result?result.error:"",/pending review/);
  assert.equal(calls.some(c=>c.method==="DELETE"),false);
  assert.equal(calls.filter(c=>c.url.pathname.includes("/rpc/")).length,1);
});
test("category hierarchy prevents self-parenting, deeper nesting and reparenting",async()=>{
  reset();assert.equal((await actions.updateCategory({categoryId:id,patch:{parentId:id}})).ok,false);
  reset();categoryRows=[{id:other,parent_id:id}];assert.equal((await actions.createCategory({name:"Grandchild",parentId:other})).ok,false);
  reset();categoryRows=[{id:other,parent_id:null}];assert.equal((await actions.updateCategory({categoryId:id,patch:{parentId:other}})).ok,false);
  assert.equal(calls.some(c=>c.method!=="GET"),false);
  reset();categoryRows=[{id,parent_id:other}];
  assert.equal((await actions.updateCategory({categoryId:id,patch:{name:"Renamed",parentId:other}})).ok,true);
  const update=calls.find(c=>c.method==="PATCH")!.body as Record<string,unknown>;
  assert.equal("parent_id" in update,false);
  assert.equal(update.name,"Renamed");
});

test('reservation creator can release; other nonmanagers cannot; fulfil is manager-only',async()=>{
  for(const nextRole of ['system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','warehouse_staff','viewer']) {
    reset(nextRole);
    assert.equal((await actions.releaseReservation({reservationId:other,note:'Done'})).ok,true,nextRole);
    assert.equal(calls.at(-1)?.url.pathname,'/rest/v1/rpc/release_reservation');
    reset(nextRole);requestOwner=other;
    assert.equal((await actions.releaseReservation({reservationId:other})).ok,managers.has(nextRole),nextRole);
    if(!managers.has(nextRole)) assert.equal(calls.some(call=>call.method==='POST'),false);
  }
  reset();assert.equal((await actions.fulfilReservation({reservationId:id,actionType:'adjustment',fromLocation:'warehouse'})).ok,false);assert.equal(calls.length,0);
  reset();assert.equal((await actions.fulfilReservation({reservationId:id,actionType:'internal_transfer',fromLocation:'warehouse',toLocation:'warehouse'})).ok,false);assert.equal(calls.length,0);
});
test('review edits ignore rejected edits and require a rejection note before RPC',async()=>{
  reset();assert.equal((await actions.reviewProductRequestWithEdits({requestId:id,decision:'rejected',edits:'invalid'})).ok,false);assert.equal(calls.length,0);
  assert.equal((await actions.reviewProductRequestWithEdits({requestId:id,decision:'rejected',reviewNote:'Wrong item',edits:'invalid'})).ok,true);
  assert.deepEqual((calls.at(-1)?.body as Record<string,unknown>).edits,{});
  reset();assert.equal((await actions.reviewProductRequestWithEdits({requestId:id,decision:'approved',edits:{quantity:2,initial_stock:{mockup:2},costs:{price:10,total_cost:999},reviewed_by:other}})).ok,true);
  assert.deepEqual((calls.at(-1)?.body as Record<string,unknown>).edits,{quantity:2,initial_stock:{mockup:2},costs:{price:10}});
});

test('only managers create Inventory-only brands, normalize codes and refresh Inventory',async()=>{
 for(const nextRole of ['system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','warehouse_staff','viewer']) {
  reset(nextRole);const result=await actions.createLocalBrand({name:' Shop ',code:'shp'});
  assert.equal(result.ok,managers.has(nextRole));assert.equal(clients,managers.has(nextRole)?1:0);
  if(result.ok) {assert.deepEqual(calls[0].body,{name:'Shop',code:'SHP'});assert.equal(invalidations,1);}
 }
 reset();assert.equal((await actions.createLocalBrand({name:'Shop',code:'GEN'})).ok,false);assert.equal(clients,0);
 reset();failure={code:'23505',message:'Code already belongs to a PW brand'};
 const duplicate=await actions.createLocalBrand({name:'Shop',code:'PW'});assert.equal(duplicate.ok,false);
 if(!duplicate.ok) assert.match(duplicate.error,/short code is already in use/);
});

test('server rejects oversized or unsupported stored photos even when browser metadata lies',async()=>{
 for(const scenario of ['size','type']) {
  reset();if(scenario==='size') storageSize=2097153;else storageType='image/gif';
  const result=await actions.registerInventoryPhotos({ownerType:'product',ownerId:id,files:[photo]});
  assert.equal(result.ok,false);if(!result.ok) assert.match(result.error,scenario==='size'?/2 MB/:/JPEG|PNG|WebP/);
  assert.equal(calls.some(call=>call.method==='POST'),false);
 }
 reset();const result=await actions.registerInventoryPhotos({ownerType:'product',ownerId:id,files:[{...photo,sizeBytes:2097153}]});
 assert.equal(result.ok,false);if(!result.ok) assert.match(result.error,/2 MB/);assert.equal(clients,0);
});

test('server accepts the exact 2 MiB boundary from actual Storage metadata',async()=>{
 reset();storageSize=2097152;
 const result=await actions.registerInventoryPhotos({ownerType:'product',ownerId:id,files:[{...photo,sizeBytes:2097152}]});
 assert.equal(result.ok,true);
});

test('server rejects GIF bytes disguised as an allowed JPEG upload',async()=>{
 reset();disguisedPhoto=true;
 const result=await actions.registerInventoryPhotos({ownerType:'product',ownerId:id,files:[photo]});
 assert.equal(result.ok,false);if(!result.ok) assert.match(result.error,/JPEG|PNG|WebP/);
 assert.equal(calls.some(call=>call.method==='POST'),false);
});

test('server registers WebP and PNG but rejects valid image bytes with a mismatched declared type',async()=>{
 for(const [type,extension] of [['image/webp','webp'],['image/png','png']]) {
  reset();storageType=type;
  const result=await actions.registerInventoryPhotos({ownerType:'product',ownerId:id,files:[{...photo,path:`products/${id}/photo.${extension}`,contentType:type}]});
  assert.equal(result.ok,true,type);
 }
 reset();storageBytesType='image/png';
 const mismatch=await actions.registerInventoryPhotos({ownerType:'product',ownerId:id,files:[photo]});
 assert.equal(mismatch.ok,false);if(!mismatch.ok) assert.match(mismatch.error,/contents do not match/);
 assert.equal(calls.some(call=>call.method==='POST'),false);
});

test('permanent delete refuses every nonmanager before creating a client',async()=>{
 for(const nextRole of ['warehouse_staff','designer','viewer','sales_designer','sales_coordinator','procurement_manager','unknown']) {
  reset(nextRole);const result=await actions.deleteProductPermanently({productId:id,stockRef:'S1'});
  assert.equal(result.ok,false);assert.equal(clients,0);assert.equal(calls.length,0);
  const summary=await actions.getProductDeleteSummary({productId:id});assert.equal(summary.ok,false);assert.equal(clients,0);assert.equal(calls.length,0);
 }
});
test('permanent delete commits the database before Storage and confirms the current stock ref',async()=>{
 reset();assert.equal((await actions.deleteProductPermanently({productId:id,stockRef:'wrong'})).ok,false);
 assert.equal(calls.some(call=>call.method==='DELETE'||call.url.pathname.endsWith('/delete_product_permanently')),false);
 reset();const result=await actions.deleteProductPermanently({productId:id,stockRef:'S1'});
 assert.equal(result.ok,true);if(result.ok) {assert.equal(result.failedPhotoCount,0);assert.equal(result.message,'Item deleted.');}
 assert.deepEqual(calls.map(call=>call.url.pathname.split('/').at(-1)),['get_product_delete_summary','delete_product_permanently','inventory-images','inventory-images']);
 assert.equal(invalidations,1);assert.equal(calls.some(call=>call.url.pathname.includes('notifications')),false);
});
test('permanent delete reports/logs leftover paths after Storage failure without undoing item deletion',async()=>{
 reset();failStorage=true;const logs=mock.method(console,'error',()=>{});
 try {
  const result=await actions.deleteProductPermanently({productId:id,stockRef:'S1'});
  assert.equal(result.ok,true);if(result.ok) {assert.equal(result.failedPhotoCount,2);assert.match(result.message,/Item deleted, 2 photos could not be removed/);}
  assert.equal(calls.filter(call=>call.url.pathname.endsWith('/delete_product_permanently')).length,1);
  assert.equal(calls.filter(call=>call.method==='DELETE').length,2);assert.equal(invalidations,1);
  assert.ok(JSON.stringify(logs.mock.calls).includes(deletePaths[0]));assert.ok(JSON.stringify(logs.mock.calls).includes(deletePaths[1]));
 } finally {logs.mock.restore();}
});
test('permanent delete database failure never attempts Storage deletion',async()=>{
 reset();deleteDbFailure=true;const logs=mock.method(console,'error',()=>{});
 try {const result=await actions.deleteProductPermanently({productId:id,stockRef:'S1'});assert.equal(result.ok,false);assert.equal(calls.some(call=>call.method==='DELETE'),false);assert.equal(invalidations,0);} finally {logs.mock.restore();}
});

test('permanent delete mixed cleanup failures and thrown transport errors count/log only leftovers',async()=>{
 for(const thrown of [false,true]) {
  reset();if(thrown) throwStorageAt=1;else failStorageAt=1;
  const logs=mock.method(console,'error',()=>{});
  try {
   const result=await actions.deleteProductPermanently({productId:id,stockRef:'S1'});
   assert.equal(result.ok,true);if(result.ok) {assert.equal(result.failedPhotoCount,1);assert.equal(result.message,'Item deleted, 1 photo could not be removed.');}
   const logged=JSON.stringify(logs.mock.calls);assert.ok(logged.includes(deletePaths[1]));assert.ok(!logged.includes(deletePaths[0]));
   assert.equal(calls.filter(call=>call.method==='DELETE').length,2);assert.equal(invalidations,1);
  } finally {logs.mock.restore();}
 }
});

test("worker item search is for Warehouse Staff only and never creates a client for anyone else",async()=>{
  for(const nextRole of [...managers,...office,"viewer","unknown"]){
    reset(nextRole);
    assert.deepEqual(await actions.searchRequestProducts("chair"),{ok:false,error:"You do not have permission to do that."},nextRole);
    assert.equal(clients,0,nextRole);assert.equal(calls.length,0,nextRole);
  }
  reset("warehouse_staff");
  const result=await actions.searchRequestProducts("chair");
  assert.notEqual((result as {error?:string}).error,"You do not have permission to do that.");
  reset("warehouse_staff");
  assert.equal((await actions.searchRequestProducts("x".repeat(101))).ok,false);
});
