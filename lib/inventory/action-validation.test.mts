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
  assert.deepEqual(movementInput({productId:id,requestType:"hold",quantity:1},true),{product_id:id,request_type:"hold",action_type:"internal_transfer",from_location:null,to_location:null,quantity:1,note:null});
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
