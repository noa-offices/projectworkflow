import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as presentation from './presentation';
import * as types from './types';
import { previewProducts, previewOverview } from './preview-data';
import { summarizeStock } from './mapping';

test('preview covers each exact item type with image and optional identifier examples', () => {
  for (const type of types.ITEM_TYPES) {
    const products = previewProducts.filter(product=>product.item_type===type);
    assert.ok(products.length>=2,type);
    assert.ok(products.some(product=>product.main_image_url),`${type} image`);
    assert.ok(products.some(product=>!product.main_image_url),`${type} placeholder`);
    assert.ok(products.some(product=>!product.item_code),`${type} optional code`);
  }
  assert.ok(previewProducts.every(product=>/^02-\d{4}$/.test(product.stock_ref ?? '')));
  assert.equal(previewOverview.product_count,summarizeStock(previewProducts).product_count);
});

test('type tabs preserve filters and fixed preview params, reset page, and mark the current link', async () => {
  const url = new URL('../../components/inventory/product-type-tabs.tsx', import.meta.url);
  const require = createRequire(url), compiledModule = {exports:{} as {ProductTypeTabs:React.ComponentType<Record<string, unknown>>}};
  const compiled = ts.transpileModule(await readFile(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const dependencies:Record<string,unknown> = {'next/link':{__esModule:true,default:({children,...props}:React.ComponentProps<'a'>)=>React.createElement('a',props,children)},'@/lib/inventory/presentation':presentation,'@/lib/inventory/types':types};
  new Function('require','module','exports',compiled)((name:string)=>dependencies[name] ?? require(name),compiledModule,compiledModule.exports);
  const state = presentation.parseInventoryProductParams({q:'Chair',brand:'11111111-1111-4111-8111-111111111111',status:'hold',itemType:'accessory',sort:'quantity_desc',page:'4'}).state;
  const markup = renderToStaticMarkup(React.createElement(compiledModule.exports.ProductTypeTabs,{state,counts:{all:14,product:8,accessory:4,temporary:2},baseHref:'/dev/inventory-preview?view=products&frame=1&role=viewer'}));
  const links=[...markup.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)];
  assert.equal(links.length,4);
  for (const [index,link] of links.entries()) {
    const href = new URL(link[1].match(/href="([^"]+)"/)![1].replaceAll('&amp;','&'),'https://inventory.test');
    assert.equal(href.searchParams.get('q'),'Chair'); assert.equal(href.searchParams.get('sort'),'quantity_desc');
    assert.equal(href.searchParams.get('status'),'hold'); assert.equal(href.searchParams.get('brand'),state.brand);
    assert.equal(href.searchParams.get('view'),'products'); assert.equal(href.searchParams.get('frame'),'1');
    assert.equal(href.searchParams.get('role'),'viewer'); assert.equal(href.searchParams.has('page'),false);
    assert.equal(href.searchParams.get('itemType'),[null,'product','accessory','temporary'][index]);
    assert.equal(link[1].includes('aria-current="page"'),index===2);
    assert.match(link[1],/min-h-11/); assert.match(link[1],/shrink-0/);
  }
  assert.match(markup,/All/); assert.match(markup,/Products/); assert.match(markup,/Accessories/); assert.match(markup,/Temporary/);
  for(const count of [14,8,4,2]) assert.match(markup,new RegExp(`>${count}<`));
  assert.match(markup,/overflow-x-auto/); assert.match(markup,/min-w-0/); assert.match(markup,/max-w-full/);
});
