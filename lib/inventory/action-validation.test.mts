import assert from "node:assert/strict";
import test from "node:test";
import { movementInput, productInput, photoInput, validatePhotoSet, categoryInput } from "./action-validation";
import { inventoryErrorMessage } from "./action-errors";
const id="11111111-1111-4111-8111-111111111111";
const file={path:`products/${id}/image.jpg`,contentType:"image/jpeg",sizeBytes:100,sortOrder:0,isMain:true};
test("movement validation is strict, trims text and normalizes hold/book",()=>{
  assert.equal(movementInput({productId:id,actionType:"adjustment",quantity:0,note:" hi "}).note,"hi");
  for(const actionType of ["sale","receive_stock","internal_transfer"]) assert.throws(()=>movementInput({productId:id,actionType,quantity:0}));
  for(const quantity of [-1,1.5,"2",Infinity]) assert.throws(()=>movementInput({productId:id,actionType:"adjustment",quantity}));
  assert.throws(()=>movementInput({productId:"bad",actionType:"adjustment",quantity:1}));
  assert.throws(()=>movementInput({productId:id,actionType:"internal_transfer",fromLocation:"warehouse",toLocation:"sold",quantity:1}));
  assert.deepEqual(movementInput({productId:id,requestType:"hold",quantity:1},true),{product_id:id,request_type:"hold",action_type:"internal_transfer",from_location:null,to_location:null,quantity:1,note:null,project_id:null,reference_note:null,expires_at:null});
});
test("product whitelist ignores non-manager costs and stock patches",()=>{
  const payload={brand_id:id,category_id:id,stock_ref:" A ",item_code:" B ",item_name:" Chair ",model_name:" M ",quantity:2,costs:{price:"invalid"},submitted_by:id};
  const parsed=productInput(payload,false,false);
  assert.equal(parsed.item_name,"Chair"); assert.equal("costs" in parsed,false); assert.equal("submitted_by" in parsed,false);
  assert.throws(()=>productInput(payload,true,false));
  assert.deepEqual(productInput({quantity:999,warehouse_quantity:999,item_name:" New "},true,true),{item_name:"New"});
  assert.throws(()=>productInput({...payload,dimension_length:10},false,false));
  assert.throws(()=>productInput({...payload,quantity:"2"},false,false));
});
test('new items need only an item name, brand, category and quantity; browser references are ignored',()=>{
  const base={brand_id:id,category_id:id,item_name:' Chair ',quantity:1};
  for(const stock_ref of ['spoofed','',null,{unexpected:true}]) {
    assert.deepEqual(productInput({...base,stock_ref,item_code:'  ',model_name:''},false,false),{item_name:'Chair',item_code:null,model_name:null,brand_id:id,local_brand_id:null,category_id:id,quantity:1});
    assert.deepEqual(productInput({stock_ref,item_code:'',model_name:'  '},true,true,true),{item_code:null,model_name:null});
  }
  assert.throws(()=>productInput({...base,item_name:''},true,false));
  assert.deepEqual(productInput({item_code:null,model_name:null},true,true),{item_code:null,model_name:null});
});
test("photo plans enforce owner paths, metadata, count, positions and one main",()=>{
  const parsed=photoInput({ownerType:"product",ownerId:id,files:[file]});
  assert.equal(parsed.files.length,1); validatePhotoSet([],parsed.files);
  for(const patch of [{ownerType:"other"},{ownerId:"bad"},{files:[{...file,path:`requests/${id}/image.jpg`}]},{files:[{...file,path:`products/${id}/../image.jpg`}]},{files:[{...file,sizeBytes:6*1024*1024}]},{files:[{...file,contentType:"text/plain"}]}]) assert.throws(()=>photoInput({ownerType:"product",ownerId:id,files:[file],...patch}));
  assert.throws(()=>validatePhotoSet([],[{...file,isMain:false}]));
  assert.throws(()=>validatePhotoSet([],[file,{...file,sortOrder:1,isMain:true}]));
  assert.throws(()=>validatePhotoSet([{sort_order:0,is_main:true},{sort_order:1,is_main:false},{sort_order:2,is_main:false}],[file]));
  validatePhotoSet([{sort_order:0,is_main:true}],[{...file,sortOrder:1,isMain:false}]);
});
test("category validation generates slugs and rejects invalid hierarchy IDs",()=>{
  assert.equal(categoryInput({name:" Café Chairs "},false).slug,"cafe-chairs");
  assert.throws(()=>categoryInput({name:"ok",parentId:"not-uuid"},false));
  assert.throws(()=>categoryInput({name:"x".repeat(201)},false));
});
test("known database failures map to friendly messages and unexpected details are hidden",()=>{
  for(const message of ["item code already in use","stock ref already in use","Request has already been reviewed","Photos require a pending product request","Only 2 units are in dubai_showroom"]) assert.ok(inventoryErrorMessage({code:"P0001",message}));
  assert.ok(inventoryErrorMessage({code:"42501",message:"details"}));
  assert.equal(inventoryErrorMessage({code:"XX000",message:"private SQL details"}),null);
});

test('book requires project or trimmed reference; only holds accept future timezone-aware expiry',()=>{
  const base={productId:id,requestType:'book',quantity:1};
  assert.throws(()=>movementInput(base,true),/project or reference/);
  assert.throws(()=>movementInput({...base,referenceNote:'   '},true),/project or reference/);
  assert.equal(movementInput({...base,projectId:id},true).project_id,id);
  assert.equal(movementInput({...base,referenceNote:' Ref '},true).reference_note,'Ref');
  const future=new Date(Date.now()+86400000).toISOString();
  assert.equal(movementInput({...base,requestType:'hold',expiresAt:future},true).expires_at,future);
  for(const expiresAt of ['invalid','2020-01-01T00:00:00Z','2099-01-01T00:00']) assert.throws(()=>movementInput({...base,requestType:'hold',expiresAt},true));
  assert.throws(()=>movementInput({...base,referenceNote:'Ref',expiresAt:future},true),/only allowed for holds/);
});
