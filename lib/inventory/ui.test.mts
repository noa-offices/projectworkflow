import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as access from './access';
import * as presentation from './presentation';
import * as requests from './request-presentation';
import * as submission from './product-request-submission';
import * as validation from './action-validation';
import * as types from './types';
import {previewBrands,previewCategories,previewOverview,previewProduct} from './preview-data';

type Component = React.ComponentType<Record<string, unknown>>;
const Link = ({children,...props}: React.ComponentProps<'a'>) => React.createElement('a',props,children);
const stub = () => React.createElement('div');
async function load(path: string, dependencies: Record<string,unknown> = {}) {
  const url = new URL(path,import.meta.url), require = createRequire(url), compiledModule = {exports:{} as Record<string,Component>};
  const {outputText} = ts.transpileModule(await readFile(url,'utf8'),{fileName:fileURLToPath(url),compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
  new Function('require','module','exports',outputText)((name:string) => dependencies[name] ?? require(name),compiledModule,compiledModule.exports);
  return compiledModule.exports;
}
const shared = {
  'next/link':{__esModule:true,default:Link}, 'next/navigation':{useRouter:()=>({push(){},refresh(){}})},
  '@/lib/inventory/access':access, '@/lib/inventory/presentation':presentation,
  '@/lib/inventory/request-presentation':requests, '@/lib/inventory/types':types,
  '@/lib/inventory/product-request-submission':submission, '@/lib/inventory/action-validation':validation,
  '@/lib/inventory/actions':{}, '@/lib/inventory/photo-upload':{},
};
const html = (component:Component,props:Record<string,unknown>) => renderToStaticMarkup(React.createElement(component,props));

test('overview and products put a full-width Add item link first for only managers and warehouse staff',async()=>{
  const add = await load('../../components/inventory/add-item-button.tsx',shared);
  const dependencies = {...shared,'./add-item-button':add,'./product-filters':{ProductFilters:stub},'./product-list-view':{ProductListView:stub}};
  const overview = (await load('../../components/inventory/overview-view.tsx',dependencies)).InventoryOverviewView;
  const browser = (await load('../../components/inventory/products-browser.tsx',dependencies)).ProductsBrowser;
  const state = presentation.parseInventoryProductParams({}).state;
  for(const role of ['system_owner','admin_manager','warehouse_staff','viewer','designer','sales_designer','sales_coordinator','procurement_manager','unknown',null]) {
    for(const [component,props] of [[overview,{overview:previewOverview}],[browser,{result:{items:[],total:0,page:1,page_count:0},state,brands:[],categories:[]}]] as const) {
      const markup=html(component,{...props,role});
      const allowed=['system_owner','admin_manager','warehouse_staff'].includes(role ?? '');
      assert.equal(markup.includes('href="/inventory/requests/new-product"'),allowed,String(role));
      if(allowed) {
        assert.match(markup,/^<div[^>]*><a[^>]*class="[^"]*min-h-11[^"]*w-full[^>]*>Add item<\/a>/);
        assert.doesNotMatch(markup.split('</a>')[0], /(?:sm|md|lg):w-auto/);
      }
    }
  }
});
test('add form shows manager Add item title and submit, while warehouse submits Send request',async()=>{
  const form=(await load('../../components/inventory/product-request-form.tsx',{...shared,'./request-photo-picker':{RequestPhotoPicker:stub},'./product-image-gallery':{ProductImageGallery:stub}})).ProductRequestForm;
  for(const role of ['system_owner','admin_manager','warehouse_staff']) {
    const markup=html(form,{role,brands:previewBrands,categories:previewCategories});
    if(role==='warehouse_staff') assert.match(markup,/>Send request<\/button>/);
    else {assert.match(markup,/<h1[^>]*>Add item<\/h1>/);assert.match(markup,/>Add item<\/button>/);assert.doesNotMatch(markup,/Add-item request/);}
  }
});
test('product page booking controls distinguish direct actions from requests',async()=>{
  const actions=(await load('../../components/inventory/movement-request-form.tsx',{...shared,'./request-dialog':{RequestDialog:stub}})).ProductRequestActions;
  for(const role of ['system_owner','admin_manager','procurement_manager','designer','sales_designer','sales_coordinator']) {
    const markup=html(actions,{product:previewProduct,role});
    for(const kind of ['book','hold'] as const) assert.ok(markup.includes(`>${requests.movementSubmitLabel(role,kind)}</button>`));
  }
  for(const role of ['viewer','warehouse_staff']) assert.doesNotMatch(html(actions,{product:previewProduct,role}),/>Book now|>Hold now|>Request book|>Request hold/);
});
test('manager destination preserves a photo-upload warning without hiding the added product',async()=>{
  const page=(await load('../../app/inventory/products/[id]/page.tsx',{
    ...shared,'next/navigation':{notFound(){throw new Error('Not found');}},
    '@/lib/auth':{requireInventoryUser:async()=>({profile:{role:'admin_manager'},user:{id:'manager'}})},
    '@/lib/inventory/queries':{getProduct:async()=>previewProduct,getPendingProductMovementRequests:async()=>[]},
    '@/components/inventory/product-detail-view':{ProductDetailView:()=>React.createElement('p',null,'Saved product')},
    '@/components/inventory/movement-request-form':{ProductRequestActions:stub},
    '@/components/inventory/pending-product-requests':{PendingProductRequests:stub},
  })).default as unknown as (props:object)=>Promise<React.ReactNode>;
  for(const photoFailures of [undefined,'2','invalid']) {
    const markup=renderToStaticMarkup(await page({params:Promise.resolve({id:previewProduct.id}),searchParams:Promise.resolve({photoFailures})}));
    assert.match(markup,/Saved product/);
    assert.equal(markup.includes('some photos could not be attached'),photoFailures==='2');
  }
});
