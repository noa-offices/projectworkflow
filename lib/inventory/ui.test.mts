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
import * as productEdit from './product-edit';
import {previewBrands,previewCategories,previewOverview,previewProduct} from './preview-data';
import {previewProductRequests} from './request-preview-data';

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
  '@/lib/inventory/actions':{}, '@/lib/inventory/product-edit':productEdit, '@/lib/inventory/photo-upload':{},
};
const html = (component:Component,props:Record<string,unknown>) => renderToStaticMarkup(React.createElement(component,props));

test('overview and products show a full-width Add item link for only managers and warehouse staff',async()=>{
  const add = await load('../../components/inventory/add-item-button.tsx',shared);
  const dependencies = {...shared,'./add-item-button':add,'./product-type-tabs':{ProductTypeTabs:stub},'./product-filters':{ProductFilters:stub},'./product-list-view':{ProductListView:stub}};
  const overview = (await load('../../components/inventory/overview-view.tsx',dependencies)).InventoryOverviewView;
  const browser = (await load('../../components/inventory/products-browser.tsx',dependencies)).ProductsBrowser;
  const state = presentation.parseInventoryProductParams({}).state;
  for(const role of ['system_owner','admin_manager','warehouse_staff','viewer','designer','sales_designer','sales_coordinator','procurement_manager','unknown',null]) {
    for(const [component,props] of [[overview,{overview:previewOverview}],[browser,{result:{items:[],total:0,page:1,page_count:0},counts:{product:0,accessory:0,temporary:0},state,brands:[],categories:[]}]] as const) {
      const markup=html(component,{...props,role});
      const allowed=['system_owner','admin_manager','warehouse_staff'].includes(role ?? '');
      assert.equal(markup.includes('href="/inventory/requests/new-product"'),allowed,String(role));
      if(allowed) {
        const addLink=markup.match(/<a[^>]*href="\/inventory\/requests\/new-product"[^>]*>Add item<\/a>/)?.[0];
        assert.ok(addLink);assert.match(addLink,/class="[^"]*min-h-11[^\"]*w-full/);
        assert.doesNotMatch(addLink, /(?:sm|md|lg):w-auto/);
      }
    }
  }
});
test('add form shows manager Add item title and submit, while warehouse submits Send request',async()=>{
  const form=(await load('../../components/inventory/product-request-form.tsx',{...shared,'./request-photo-picker':{RequestPhotoPicker:stub},'./product-image-gallery':{ProductImageGallery:stub}})).ProductRequestForm;
  for(const role of ['system_owner','admin_manager','warehouse_staff']) {
    const markup=html(form,{role,brands:previewBrands,categories:previewCategories});
    assert.match(markup,/Stock ref: auto-generated when saved/);
    assert.doesNotMatch(markup,/<input[^>]*name="stock_ref"/);
    for(const name of ['item_code','model_name']) {
      const input=markup.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`));
      assert.ok(input, name);assert.doesNotMatch(input[0],/required/);
    }
    if(role==='warehouse_staff') assert.match(markup,/>Send request<\/button>/);
    else {assert.match(markup,/<h1[^>]*>Add item<\/h1>/);assert.match(markup,/>Add item<\/button>/);assert.doesNotMatch(markup,/Add-item request/);}
  }
});
test('add and review forms explain the submitted read-only total and put location inputs immediately below it',async()=>{
  const form=(await load('../../components/inventory/product-request-form.tsx',{...shared,'./request-photo-picker':{RequestPhotoPicker:stub},'./product-image-gallery':{ProductImageGallery:stub}})).ProductRequestForm;
  const review={...previewProductRequests[0],quantity:5,initial_stock:{warehouse:2,mockup:3}};
  for(const [role,request] of [['warehouse_staff',undefined],['admin_manager',undefined],['system_owner',undefined],['admin_manager',review]] as const) {
    const markup=html(form,{role,request,brands:previewBrands,categories:previewCategories});
    assert.match(markup,/Total quantity \(from locations below\)/);
    const quantity=markup.match(/<input[^>]*name="quantity"[^>]*>/)?.[0];
    assert.ok(quantity);assert.match(quantity,/readOnly=""/);assert.doesNotMatch(quantity,/disabled/);
    assert.match(quantity,/bg-zinc-100/);
    assert.match(quantity,new RegExp(`value="${request ? 5 : 1}"`));
    const helpId=quantity.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(helpId);
    assert.ok(markup.includes(`<p id="${helpId}"`));
    assert.match(markup,/Change the numbers in Initial stock by location below\./);
    assert.match(markup,/name="quantity"[^>]*><\/label><p[^>]*>Change the numbers in Initial stock by location below\.<\/p><\/div><section[^>]*><h2[^>]*>Initial stock by location<\/h2>/);
    const stock=markup.indexOf('>Initial stock by location</h2>');
    assert.ok(stock<markup.indexOf('name="requested_status"'));
    assert.ok(stock<markup.indexOf('name="condition"'));
    assert.equal((markup.match(/name="stock_/g)??[]).length,5);
  }
});
test('product page booking controls distinguish direct actions from requests',async()=>{
  const tools=await load('../../components/inventory/product-manager-tools.tsx',{...shared,'./request-dialog':{RequestDialog:stub}});
  const actions=(await load('../../components/inventory/movement-request-form.tsx',{...shared,'./request-dialog':{RequestDialog:stub},'./product-manager-tools':tools})).ProductRequestActions;
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
test('cards and detail put the stock reference directly below the name and omit missing item codes',async()=>{
  const product={...previewProduct,stock_ref:'02-0001',item_code:null,model_name:null,main_image_url:null};
  const card=(await load('../../components/inventory/product-card.tsx',shared)).ProductCard;
  const cardMarkup=html(card,{product});
  assert.match(cardMarkup,/<\/h2><p[^>]*>02-0001<\/p>/);
  assert.doesNotMatch(cardMarkup,/Code:|>—<|>null<|>undefined</);
  const detail=(await load('../../components/inventory/product-detail-view.tsx',{...shared,'./product-reservations':{ProductReservations:stub},'./product-image-gallery':{ProductImageGallery:stub},'./stock-by-location':{StockByLocation:stub}})).ProductDetailView;
  const detailMarkup=html(detail,{product});
  assert.match(detailMarkup,/Stock reference<\/dt><dd[^>]*>02-0001<\/dd>/);
  assert.match(detailMarkup,/<\/h2><p[^>]*>02-0001<\/p>/);
  assert.doesNotMatch(detailMarkup,/Item code|Code:/);
  assert.doesNotMatch(detailMarkup,/>null<|>undefined</);
  for(const item_code of ['', '   ', '1234']) {
    for(const [component,props] of [[card,{product:{...product,item_code}}],[detail,{product:{...product,item_code}}]] as const) {
      const markup=html(component,props);
      assert.equal(markup.includes('Code: 1234'),item_code==='1234');
      if(item_code!=='1234') assert.doesNotMatch(markup,/Code:|Item code/);
    }
  }
  const requestsView=(await load('../../components/inventory/requests-view.tsx',{...shared,'@/lib/inventory/request-reads':{},'./product-image-gallery':{ProductImageGallery:stub},'./request-dialog':{RequestDialog:stub},'./product-request-form':{ProductRequestForm:stub}})).RequestsView;
  const requestMarkup=html(requestsView,{products:[{...previewProductRequests[0],stock_ref:null,item_code:null,model_name:null}],movements:[],tab:'products',status:'pending_review',mine:false,userId:'viewer',role:'viewer',page:1,pageCount:1,total:1});
  assert.match(requestMarkup,/— · —/);assert.doesNotMatch(requestMarkup,/>null<|>undefined</);
});

test('photo cards lead with a cover image and show only nonzero stock locations as compact labelled chips',async()=>{
  const card=(await load('../../components/inventory/product-card.tsx',shared)).ProductCard;
  const markup=html(card,{product:{...previewProduct,mockup_quantity:0,temporary_out_quantity:0}});
  assert.match(markup,/aspect-\[4\/3\]/);
  assert.match(markup,/<img[^>]*class="object-cover"/);
  assert.ok(markup.indexOf('<img')<markup.indexOf('<h2'));
  assert.match(markup,/focus-visible:outline/);
  for(const label of ['Warehouse: 12','Dubai Showroom: 3','Abu Dhabi Showroom: 2','Sold (cumulative): 8']) {
    assert.ok(markup.includes(`aria-label="${label}"`),label);
    assert.ok(markup.includes(`title="${label}"`),label);
  }
  assert.doesNotMatch(markup,/Mockup|Temporary Out|grid-cols-3/);
  for(const badge of ['17 live','Reserved 3','Available 14']) assert.ok(markup.includes(badge));
});

test('missing photos use a distinct item-type icon and product lists fit two columns on phones',async()=>{
  const cardModule=await load('../../components/inventory/product-card.tsx',shared);
  for(const [item_type,icon] of [['product','package'],['accessory','puzzle'],['temporary','clock']] as const) {
    const markup=html(cardModule.ProductCard,{product:{...previewProduct,item_type,main_image_url:null}});
    assert.match(markup,new RegExp(`lucide-${icon}`));
    assert.match(markup,/No image/);assert.doesNotMatch(markup,/<img/);
  }
  const list=(await load('../../components/inventory/product-list-view.tsx',{...shared,'@/components/inventory/product-card':cardModule})).ProductListView;
  const markup=html(list,{products:[previewProduct],filtered:false});
  assert.match(markup,/grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4/);
});

test('every Overview card is the same whole-card link with a View hint',async()=>{
  const add = await load('../../components/inventory/add-item-button.tsx',shared);
  const overview = (await load('../../components/inventory/overview-view.tsx',{...shared,'./add-item-button':add})).InventoryOverviewView;
  const markup = html(overview,{overview:previewOverview,role:'system_owner'});
  const cards = [...markup.matchAll(/<a [^>]*data-overview-card[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  // Units, Products, Reserved, Low stock, 2 pending request cards, 6 locations.
  assert.equal(cards.length,12);
  const hrefs = cards.map(card => card.match(/href="([^"]+)"/)![1].replaceAll('&amp;','&'));
  assert.ok(hrefs.includes('/inventory/requests?tab=products&status=pending_review'));
  assert.ok(hrefs.includes('/inventory/requests?tab=movements&status=pending_review'));
  const classOf = (card:string) => card.match(/class="([^"]+)"/)![1];
  const base = (card:string) => classOf(card).split(' ').filter(name => !/^(border|bg|shadow)/.test(name)).join(' ');
  for(const card of cards) {
    assert.equal(base(card),base(cards[0]));
    assert.match(classOf(card),/min-h-11/); assert.match(classOf(card),/hover:/); assert.match(classOf(card),/focus-visible:outline/);
    assert.match(card,/aria-hidden="true"[^>]*>(<span class="hidden sm:inline">View<\/span>)?<svg/);
    assert.match(card,/<dt class="[^"]*text-sm[^"]*"/);
    assert.doesNotMatch(card,/underline/);
  }
  const standard = cards.filter(card => !card.includes('text-4xl'));
  assert.equal(standard.length,10);
  for(const card of standard) assert.match(card,/<dd class="[^"]*text-2xl/);
  assert.equal(markup.match(/<a [^>]*underline/g)?.length ?? 0,0);
});

test('Edit item, Manage photos and Remove item show only for System Owner and Admin Manager',async()=>{
  const tools=await load('../../components/inventory/product-manager-tools.tsx',{...shared,'./request-dialog':{RequestDialog:stub}});
  const actions=(await load('../../components/inventory/movement-request-form.tsx',{...shared,'./request-dialog':{RequestDialog:stub},'./product-manager-tools':tools})).ProductRequestActions;
  for(const role of ['system_owner','admin_manager','procurement_manager','designer','sales_designer','sales_coordinator','warehouse_staff','viewer','unknown',null]) {
    const markup=html(actions,{product:previewProduct,role});
    const manager=['system_owner','admin_manager'].includes(role ?? '');
    for(const label of ['Edit item','Manage photos','Remove item']) assert.equal(markup.includes(label),manager,`${role} ${label}`);
    assert.equal(markup.includes(`/inventory/products/${previewProduct.id}/edit`),manager);
    assert.equal(markup.includes(`/inventory/products/${previewProduct.id}/photos`),manager);
  }
});
test('edit form shows stock ref and quantity read-only, and costs only to managers',async()=>{
  const form=(await load('../../components/inventory/product-edit-form.tsx',shared)).ProductEditForm;
  const props={product:previewProduct,brands:previewBrands,categories:previewCategories,productHref:'/p'};
  for(const role of ['system_owner','admin_manager']) {
    const markup=html(form,{...props,role});
    assert.match(markup,/<input[^>]*readOnly=""[^>]*name="stock_ref_display"/);
    assert.match(markup,/<input[^>]*readOnly=""[^>]*name="quantity_display"/);
    assert.ok(markup.includes('Change stock with Take / Move stock.'));
    assert.doesNotMatch(markup,/name="stock_ref"|name="quantity"/);
    for(const name of ['price','freight_cost','c_and_f','transport','custom_duty','labour','vat','item_name','item_code','model_name','low_stock_at','dimension_length']) assert.ok(markup.includes(`name="${name}"`),name);
  }
  for(const role of ['warehouse_staff','viewer','designer',null]) {
    const markup=html(form,{...props,role});
    assert.doesNotMatch(markup,/name="price"|name="item_name"|<form/);
  }
});
test('photo manager shows add controls until three photos, and nothing to other roles',async()=>{
  const manager=(await load('../../components/inventory/product-photo-manager.tsx',{...shared,'./request-dialog':{RequestDialog:stub},'next/image':{__esModule:true,default:(props:Record<string,unknown>)=>React.createElement('img',{alt:String(props.alt)})}})).ProductPhotoManager;
  const images=previewProduct.images;
  const props={productId:previewProduct.id,productName:'Chair',productHref:'/p'};
  const full=html(manager,{...props,images:images.slice(0,3),role:'admin_manager'});
  assert.ok(full.includes('(3/3)')); assert.match(full,/maximum of three photos/);
  assert.equal((full.match(/<input[^>]*type="file"[^>]*disabled=""/g) ?? []).length,2);
  const two=html(manager,{...props,images:images.slice(0,2),role:'admin_manager'});
  assert.ok(two.includes('(2/3)')); assert.doesNotMatch(two,/<input[^>]*type="file"[^>]*disabled=""/);
  assert.match(two,/accept="image\/jpeg,image\/png,image\/webp"/); assert.ok(two.includes('Set as main')); assert.ok(two.includes('Remove photo 1'));
  assert.doesNotMatch(html(manager,{...props,images,role:'warehouse_staff'}),/Set as main|type="file"/);
});
