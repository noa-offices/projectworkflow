import assert from "node:assert/strict";
import test from "node:test";
import { parseInventoryProductParams, inventoryProductsHref, hasInventoryFilters, inventoryLabel, productStockLocations, orderedProductImages, dimensionLabel } from "./presentation";
import * as presentation from "./presentation";
import type { InventoryImage } from "./types";
const id="11111111-1111-4111-8111-111111111111";
test("URL parsing validates repeated values, identifiers, codes and page boundaries",()=>{
  const parsed=parseInventoryProductParams({q:["  chair  ","ignored"],brand:id,status:"hold",itemType:"accessory",location:"dubai_showroom",sort:"quantity_desc",page:"3"});
  assert.equal(parsed.filters.search,"chair");assert.equal(parsed.filters.brand_id,id);assert.equal(parsed.filters.location,"dubai_showroom");assert.equal(parsed.page,3);
  assert.equal(hasInventoryFilters(parsed.state),true);
  const bad=parseInventoryProductParams({brand:"not-uuid",status:"costs",sort:"price",page:"1e99",location:"some_column",itemType:"bad"});
  assert.equal(bad.page,1);assert.equal(bad.state.sort,"name_asc");assert.equal(hasInventoryFilters(bad.state),false);
  for(const page of ["0","-1","1.5","Infinity","999999999999999"])assert.equal(parseInventoryProductParams({page}).page,1);
});
test("URL links preserve filters, encode search text and support clearing and pagination",()=>{
  const {state}=parseInventoryProductParams({q:'chair & "desk"',brand:id,category:id,page:"2"});
  const href=inventoryProductsHref(state,{page:3});const params=new URL(href,"https://example.test").searchParams;
  assert.equal(params.get("q"),'chair & "desk"');assert.equal(params.get("brand"),id);assert.equal(params.get("page"),"3");
  assert.equal(new URL(inventoryProductsHref(state,{brand:"",page:1}),"https://example.test").searchParams.has("brand"),false);
  assert.equal(inventoryProductsHref(parseInventoryProductParams({}).state),"/inventory/products");
});
test("labels and stock data keep cumulative sold separate",()=>{
  assert.equal(inventoryLabel("return_to_warehouse"),"Return to warehouse");
  const locations=productStockLocations({warehouse_quantity:5,dubai_showroom_quantity:1,abudhabi_showroom_quantity:0,mockup_quantity:0,temporary_out_quantity:2,sold_quantity:40});
  assert.equal(locations.length,6);assert.deepEqual(locations.at(-1),{code:"sold",label:"Sold",quantity:40,cumulative:true});
  assert.equal(dimensionLabel({dimension_length:100,dimension_width:50,dimension_height:75,dimension_unit:"cm"}),"100 × 50 × 75 cm");
  assert.equal(dimensionLabel({dimension_length:null,dimension_width:null,dimension_height:null,dimension_unit:null}),null);
});
test("gallery ordering puts main first, caps three, and never mutates query data",()=>{
  const images=[{id:"a",sort_order:0,is_main:false},{id:"b",sort_order:2,is_main:true},{id:"c",sort_order:1,is_main:false},{id:"d",sort_order:3,is_main:false}] as InventoryImage[];
  assert.deepEqual(orderedProductImages(images).map(i=>i.id),["b","a","c"]);assert.equal(images[0].id,"a");
});

test("optional inventory text uses an em dash for missing or blank values", () => {
  assert.equal(typeof presentation.inventoryOptionalText, "function");
  for (const value of [null, undefined, "", "   "]) assert.equal(presentation.inventoryOptionalText(value), "—");
  assert.equal(presentation.inventoryOptionalText("  CHR-042  "), "CHR-042");
});
test("Overview card links round-trip through the Products URL and unknown values are dropped",()=>{
  for(const filter of [{stock:"live"},{stock:"reserved"},{location:"sold"},{location:"warehouse"},{itemType:"accessory",stock:"live"}]){
    const url=new URL(presentation.inventoryOverviewHref(filter),"http://x"), params=Object.fromEntries(url.searchParams);
    const {state,filters}=parseInventoryProductParams(params);
    assert.equal(url.pathname,"/inventory/products");
    assert.equal(inventoryProductsHref(state),presentation.inventoryOverviewHref(filter));
    assert.equal(filters.stock,filter.stock);
  }
  assert.equal(parseInventoryProductParams({stock:"low_stock"}).state.stock,"");
  const bad=parseInventoryProductParams({stock:"everything",location:"moon",itemType:"gadget"});
  assert.deepEqual([bad.state.stock,bad.state.location,bad.state.itemType],["","",""]);
  assert.equal(hasInventoryFilters(parseInventoryProductParams({stock:"reserved"}).state),true);
});
